import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadReviewProfile } from '../src/main/profile';
import { createAnnotation } from '../src/main/annotation-targets';
import { collectSearchEntries, normalizeLoadedProject } from '../src/main/normalizer';
import { patchAnnotation, readAnnotations } from '../src/main/patching';
import { SqliteSearchCache } from '../src/main/search/sqlite-cache';

const root = process.cwd();
const profilePath = join(root, 'profiles', 'inference-review-profile.json');
const tracePath = join(root, 'inference', '1780933458305', 'a00-0.json');
const evalPath = join(root, 'inference', '1780933458305', 'a00-0.eval.json');

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

const profile = await loadReviewProfile(profilePath);
const traceRaw = await loadJson(tracePath);
const evalRaw = await loadJson(evalPath);
const project = normalizeLoadedProject({ profile, traceUri: tracePath, evalUri: evalPath, traceRaw, evalRaw });

if (project.validationErrors.length > 0) {
  throw new Error(`Dogfood validation failed:\n${project.validationErrors.join('\n')}`);
}
if (project.traceNodes.length === 0 || project.groundTruthPairs.length === 0 || project.evalMetrics.length === 0) {
  throw new Error('Dogfood normalization did not produce trace, GT, and eval views.');
}

const cache = new SqliteSearchCache();
await cache.replaceIndex(collectSearchEntries(profile, traceRaw, evalRaw));
const hits = await cache.search('Dracula');
if (hits.length === 0) throw new Error('Dogfood search failed to find expected Dracula content.');

const annotation = createAnnotation(traceRaw, {
  artifactRole: 'trace',
  targetPointer: project.traceNodes[0].rawPointer,
  label: 'Dogfood review',
  body: 'Verified annotation patching from the dogfood workflow.',
  tags: ['dogfood']
});
const patched = patchAnnotation(traceRaw, profile, annotation);
const tempDir = await mkdtemp(join(tmpdir(), 'verity-dogfood-'));
const reviewedPath = join(tempDir, 'a00-0.reviewed.json');
await writeFile(reviewedPath, `${JSON.stringify(patched, null, 2)}\n`);
const reloaded = await loadJson(reviewedPath);
const annotations = readAnnotations(reloaded, profile);
if (annotations.length !== 1) throw new Error('Dogfood reload did not find the patched annotation.');

console.log(`Dogfood passed using ${tracePath}`);
console.log(`Reviewed temp artifact: ${reviewedPath}`);
console.log(`Indexed search hits: ${hits.length}`);

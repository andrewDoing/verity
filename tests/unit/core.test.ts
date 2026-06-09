import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadReviewProfile } from '../../src/main/profile';
import { createAnnotation } from '../../src/main/annotation-targets';
import { collectSearchEntries, normalizeGroundTruth, normalizeLoadedProject } from '../../src/main/normalizer';
import { patchAnnotation, readAnnotations } from '../../src/main/patching';
import { buildRunOverview, listRuns } from '../../src/main/run-overview';
import { SqliteSearchCache } from '../../src/main/search/sqlite-cache';

const root = process.cwd();
const profilePath = join(root, 'profiles', 'inference-review-profile.json');
const tracePath = join(root, 'inference', '1780933458305', 'a00-0.json');
const evalPath = join(root, 'inference', '1780933458305', 'a00-0.eval.json');

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('Verity core domain', () => {
  it('validates and normalizes real inference artifacts', async () => {
    const profile = await loadReviewProfile(profilePath);
    const traceRaw = await loadJson(tracePath);
    const evalRaw = await loadJson(evalPath);

    const project = normalizeLoadedProject({ profile, traceUri: tracePath, evalUri: evalPath, traceRaw, evalRaw });

    expect(project.validationErrors).toEqual([]);
    expect(project.traceNodes.length).toBeGreaterThan(2);
    expect(project.traceNodes.some((node) => node.kind === 'tool-call')).toBe(true);
    expect(project.groundTruthPairs.find((pair) => pair.label === 'Answer')?.inference).toContain('Dracula');
    expect(project.evalMetrics.find((metric) => metric.name === 'generation_accuracy')?.score).toBeCloseTo(0.666667);
    expect(project.evalFactGroups.flatMap((group) => group.facts).length).toBeGreaterThan(1);
  });

  it('resolves ground-truth pairs for multi-turn records via per-record evaluation paths', async () => {
    const profile = await loadReviewProfile(profilePath);
    const singleTurn = await loadJson(join(root, 'inference', '1780936769209', 'a00-0.json'));
    const multiTurn = await loadJson(join(root, 'inference', '1780936769209', 'c00-0.json'));

    const singlePairs = normalizeGroundTruth(profile, singleTurn);
    expect(singlePairs.find((pair) => pair.label === 'Answer')?.inferencePointer).toBe('/inference/output/answer');
    expect(singlePairs.find((pair) => pair.label === 'Answer')?.inference).toContain('Dracula');

    const multiPairs = normalizeGroundTruth(profile, multiTurn);
    const answer = multiPairs.find((pair) => pair.label === 'Answer');
    const question = multiPairs.find((pair) => pair.label === 'Question');
    expect(answer?.turn).toBe(0);
    expect(answer?.inferencePointer).toBe('/inference/output/turns/0/answer');
    expect(answer?.groundTruthPointer).toBe('/ground_truth/output/turns/0/answer');
    expect(answer?.inference).toContain('Dracula');
    expect(question?.turn).toBe(0);
    expect(question?.inferencePointer).toBe('/inference/output/turns/0/question');
    expect(typeof question?.inference).toBe('string');
    expect((question?.inference as string).length).toBeGreaterThan(0);
    expect(singlePairs.every((pair) => pair.turn === undefined)).toBe(true);
  });

  it('creates content-hash targets and patches annotations into the configured source path', async () => {
    const profile = await loadReviewProfile(profilePath);
    const traceRaw = await loadJson(tracePath);
    const annotation = createAnnotation(traceRaw, {
      artifactRole: 'trace',
      targetPointer: '/inference/transcript/1',
      label: 'Needs review',
      body: 'The retrieval call should be inspected.',
      tags: ['unit']
    });

    const patched = patchAnnotation(traceRaw, profile, annotation);
    const annotations = readAnnotations(patched, profile);

    expect(annotation.target.contentHash).toMatch(/^sha256:/);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].target.jsonPointer).toBe('/inference/transcript/1');
    expect(annotations[0].label).toBe('Needs review');
  });

  it('indexes trace, ground-truth, and eval text in the SQLite cache', async () => {
    const profile = await loadReviewProfile(profilePath);
    const traceRaw = await loadJson(tracePath);
    const evalRaw = await loadJson(evalPath);
    const cache = new SqliteSearchCache();

    await cache.replaceIndex(collectSearchEntries(profile, traceRaw, evalRaw));
    const draculaHits = await cache.search('Dracula');
    const metricHits = await cache.search('generation_accuracy');

    expect(draculaHits.length).toBeGreaterThan(0);
    expect(draculaHits.some((hit) => hit.artifactRole === 'trace' || hit.artifactRole === 'groundTruth')).toBe(true);
    expect(metricHits.some((hit) => hit.artifactRole === 'eval')).toBe(true);
  });

  it('keeps dogfood patching on a temporary copy', async () => {
    const profile = await loadReviewProfile(profilePath);
    const traceRaw = await loadJson(tracePath);
    const tempDir = await mkdtemp(join(tmpdir(), 'verity-unit-'));
    const tempArtifact = join(tempDir, 'a00-0.reviewed.json');
    const annotation = createAnnotation(traceRaw, {
      artifactRole: 'trace',
      targetPointer: '/inference/output/answer',
      label: 'Dogfood note'
    });
    const patched = patchAnnotation(traceRaw, profile, annotation);

    await writeFile(tempArtifact, `${JSON.stringify(patched, null, 2)}\n`);
    const reloaded = await loadJson(tempArtifact);

    expect(readAnnotations(reloaded, profile)).toHaveLength(1);
  });

  it('summarizes inference iterations per ground-truth case for the navigator', async () => {
    const profile = await loadReviewProfile(profilePath);
    const richTrace = join(root, 'inference', '1780936769209', 'a00-0.json');
    const overview = await buildRunOverview(profile, richTrace);

    expect(overview.runFolder).toBe('1780936769209');
    expect(overview.active).toEqual({ ref: 'a00', iteration: 0 });

    const refs = overview.cases.map((item) => item.ref);
    expect(refs).toContain('a00');
    expect(refs).toEqual([...refs].sort());

    const caseA = overview.cases.find((item) => item.ref === 'a00');
    expect(caseA).toBeDefined();
    expect(caseA!.iterations.length).toBeGreaterThan(1);
    expect(caseA!.iterations.map((it) => it.iteration)).toEqual([...caseA!.iterations].map((it) => it.iteration).sort((a, b) => a - b));

    const first = caseA!.iterations.find((it) => it.iteration === 0)!;
    expect(first.label).toBe('a00-0');
    expect(first.evalPath).toBeDefined();
    expect(typeof first.score).toBe('number');
    expect(first.score!).toBeGreaterThanOrEqual(0);
    expect(first.score!).toBeLessThanOrEqual(1);
    expect(first.metrics.length).toBeGreaterThan(0);
    expect(first.metrics.every((metric) => metric.score >= 0 && metric.score <= 1)).toBe(true);
    expect(first.unsupportedFacts).toBeGreaterThanOrEqual(0);
  });

  it('lists inference run folders for compare permutations', async () => {
    const runs = await listRuns(join(root, 'inference'));

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.map((run) => run.runFolder)).toEqual([...runs.map((run) => run.runFolder)].sort());

    const rich = runs.find((run) => run.runFolder === '1780936769209');
    expect(rich).toBeDefined();
    expect(rich!.refs).toContain('a00');
    expect(rich!.iterations).toBe(10);
    expect(rich!.traceCount).toBe(40);
    expect(rich!.completed).toBeGreaterThan(0);
  });
});

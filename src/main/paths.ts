import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  return resolve(here, '..', '..');
}

export function repoPath(...segments: string[]): string {
  return join(repoRoot(), ...segments);
}

export function defaultFixturePaths(): { profilePath: string; tracePath: string; evalPath: string } {
  const profilePath = repoPath('profiles', 'inference-review-profile.json');
  const tracePath = repoPath('inference', '1780936769209', 'a00-0.json');
  const evalPath = repoPath('inference', '1780936769209', 'a00-0.eval.json');

  return {
    profilePath,
    tracePath: existsSync(tracePath) ? tracePath : '',
    evalPath: existsSync(evalPath) ? evalPath : ''
  };
}

export function inferenceRoot(): string {
  return repoPath('inference');
}

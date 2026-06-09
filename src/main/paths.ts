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
  return {
    profilePath: repoPath('profiles', 'inference-review-profile.json'),
    tracePath: repoPath('inference', '1780936769209', 'a00-0.json'),
    evalPath: repoPath('inference', '1780936769209', 'a00-0.eval.json')
  };
}

export function inferenceRoot(): string {
  return repoPath('inference');
}

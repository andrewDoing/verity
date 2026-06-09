import { readFile } from 'node:fs/promises';
import type { ReviewProfile } from '../shared/domain';
import { validateReviewProfile } from './validation';

export async function loadReviewProfile(path: string): Promise<ReviewProfile> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const result = validateReviewProfile(raw);
  if (!result.profile) {
    throw new Error(`Invalid Review Profile:\n${result.errors.join('\n')}`);
  }
  return result.profile;
}

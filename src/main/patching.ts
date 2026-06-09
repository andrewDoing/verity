import type { Annotation, ReviewProfile } from '../shared/domain';
import { getByPointer, setByPointer } from '../shared/json';
import { validateAnnotation } from './validation';

export function readAnnotations(rawArtifact: unknown, profile: ReviewProfile): Annotation[] {
  const value = getByPointer(rawArtifact, profile.annotation.patchPath);
  return Array.isArray(value) ? (value as Annotation[]) : [];
}

export function patchAnnotation(rawArtifact: unknown, profile: ReviewProfile, annotation: Annotation): unknown {
  const valid = validateAnnotation(annotation);
  if (!valid.annotation) throw new Error(`Invalid annotation:\n${valid.errors.join('\n')}`);

  const cloned = structuredClone(rawArtifact);
  const existing = readAnnotations(cloned, profile);
  const withoutCurrent = existing.filter((item) => item.id !== annotation.id);
  setByPointer(cloned, profile.annotation.patchPath, [...withoutCurrent, annotation]);
  return cloned;
}

export function deleteAnnotation(rawArtifact: unknown, profile: ReviewProfile, annotationId: string): unknown {
  const cloned = structuredClone(rawArtifact);
  setByPointer(cloned, profile.annotation.patchPath, readAnnotations(cloned, profile).filter((item) => item.id !== annotationId));
  return cloned;
}

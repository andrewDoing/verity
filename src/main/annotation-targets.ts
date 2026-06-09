import { createHash, randomUUID } from 'node:crypto';
import type { Annotation, AnnotationTarget, ArtifactRole } from '../shared/domain';
import { getByPointer, stringifyPreview } from '../shared/json';

export function hashValue(value: unknown): string {
  const text = stringifyPreview(value) ?? '';
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export function createAnnotationTarget(rawArtifact: unknown, artifactRole: ArtifactRole, jsonPointer: string): AnnotationTarget {
  const value = getByPointer(rawArtifact, jsonPointer);
  return {
    artifactRole,
    jsonPointer,
    contentHash: hashValue(value)
  };
}

export function createAnnotation(rawArtifact: unknown, input: {
  artifactRole: ArtifactRole;
  targetPointer: string;
  label: string;
  body?: string;
  tags?: string[];
}): Annotation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    target: createAnnotationTarget(rawArtifact, input.artifactRole, input.targetPointer),
    label: input.label,
    body: input.body,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now
  };
}

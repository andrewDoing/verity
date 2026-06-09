import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import reviewProfileSchema from '../../schemas/review-profile.schema.json' assert { type: 'json' };
import annotationSchema from '../../schemas/verity-annotation.schema.json' assert { type: 'json' };
import type { Annotation, ReviewProfile } from '../shared/domain';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const profileValidator = ajv.compile(reviewProfileSchema);
const annotationValidator = ajv.compile(annotationSchema);
const compiledArtifactValidators = new WeakMap<Record<string, unknown>, ValidateFunction>();

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

export function validateReviewProfile(value: unknown): { profile?: ReviewProfile; errors: string[] } {
  if (profileValidator(value)) return { profile: value as unknown as ReviewProfile, errors: [] };
  return { errors: formatErrors(profileValidator.errors) };
}

export function validateAnnotation(value: unknown): { annotation?: Annotation; errors: string[] } {
  if (annotationValidator(value)) return { annotation: value as unknown as Annotation, errors: [] };
  return { errors: formatErrors(annotationValidator.errors) };
}

export function validateArtifact(schema: Record<string, unknown>, artifact: unknown): string[] {
  let validator = compiledArtifactValidators.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    compiledArtifactValidators.set(schema, validator);
  }
  return validator(artifact) ? [] : formatErrors(validator.errors);
}

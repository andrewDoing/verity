import type {
  EvalFactGroup,
  EvalMetricSummary,
  GroundTruthPair,
  LoadedProject,
  ReviewProfile,
  SearchHit,
  TraceNode
} from '../shared/domain';
import { collectByPattern, getByPointer, isRecord, stringifyPreview } from '../shared/json';
import { readAnnotations } from './patching';
import { validateArtifact } from './validation';

export interface NormalizedArtifacts {
  profile: ReviewProfile;
  traceUri: string;
  evalUri?: string;
  traceRaw: unknown;
  evalRaw?: unknown;
}

function relative(record: unknown, path: string | undefined): unknown {
  return path ? getByPointer(record, path) : undefined;
}

function text(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function normalizeTrace(profile: ReviewProfile, raw: unknown): TraceNode[] {
  return collectByPattern(raw, `${profile.mappings.trace.recordsPath}/*`).map(({ pointer, value }, index) => {
    const kind = text(relative(value, profile.mappings.trace.kindPath), 'record');
    const label = text(relative(value, profile.mappings.trace.labelPath), kind);
    const idSeed = text(relative(value, profile.mappings.trace.idPath), `${kind}-${index}`);
    return {
      id: `${idSeed}-${index}`,
      kind,
      label: label || kind,
      start: text(relative(value, profile.mappings.trace.startPath)) || undefined,
      end: text(relative(value, profile.mappings.trace.endPath)) || undefined,
      durationMs: numberValue(relative(value, profile.mappings.trace.durationPath)),
      status: text(relative(value, profile.mappings.trace.statusPath)) || undefined,
      rawPointer: pointer,
      details: (profile.mappings.trace.detailPaths ?? [])
        .map((detail) => ({
          label: detail.label,
          pointer: `${pointer}${detail.path}`,
          value: relative(value, detail.path)
        }))
        .filter((detail) => detail.value !== undefined),
      attributes: isRecord(value) ? value : { value }
    };
  });
}

type PairRole = 'question' | 'answer' | 'evidence';

/**
 * Output-relative pointers a record exposes via `ground_truth.evaluation`. Records may be
 * single-turn (answer at `/answer`) or multi-turn (answer at `/turns/0/answer`); these paths let
 * us resolve the right leaf for either schema instead of assuming a fixed shape.
 */
function outputRelPaths(raw: unknown): Partial<Record<PairRole, string>> {
  const evaluation = getByPointer(raw, '/ground_truth/evaluation');
  if (!isRecord(evaluation)) return {};
  const answer = typeof evaluation.answer_path === 'string' ? evaluation.answer_path : undefined;
  const evidence = typeof evaluation.evidence_path === 'string' ? evaluation.evidence_path : undefined;
  const question = answer ? answer.replace(/\/[^/]+$/, '/question') : undefined;
  return { question, answer, evidence };
}

function pairRole(pointer: string): PairRole | undefined {
  const leaf = pointer.slice(pointer.lastIndexOf('/') + 1);
  return leaf === 'question' || leaf === 'answer' || leaf === 'evidence' ? leaf : undefined;
}

/** Output base pointer for a configured pair path, e.g. `/inference/output/answer` → `/inference/output`. */
function sideBase(configured: string): string {
  return configured.slice(0, configured.lastIndexOf('/'));
}

/**
 * Resolve a configured pair pointer against the record's actual schema. When the per-record
 * evaluation paths point at a different leaf (e.g. multi-turn `/turns/0/answer`), rebase the
 * configured `.../output` prefix onto that relative path; otherwise fall back to the literal path.
 */
function resolveSide(raw: unknown, configured: string, rels: Partial<Record<PairRole, string>>): { pointer: string; value: unknown } {
  const role = pairRole(configured);
  const rel = role ? rels[role] : undefined;
  if (rel) {
    const candidate = `${sideBase(configured)}${rel}`;
    const value = getByPointer(raw, candidate);
    if (value !== undefined) return { pointer: candidate, value };
  }
  return { pointer: configured, value: getByPointer(raw, configured) };
}

/** Number of conversation turns a multi-turn record exposes, or 0 when the record is single-turn. */
function turnCount(raw: unknown): number {
  const gtTurns = getByPointer(raw, '/ground_truth/output/turns');
  const infTurns = getByPointer(raw, '/inference/output/turns');
  if (!Array.isArray(gtTurns) && !Array.isArray(infTurns)) return 0;
  return Math.max(Array.isArray(gtTurns) ? gtTurns.length : 0, Array.isArray(infTurns) ? infTurns.length : 0) || 1;
}

export function normalizeGroundTruth(profile: ReviewProfile, raw: unknown): GroundTruthPair[] {
  const turns = turnCount(raw);
  if (turns > 0) {
    const pairs: GroundTruthPair[] = [];
    for (let turn = 0; turn < turns; turn += 1) {
      for (const pair of profile.mappings.groundTruth.pairs) {
        const role = pairRole(pair.groundTruthPath);
        if (!role) continue;
        const groundTruthPointer = `${sideBase(pair.groundTruthPath)}/turns/${turn}/${role}`;
        const inferencePointer = `${sideBase(pair.inferencePath)}/turns/${turn}/${role}`;
        pairs.push({
          label: pair.label,
          turn,
          groundTruth: getByPointer(raw, groundTruthPointer),
          inference: getByPointer(raw, inferencePointer),
          groundTruthPointer,
          inferencePointer
        });
      }
    }
    return pairs;
  }

  const rels = outputRelPaths(raw);
  return profile.mappings.groundTruth.pairs.map((pair) => {
    const groundTruth = resolveSide(raw, pair.groundTruthPath, rels);
    const inference = resolveSide(raw, pair.inferencePath, rels);
    return {
      label: pair.label,
      groundTruth: groundTruth.value,
      inference: inference.value,
      groundTruthPointer: groundTruth.pointer,
      inferencePointer: inference.pointer
    };
  });
}

export function normalizeEvalMetrics(profile: ReviewProfile, raw: unknown | undefined): EvalMetricSummary[] {
  if (!raw) return [];
  const metrics = getByPointer(raw, profile.mappings.eval.metricsPath);
  if (!isRecord(metrics)) return [];
  return Object.entries(metrics).map(([name, value]) => ({
    name,
    score: isRecord(value) && typeof value.score === 'number' ? value.score : undefined,
    numerator: isRecord(value) && typeof value.numerator === 'number' ? value.numerator : undefined,
    denominator: isRecord(value) && typeof value.denominator === 'number' ? value.denominator : undefined,
    value,
    pointer: `${profile.mappings.eval.metricsPath}/${name}`
  }));
}

export function normalizeEvalFactGroups(profile: ReviewProfile, raw: unknown | undefined): EvalFactGroup[] {
  if (!raw) return [];
  return (profile.mappings.eval.factGroups ?? []).map((group) => {
    const value = getByPointer(raw, group.path);
    return {
      label: group.label,
      pointer: group.path,
      facts: Array.isArray(value) ? value : []
    };
  });
}

export function collectSearchEntries(profile: ReviewProfile, traceRaw: unknown, evalRaw?: unknown): SearchHit[] {
  return profile.mappings.search.flatMap((entry) => {
    const raw = entry.role === 'eval' ? evalRaw : traceRaw;
    if (!raw) return [];
    return collectByPattern(raw, entry.path).map(({ pointer, value }) => ({
      artifactRole: entry.role,
      pointer,
      label: entry.label ?? entry.role,
      preview: stringifyPreview(value).slice(0, 800)
    }));
  });
}

export function normalizeLoadedProject(input: NormalizedArtifacts): LoadedProject {
  const validationErrors = [
    ...validateArtifact(input.profile.artifactSchemas.trace, input.traceRaw).map((error) => `trace ${error}`),
    ...(input.evalRaw && input.profile.artifactSchemas.eval
      ? validateArtifact(input.profile.artifactSchemas.eval, input.evalRaw).map((error) => `eval ${error}`)
      : [])
  ];
  return {
    profile: { id: input.profile.id, version: input.profile.version, name: input.profile.name },
    traceUri: input.traceUri,
    evalUri: input.evalUri,
    validationErrors,
    traceNodes: normalizeTrace(input.profile, input.traceRaw),
    groundTruthPairs: normalizeGroundTruth(input.profile, input.traceRaw),
    evalMetrics: normalizeEvalMetrics(input.profile, input.evalRaw),
    evalFactGroups: normalizeEvalFactGroups(input.profile, input.evalRaw),
    evalStatus: text(input.evalRaw ? getByPointer(input.evalRaw, input.profile.mappings.eval.statusPath) : undefined) || undefined,
    evalSource: text(input.evalRaw ? getByPointer(input.evalRaw, input.profile.mappings.eval.sourcePath) : undefined) || undefined,
    annotations: readAnnotations(input.traceRaw, input.profile),
    searchReady: true
  };
}

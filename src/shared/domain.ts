export type ArtifactRole = 'trace' | 'groundTruth' | 'eval';

export interface ReviewProfile {
  id: string;
  version: string;
  name: string;
  artifactSchemas: {
    trace: Record<string, unknown>;
    groundTruth?: Record<string, unknown>;
    eval?: Record<string, unknown>;
  };
  mappings: {
    trace: {
      recordsPath: string;
      idPath?: string;
      kindPath: string;
      labelPath: string;
      startPath?: string;
      endPath?: string;
      durationPath?: string;
      statusPath?: string;
      detailPaths?: Array<{ label: string; path: string }>;
    };
    groundTruth: {
      pairs: Array<{ label: string; groundTruthPath: string; inferencePath: string }>;
    };
    eval: {
      metricsPath: string;
      statusPath: string;
      sourcePath: string;
      factGroups?: Array<{ label: string; path: string }>;
    };
    search: Array<{ role: ArtifactRole; label?: string; path: string }>;
  };
  annotation: {
    strategy: 'native-field' | 'extension-field' | 'schema-overlay' | 'sidecar';
    patchPath: string;
    extensionKey?: string;
  };
}

export interface TraceNode {
  id: string;
  parentId?: string;
  kind: string;
  label: string;
  start?: string;
  end?: string;
  durationMs?: number;
  status?: string;
  rawPointer: string;
  details: Array<{ label: string; value: unknown; pointer: string }>;
  attributes: Record<string, unknown>;
}

export interface GroundTruthPair {
  label: string;
  /** Zero-based turn index for multi-turn records; omitted for single-turn records. */
  turn?: number;
  groundTruth: unknown;
  inference: unknown;
  groundTruthPointer: string;
  inferencePointer: string;
}

export interface EvalMetricSummary {
  name: string;
  score?: number;
  numerator?: number;
  denominator?: number;
  value: unknown;
  pointer: string;
}

export interface EvalFactGroup {
  label: string;
  pointer: string;
  facts: unknown[];
}

export interface AnnotationTarget {
  artifactRole: ArtifactRole;
  jsonPointer: string;
  stableId?: string;
  timeRange?: [number, number];
  contentHash: string;
}

export interface Annotation {
  id: string;
  target: AnnotationTarget;
  label: string;
  body?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  artifactRole: ArtifactRole;
  pointer: string;
  label: string;
  preview: string;
}

export interface LoadedProject {
  profile: Pick<ReviewProfile, 'id' | 'version' | 'name'>;
  traceUri: string;
  evalUri?: string;
  validationErrors: string[];
  traceNodes: TraceNode[];
  groundTruthPairs: GroundTruthPair[];
  evalMetrics: EvalMetricSummary[];
  evalFactGroups: EvalFactGroup[];
  evalStatus?: string;
  evalSource?: string;
  annotations: Annotation[];
  searchReady: boolean;
}

export interface ProjectLoadRequest {
  profilePath: string;
  tracePath: string;
  evalPath?: string;
}

export interface IterationMetric {
  name: string;
  score: number;
}

export interface IterationSummary {
  /** Ground-truth case the iteration belongs to, e.g. "a00". */
  ref: string;
  /** Zero-based iteration index parsed from the `<ref>-<iter>` file name. */
  iteration: number;
  /** Display label, e.g. "a00-3". */
  label: string;
  tracePath: string;
  evalPath?: string;
  /** Headline quality signal: mean of available eval metric scores in [0,1]. */
  score?: number;
  /** Eval run status, when an eval artifact exists. */
  status?: string;
  /** Count of judge facts the eval could not corroborate (review hotspots). */
  unsupportedFacts?: number;
  /** Individual metric scores for the compact strip. */
  metrics: IterationMetric[];
  /** Populated when the iteration's eval artifact could not be read. */
  error?: string;
}

export interface CaseIterations {
  ref: string;
  iterations: IterationSummary[];
}

export interface RunOverview {
  /** Folder name of the run, e.g. "1780936769209". */
  runFolder: string;
  runPath: string;
  cases: CaseIterations[];
  /** Case + iteration matching the currently loaded trace, when resolvable. */
  active?: { ref: string; iteration: number };
}

export interface RunOverviewRequest {
  profilePath: string;
  tracePath: string;
}

export interface RunSummary {
  runFolder: string;
  runPath: string;
  /** Ground-truth cases present in the run, e.g. ["a00","b00"]. */
  refs: string[];
  /** Highest iteration count found across the run's cases. */
  iterations: number;
  /** Total inference trace files in the run. */
  traceCount: number;
  completed?: number;
  timeout?: number;
  failed?: number;
}

export interface AnnotationSaveRequest {
  label: string;
  body?: string;
  tags?: string[];
  targetPointer: string;
  artifactRole: ArtifactRole;
  outputPath?: string;
}

export interface AnnotationSaveResult {
  outputPath: string;
  project: LoadedProject;
}

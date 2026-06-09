import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CaseIterations,
  IterationMetric,
  IterationSummary,
  ReviewProfile,
  RunOverview,
  RunSummary
} from '../shared/domain';
import { normalizeEvalFactGroups, normalizeEvalMetrics } from './normalizer';

const TRACE_FILE = /^(.+)-(\d+)\.json$/;

function toFsPath(uriOrPath: string): string {
  return uriOrPath.startsWith('file://') ? fileURLToPath(uriOrPath) : uriOrPath;
}

/** Mean of metric scores that look like quality ratios in [0,1] (skips timing/meta metrics). */
function headlineScore(metrics: IterationMetric[]): number | undefined {
  if (metrics.length === 0) return undefined;
  const sum = metrics.reduce((total, metric) => total + metric.score, 0);
  return sum / metrics.length;
}

function summarizeEval(profile: ReviewProfile, evalRaw: unknown): {
  metrics: IterationMetric[];
  score?: number;
  status?: string;
  unsupportedFacts: number;
} {
  const metrics: IterationMetric[] = normalizeEvalMetrics(profile, evalRaw)
    .filter((metric): metric is typeof metric & { score: number } =>
      typeof metric.score === 'number' && metric.score >= 0 && metric.score <= 1 && !metric.name.startsWith('meta_')
    )
    .map((metric) => ({ name: metric.name, score: metric.score }));

  const unsupportedFacts = normalizeEvalFactGroups(profile, evalRaw).reduce((total, group) => {
    return (
      total +
      group.facts.filter((fact) => {
        if (!fact || typeof fact !== 'object') return false;
        const record = fact as Record<string, unknown>;
        return record.supported_by_inference === false || record.supported_by_ground_truth === false;
      }).length
    );
  }, 0);

  const statusRaw = evalRaw && typeof evalRaw === 'object' ? (evalRaw as Record<string, unknown>).status : undefined;
  return {
    metrics,
    score: headlineScore(metrics),
    status: typeof statusRaw === 'string' ? statusRaw : undefined,
    unsupportedFacts
  };
}

/**
 * Scan the folder of `tracePath` for `<ref>-<iter>.json` inference artifacts, group them by
 * ground-truth case, and summarize each iteration's eval so reviewers can flip through and spot
 * interesting iterations.
 */
export async function buildRunOverview(profile: ReviewProfile, tracePath: string): Promise<RunOverview> {
  const fsTrace = toFsPath(tracePath);
  const runPath = dirname(fsTrace);
  const runFolder = basename(runPath);
  const entries = await readdir(runPath);
  const present = new Set(entries);

  const grouped = new Map<string, IterationSummary[]>();
  for (const entry of entries) {
    if (entry.endsWith('.eval.json') || entry.endsWith('.reviewed.json')) continue;
    const match = TRACE_FILE.exec(entry);
    if (!match) continue;
    const ref = match[1];
    const iteration = Number(match[2]);
    const iterTracePath = join(runPath, entry);
    const evalName = `${ref}-${iteration}.eval.json`;
    const evalPath = present.has(evalName) ? join(runPath, evalName) : undefined;

    const summary: IterationSummary = {
      ref,
      iteration,
      label: `${ref}-${iteration}`,
      tracePath: iterTracePath,
      evalPath,
      metrics: []
    };

    if (evalPath) {
      try {
        const evalRaw = JSON.parse(await readFile(evalPath, 'utf8')) as unknown;
        const summarized = summarizeEval(profile, evalRaw);
        summary.metrics = summarized.metrics;
        summary.score = summarized.score;
        summary.status = summarized.status;
        summary.unsupportedFacts = summarized.unsupportedFacts;
      } catch (cause) {
        summary.error = cause instanceof Error ? cause.message : String(cause);
      }
    }

    const list = grouped.get(ref) ?? [];
    list.push(summary);
    grouped.set(ref, list);
  }

  const cases: CaseIterations[] = [...grouped.entries()]
    .map(([ref, iterations]) => ({ ref, iterations: iterations.sort((a, b) => a.iteration - b.iteration) }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const activeName = basename(fsTrace);
  const activeMatch = TRACE_FILE.exec(activeName);
  const active = activeMatch ? { ref: activeMatch[1], iteration: Number(activeMatch[2]) } : undefined;

  return { runFolder, runPath, cases, active };
}

interface ManifestCounts {
  completed?: number;
  timeout?: number;
  failed?: number;
}

async function readManifestCounts(runPath: string): Promise<ManifestCounts> {
  try {
    const raw = JSON.parse(await readFile(join(runPath, 'manifest.json'), 'utf8')) as unknown;
    const counts = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).counts : undefined;
    if (counts && typeof counts === 'object') {
      const record = counts as Record<string, unknown>;
      return {
        completed: typeof record.completed === 'number' ? record.completed : undefined,
        timeout: typeof record.timeout === 'number' ? record.timeout : undefined,
        failed: typeof record.failed === 'number' ? record.failed : undefined
      };
    }
  } catch {
    /* manifest is optional */
  }
  return {};
}

/** List inference run folders so the compare view can vary the run (model/config) permutation. */
export async function listRuns(inferenceRoot: string): Promise<RunSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(inferenceRoot);
  } catch {
    return [];
  }

  const summaries: RunSummary[] = [];
  for (const entry of entries) {
    const runPath = join(inferenceRoot, entry);
    let isDir = false;
    try {
      isDir = (await stat(runPath)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    let files: string[];
    try {
      files = await readdir(runPath);
    } catch {
      continue;
    }

    const refs = new Set<string>();
    let maxIteration = -1;
    let traceCount = 0;
    for (const file of files) {
      if (file.endsWith('.eval.json') || file.endsWith('.reviewed.json')) continue;
      const match = TRACE_FILE.exec(file);
      if (!match) continue;
      refs.add(match[1]);
      maxIteration = Math.max(maxIteration, Number(match[2]));
      traceCount += 1;
    }
    if (traceCount === 0) continue;

    const counts = await readManifestCounts(runPath);
    summaries.push({
      runFolder: entry,
      runPath,
      refs: [...refs].sort(),
      iterations: maxIteration + 1,
      traceCount,
      ...counts
    });
  }

  return summaries.sort((a, b) => a.runFolder.localeCompare(b.runFolder));
}

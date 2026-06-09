import { dirname } from 'node:path';
import type { AnnotationSaveRequest, AnnotationSaveResult, LoadedProject, ProjectLoadRequest, ReviewProfile, RunOverview, RunOverviewRequest, RunSummary, SearchHit } from '../shared/domain';
import { createAnnotation } from './annotation-targets';
import { defaultFixturePaths, inferenceRoot } from './paths';
import { loadReviewProfile } from './profile';
import { patchAnnotation } from './patching';
import { FileStorageConnector } from './storage/file-storage-connector';
import { collectSearchEntries, normalizeLoadedProject } from './normalizer';
import { buildRunOverview, listRuns } from './run-overview';
import { SqliteSearchCache } from './search/sqlite-cache';

interface ProjectState {
  profile: ReviewProfile;
  profilePath: string;
  tracePath: string;
  evalPath?: string;
  traceRaw: unknown;
  evalRaw?: unknown;
  project: LoadedProject;
}

const storage = new FileStorageConnector();
const searchCache = new SqliteSearchCache();
let state: ProjectState | undefined;

export function getDefaultPaths(): { profilePath: string; tracePath: string; evalPath: string } {
  return defaultFixturePaths();
}

export async function loadProject(request: ProjectLoadRequest): Promise<LoadedProject> {
  const profile = await loadReviewProfile(request.profilePath);
  const trace = await storage.readArtifact(request.tracePath);
  const evalArtifact = request.evalPath ? await storage.readArtifact(request.evalPath) : undefined;
  const traceRaw = JSON.parse(trace.text) as unknown;
  const evalRaw = evalArtifact ? (JSON.parse(evalArtifact.text) as unknown) : undefined;
  const project = normalizeLoadedProject({
    profile,
    traceUri: request.tracePath,
    evalUri: request.evalPath,
    traceRaw,
    evalRaw
  });
  await searchCache.replaceIndex(collectSearchEntries(profile, traceRaw, evalRaw));
  state = { profile, profilePath: request.profilePath, tracePath: request.tracePath, evalPath: request.evalPath, traceRaw, evalRaw, project };
  return project;
}

export async function searchProject(query: string): Promise<SearchHit[]> {
  return searchCache.search(query);
}

export async function getRunOverview(request: RunOverviewRequest): Promise<RunOverview> {
  const profile = await loadReviewProfile(request.profilePath);
  return buildRunOverview(profile, request.tracePath);
}

export async function getRuns(): Promise<RunSummary[]> {
  return listRuns(inferenceRoot());
}

/**
 * Load a project for read-only comparison without touching the active singleton state or the
 * shared search index, so side-by-side tiles never disturb the primary review/annotation session.
 */
export async function loadProjectView(request: ProjectLoadRequest): Promise<LoadedProject> {
  const profile = await loadReviewProfile(request.profilePath);
  const trace = await storage.readArtifact(request.tracePath);
  const evalArtifact = request.evalPath ? await storage.readArtifact(request.evalPath) : undefined;
  const traceRaw = JSON.parse(trace.text) as unknown;
  const evalRaw = evalArtifact ? (JSON.parse(evalArtifact.text) as unknown) : undefined;
  return normalizeLoadedProject({
    profile,
    traceUri: request.tracePath,
    evalUri: request.evalPath,
    traceRaw,
    evalRaw
  });
}

export async function saveAnnotation(request: AnnotationSaveRequest): Promise<AnnotationSaveResult> {
  if (!state) throw new Error('Load a project before saving annotations.');
  const targetRaw = request.artifactRole === 'eval' ? state.evalRaw : state.traceRaw;
  if (!targetRaw) throw new Error(`No ${request.artifactRole} artifact is loaded.`);
  const annotation = createAnnotation(targetRaw, request);
  const patchedTraceRaw = patchAnnotation(state.traceRaw, state.profile, annotation);
  const outputPath = request.outputPath ?? state.tracePath;
  await storage.writeArtifact(outputPath, `${JSON.stringify(patchedTraceRaw, null, 2)}\n`);
  const project = await loadProject({
    profilePath: state.profilePath,
    tracePath: outputPath,
    evalPath: state.evalPath
  });
  state = {
    profile: state.profile,
    profilePath: state.profilePath,
    tracePath: outputPath,
    evalPath: state.evalPath,
    traceRaw: patchedTraceRaw,
    evalRaw: state.evalRaw,
    project
  };
  return { outputPath, project };
}

export function reviewedCopyPath(sourcePath: string): string {
  return `${dirname(sourcePath)}/reviewed-${Date.now()}.json`;
}

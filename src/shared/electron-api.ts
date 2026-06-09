import type { AnnotationSaveRequest, AnnotationSaveResult, LoadedProject, ProjectLoadRequest, RunOverview, RunOverviewRequest, RunSummary, SearchHit } from './domain';

export interface VerityApi {
  getDefaultPaths(): Promise<{ profilePath: string; tracePath: string; evalPath: string }>;
  loadProject(request: ProjectLoadRequest): Promise<LoadedProject>;
  search(query: string): Promise<SearchHit[]>;
  getRunOverview(request: RunOverviewRequest): Promise<RunOverview>;
  listRuns(): Promise<RunSummary[]>;
  loadProjectView(request: ProjectLoadRequest): Promise<LoadedProject>;
  saveAnnotation(request: AnnotationSaveRequest): Promise<AnnotationSaveResult>;
}

declare global {
  interface Window {
    verity: VerityApi;
  }
}

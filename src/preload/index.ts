import { contextBridge, ipcRenderer } from 'electron';
import type { AnnotationSaveRequest, ProjectLoadRequest, RunOverviewRequest } from '../shared/domain';
import type { VerityApi } from '../shared/electron-api';

const api: VerityApi = {
  getDefaultPaths: () => ipcRenderer.invoke('paths:defaults'),
  loadProject: (request: ProjectLoadRequest) => ipcRenderer.invoke('project:load', request),
  search: (query: string) => ipcRenderer.invoke('project:search', query),
  getRunOverview: (request: RunOverviewRequest) => ipcRenderer.invoke('run:overview', request),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  loadProjectView: (request: ProjectLoadRequest) => ipcRenderer.invoke('project:loadView', request),
  saveAnnotation: (request: AnnotationSaveRequest) => ipcRenderer.invoke('annotation:save', request)
};

contextBridge.exposeInMainWorld('verity', api);

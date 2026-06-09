import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { getDefaultPaths, getRunOverview, getRuns, loadProject, loadProjectView, saveAnnotation, searchProject } from './project-service';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#0a0e16',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('paths:defaults', () => getDefaultPaths());
  ipcMain.handle('project:load', (_event, request) => loadProject(request));
  ipcMain.handle('project:search', (_event, query) => searchProject(query));
  ipcMain.handle('run:overview', (_event, request) => getRunOverview(request));
  ipcMain.handle('runs:list', () => getRuns());
  ipcMain.handle('project:loadView', (_event, request) => loadProjectView(request));
  ipcMain.handle('annotation:save', (_event, request) => saveAnnotation(request));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

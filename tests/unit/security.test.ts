import { readFile } from 'node:fs/promises';

describe('Electron security posture', () => {
  it('uses context isolation, disables renderer Node integration, and exposes typed preload methods', async () => {
    const mainSource = await readFile('src/main/index.ts', 'utf8');
    const preloadSource = await readFile('src/preload/index.ts', 'utf8');

    expect(mainSource).toContain('contextIsolation: true');
    expect(mainSource).toContain('nodeIntegration: false');
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld');
    expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preloadSource).not.toContain('send(channel');
  });
});

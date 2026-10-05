import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type { Api } from '../shared/types';
import { createBackend } from './core';

const here = path.dirname(fileURLToPath(import.meta.url));
const { store, ensemble, handlers } = createBackend(
  process.env.ENSEMBLE_DATA_DIR ?? app.getPath('userData'),
  path.join(here, 'ensemble-mcp.js'),
  () => broadcast(),
);

handlers.pickFolder = async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
};
handlers.pickFile = async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
};
handlers.openPath = (p) => shell.openPath(p);
ipcMain.handle('api', (_e, method: keyof Api, ...args: unknown[]) => handlers[method]?.(...args));

let pending: NodeJS.Timeout | null = null;
function broadcast() {
  nativeTheme.themeSource = store.data.settings.theme;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const state = ensemble.state();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state', state);
  }, 30);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Ensemble',
    webPreferences: { preload: path.join(here, '../preload/index.cjs') },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(here, '../renderer/index.html'));
  if (process.env.ENSEMBLE_SHOTS) void captureScreens(win, process.env.ENSEMBLE_SHOTS);
}

// Development aid: ENSEMBLE_SHOTS="out/dir|name=#/route,name2=#/route2" saves a PNG of each route and quits.
async function captureScreens(win: BrowserWindow, spec: string) {
  const [dir, list] = spec.split('|');
  fs.mkdirSync(dir, { recursive: true });
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
  for (const item of list.split(',')) {
    const [name, hash] = item.split('=');
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  app.quit();
}

app.whenReady().then(() => {
  nativeTheme.themeSource = store.data.settings.theme;
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  store.flush();
  if (process.platform !== 'darwin') app.quit();
});

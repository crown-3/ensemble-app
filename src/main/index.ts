import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type { Api } from '../shared/types';
import { runClaudeTurn } from './claude';
import { Ensemble } from './ensemble';
import { Store } from './store';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(process.env.ENSEMBLE_DATA_DIR ?? app.getPath('userData'));
const token = randomUUID();
let approvalUrl = '';

const ensemble = new Ensemble(
  store,
  ({ chatId, agentId, ...opts }) =>
    runClaudeTurn({
      ...opts,
      mcpConfig: {
        mcpServers: {
          ensemble: {
            command: process.execPath,
            args: [path.join(here, 'approval-mcp.js')],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              ENSEMBLE_APPROVAL_URL: approvalUrl,
              ENSEMBLE_TOKEN: token,
              ENSEMBLE_CHAT_ID: chatId,
              ENSEMBLE_AGENT_ID: agentId,
            },
          },
        },
      },
    }),
  () => broadcast(),
);

// Local endpoint the approval MCP bridge calls. Holds the request open until the user answers.
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(403).end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const { chatId, agentId, tool_name, input } = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'application/json' }).end(await ensemble.requestApproval(chatId, agentId, tool_name, input ?? {}));
  });
});
server.requestTimeout = 0; // approvals wait for the user, possibly for a long time
server.listen(0, '127.0.0.1', () => {
  approvalUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/approve`;
});

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

const handlers: { [K in keyof Api]?: (...args: any[]) => unknown } = {
  getState: () => ensemble.state(),
  saveAgent: (id, input) => ensemble.saveAgent(id, input),
  duplicateAgent: (id) => ensemble.duplicateAgent(id),
  deleteAgent: (id) => ensemble.deleteAgent(id),
  saveSettings: (patch) => ensemble.saveSettings(patch),
  pickFolder: async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  defaultFolder: () => {
    const dir = path.join(os.homedir(), 'Ensemble');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  openPath: (p) => shell.openPath(p),
  createChat: (input) => ensemble.createChat(input),
  sendMessage: (chatId, text) => ensemble.sendMessage(chatId, text),
  stopChat: (chatId) => ensemble.stopChat(chatId),
  inviteAgent: (chatId, agentId, scope) => ensemble.inviteAgent(chatId, agentId, scope),
  removeAgent: (chatId, agentId) => ensemble.removeAgent(chatId, agentId),
  setLeader: (chatId, agentId) => ensemble.setLeader(chatId, agentId),
  setChatApproval: (chatId, mode) => ensemble.setChatApproval(chatId, mode),
  answerApproval: (chatId, id, answer) => ensemble.answerApproval(chatId, id, answer),
  markRead: (chatId) => ensemble.markRead(chatId),
};
ipcMain.handle('api', (_e, method: keyof Api, ...args: unknown[]) => handlers[method]?.(...args));

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

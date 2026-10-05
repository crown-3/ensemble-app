// Backend shared by the Electron app (index.ts) and the browser mode (web.ts).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Api } from '../shared/types';
import { authStatus } from './auth';
import { type McpServer, readClaudeUsage, runClaudeTurn } from './claude';
import { readCodexUsage, runCodexTurn } from './codex';
import { Ensemble } from './ensemble';
import { Store } from './store';

const USAGE_CHECK_MS = 5 * 60 * 1000;

export type Handlers = { [K in keyof Api]?: (...args: any[]) => unknown };

// mcpScript: path to the built ensemble-mcp.js (entries pass it because shared code is bundled into a chunk).
export function createBackend(dataDir: string, mcpScript: string, onChange: () => void) {
  const store = new Store(dataDir);
  const token = randomUUID();
  let serverUrl = '';

  // The Ensemble MCP server, as each CLI should launch it for one agent in one chat.
  const mcpServer = (chatId: string, agentId: string, tools: string[]): McpServer => ({
    // Under Electron, execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it act as node.
    command: process.execPath,
    args: [mcpScript],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      ENSEMBLE_URL: serverUrl,
      ENSEMBLE_TOKEN: token,
      ENSEMBLE_CHAT_ID: chatId,
      ENSEMBLE_AGENT_ID: agentId,
      ENSEMBLE_TOOLS: tools.join(','),
    },
  });

  const ensemble: Ensemble = new Ensemble(
    store,
    ({ chatId, agentId, provider, approvalMode, memory, ...opts }) =>
      provider === 'codex'
        ? runCodexTurn({
            ...opts,
            approvalMode,
            // Codex asks for approval through app-server requests, so it only needs the memory tools.
            mcpServer: memory ? mcpServer(chatId, agentId, ['memory']) : undefined,
            requestApproval: async (toolName, input) =>
              JSON.parse(await ensemble.requestApproval(chatId, agentId, toolName, input)).behavior === 'allow',
          })
        : runClaudeTurn({
            ...opts,
            memory,
            mcpConfig: { mcpServers: { ensemble: mcpServer(chatId, agentId, memory ? ['approve', 'memory'] : ['approve']) } },
          }),
    onChange,
  );

  // Local endpoint the Ensemble MCP server calls. /approve holds the request open until the user answers.
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const { chatId, agentId, ...args } = JSON.parse(body);
      if (req.url === '/approve') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(await ensemble.requestApproval(chatId, agentId, args.tool_name, args.input ?? {}));
      } else if (req.url === '/memory') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(ensemble.memoryTool(chatId, agentId, args.tool, args));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  server.requestTimeout = 0; // approvals wait for the user, possibly for a long time
  server.listen(0, '127.0.0.1', () => {
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  // Usage is otherwise only known after a turn. Check when a window asks for state (app opened,
  // page reloaded), at most once per USAGE_CHECK_MS; turns keep it fresh in between.
  let usageCheckedAt = 0;
  const refreshUsage = () => {
    if (Date.now() - usageCheckedAt < USAGE_CHECK_MS) return;
    usageCheckedAt = Date.now();
    const claude = readClaudeUsage();
    if (claude) ensemble.setUsage('claude', claude.usage, claude.at);
    const started = Date.now();
    readCodexUsage().then((u) => u && ensemble.setUsage('codex', u, started));
  };

  const handlers: Handlers = {
    getState: () => {
      refreshUsage();
      return ensemble.state();
    },
    saveAgent: (id, input) => ensemble.saveAgent(id, input),
    duplicateAgent: (id) => ensemble.duplicateAgent(id),
    deleteAgent: (id) => ensemble.deleteAgent(id),
    saveSettings: (patch) => ensemble.saveSettings(patch),
    defaultFolder: () => {
      const dir = path.join(os.homedir(), 'Ensemble');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    createProject: (input) => ensemble.createProject(input),
    updateProject: (id, patch) => ensemble.updateProject(id, patch),
    deleteProject: (id) => ensemble.deleteProject(id),
    saveMemory: (projectId, agentId, id, content) => ensemble.saveMemory(projectId, agentId, id, content),
    deleteMemory: (id) => ensemble.deleteMemory(id),
    createChat: (input) => ensemble.createChat(input),
    sendMessage: (chatId, text) => ensemble.sendMessage(chatId, text),
    stopChat: (chatId) => ensemble.stopChat(chatId),
    inviteAgent: (chatId, agentId, scope) => ensemble.inviteAgent(chatId, agentId, scope),
    removeAgent: (chatId, agentId) => ensemble.removeAgent(chatId, agentId),
    setLeader: (chatId, agentId) => ensemble.setLeader(chatId, agentId),
    setChatApproval: (chatId, mode) => ensemble.setChatApproval(chatId, mode),
    answerApproval: (chatId, id, answer) => ensemble.answerApproval(chatId, id, answer),
    markRead: (chatId) => ensemble.markRead(chatId),
    authStatus,
  };

  return { store, ensemble, handlers };
}

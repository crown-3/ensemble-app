// Backend shared by the Electron app (index.ts) and the browser mode (web.ts).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Api } from '../shared/types';
import { runClaudeTurn } from './claude';
import { runCodexTurn } from './codex';
import { Ensemble } from './ensemble';
import { Store } from './store';

export type Handlers = { [K in keyof Api]?: (...args: any[]) => unknown };

// approvalScript: path to the built approval-mcp.js (entries pass it because shared code is bundled into a chunk).
export function createBackend(dataDir: string, approvalScript: string, onChange: () => void) {
  const store = new Store(dataDir);
  const token = randomUUID();
  let approvalUrl = '';

  const ensemble = new Ensemble(
    store,
    ({ chatId, agentId, provider, approvalMode, ...opts }) =>
      provider === 'codex' ? runCodexTurn({ ...opts, approvalMode }) : runClaudeTurn({
        ...opts,
        mcpConfig: {
          mcpServers: {
            ensemble: {
              // Under Electron, execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it act as node.
              command: process.execPath,
              args: [approvalScript],
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
    onChange,
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

  const handlers: Handlers = {
    getState: () => ensemble.state(),
    saveAgent: (id, input) => ensemble.saveAgent(id, input),
    duplicateAgent: (id) => ensemble.duplicateAgent(id),
    deleteAgent: (id) => ensemble.deleteAgent(id),
    saveSettings: (patch) => ensemble.saveSettings(patch),
    defaultFolder: () => {
      const dir = path.join(os.homedir(), 'Ensemble');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
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

  return { store, ensemble, handlers };
}

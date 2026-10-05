// Runs one agent turn with the Codex app server (`codex app-server`, JSON-RPC over stdio) and
// translates its notifications into the same events as claude.ts.
// Codex asks for approval only when an action needs more than its sandbox allows, so the
// approval mode picks the sandbox: ask-all is read-only (every write asks), auto-edits can write
// inside the folder (commands that need more ask), auto-all never asks and stays in the folder.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { CODEX_DEFAULT_MODEL } from '../shared/models';
import type { ChatApprovalMode, Usage } from '../shared/types';
import type { McpServer, TurnEvent } from './claude';
import { isInside } from './rules';

export type CodexTurnOptions = {
  cwd: string;
  model: string;
  sessionId?: string;
  systemPrompt: string;
  prompt: string;
  approvalMode: ChatApprovalMode;
  mcpServer?: McpServer; // the Ensemble MCP server with the memory tools (project chats)
  // Shows an approval card in the chat; resolves true when the user (or the chat mode) allows it.
  requestApproval: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  onEvent: (e: TurnEvent) => void;
};

type Rpc = {
  request: (method: string, params?: unknown) => Promise<any>;
  kill: () => void;
  exited: Promise<string>; // resolves with the stderr tail when the process ends
};

// Starts `codex app-server` and does the initialize handshake.
function startAppServer(
  cwd: string,
  onNotification: (method: string, params: any) => void,
  onRequest: (method: string, params: any) => Promise<unknown>,
): Rpc {
  const child = spawn('codex', [
    'app-server',
    // workspace-write also opens /tmp and $TMPDIR by default; keep writes inside the work folder.
    '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
    '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
  ], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

  let nextId = 0;
  const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  const send = (m: object) => child.stdin.writable && child.stdin.write(JSON.stringify(m) + '\n');
  let stderr = '';
  let failure: Error | null = null;

  const exited = new Promise<string>((resolve) => {
    child.on('error', (e: NodeJS.ErrnoException) => {
      failure = new Error(e.code === 'ENOENT' ? 'codex CLI를 찾을 수 없습니다. Codex를 설치하고 로그인하세요.' : e.message);
    });
    child.on('close', () => {
      const err = failure ?? new Error(stderr.trim().split('\n').slice(-3).join('\n') || 'codex가 종료되었습니다.');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      resolve(err.message);
    });
  });

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.method && m.id != null) {
        onRequest(m.method, m.params).then(
          (result) => send({ id: m.id, result }),
          (e: Error) => send({ id: m.id, error: { code: -32601, message: e.message } }),
        );
      } else if (m.method) {
        onNotification(m.method, m.params);
      } else if (pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));

  const request = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const ready = request('initialize', { clientInfo: { name: 'ensemble', version: '0.1.0' } }).then(() => send({ method: 'initialized' }));
  return {
    request: (method, params) => ready.then(() => request(method, params)),
    kill: () => child.kill('SIGTERM'),
    exited,
  };
}

function toUsage(rateLimits: any): Usage | null {
  const primary = rateLimits?.primary; // the 5-hour window
  return typeof primary?.usedPercent === 'number' ? { utilization: primary.usedPercent / 100, resetsAt: primary.resetsAt ?? undefined } : null;
}

export function runCodexTurn(opts: CodexTurnOptions): { done: Promise<void>; kill: () => void } {
  const sandbox = opts.approvalMode === 'ask-all' ? 'read-only' : 'workspace-write';
  const approvalPolicy = opts.approvalMode === 'auto-all' ? 'never' : 'on-request';
  const fileChanges = new Map<string, string[]>(); // item id -> absolute paths, for approval cards
  let lastEventAt = Date.now();
  let lastError = '';
  let finish!: (err: string | null) => void;
  const finished = new Promise<string | null>((r) => (finish = r));

  const onNotification = (method: string, params: any) => {
    const item = params?.item ?? {};
    if (method === 'item/started' && item.type === 'fileChange') {
      fileChanges.set(item.id, (item.changes ?? []).map((c: any) => path.resolve(opts.cwd, c.path)));
    } else if (method === 'item/completed') {
      if (item.type === 'reasoning') {
        opts.onEvent({ type: 'thinking', seconds: Math.max(1, Math.round((Date.now() - lastEventAt) / 1000)) });
      } else if (item.type === 'agentMessage' && item.text?.trim()) {
        opts.onEvent({ type: 'text', text: item.text.trim() });
      } else if (item.type === 'fileChange' && item.status === 'completed') {
        for (const c of item.changes ?? []) {
          const kind = c.kind?.type;
          if (kind === 'add' || kind === 'update') {
            opts.onEvent({ type: 'file', path: path.resolve(opts.cwd, c.kind.move_path ?? c.path), action: kind === 'add' ? 'created' : 'modified' });
          }
        }
      }
    } else if (method === 'account/rateLimits/updated') {
      const usage = toUsage(params.rateLimits);
      if (usage) opts.onEvent({ type: 'usage', ...usage });
    } else if (method === 'error' && !params?.willRetry) {
      lastError = params?.error?.message ?? '';
    } else if (method === 'turn/completed') {
      const turn = params.turn ?? {};
      finish(turn.status === 'failed' ? turn.error?.message || lastError || 'Codex 작업이 실패했습니다.' : null);
    }
    lastEventAt = Date.now();
  };

  const onRequest = async (method: string, params: any) => {
    if (method === 'item/commandExecution/requestApproval') {
      const ok = await opts.requestApproval('Bash', { command: params.command ?? params.reason ?? '' });
      return { decision: ok ? 'accept' : 'decline' };
    }
    if (method === 'item/fileChange/requestApproval') {
      const paths = fileChanges.get(params.itemId) ?? [];
      // Show (and check) a path outside the folder first, so it cannot hide behind an inside one.
      const target = paths.find((p) => !isInside(p, opts.cwd)) ?? paths[0] ?? params.grantRoot ?? '';
      const ok = await opts.requestApproval('Write', { file_path: target });
      return { decision: ok ? 'accept' : 'decline' };
    }
    throw new Error(`Ensemble does not handle ${method}`);
  };

  const rpc = startAppServer(opts.cwd, onNotification, onRequest);
  let killed = false;

  const done = (async () => {
    const threadParams = {
      cwd: opts.cwd,
      sandbox,
      approvalPolicy,
      developerInstructions: opts.systemPrompt,
      ...(opts.model && opts.model !== CODEX_DEFAULT_MODEL ? { model: opts.model } : {}),
      // The agent's own memory tools need no approval card.
      ...(opts.mcpServer ? { config: { mcp_servers: { ensemble: { ...opts.mcpServer, default_tools_approval_mode: 'approve' } } } } : {}),
    };
    try {
      const { thread } = opts.sessionId
        ? await rpc.request('thread/resume', { threadId: opts.sessionId, ...threadParams })
        : await rpc.request('thread/start', threadParams);
      opts.onEvent({ type: 'session', id: thread.id });
      await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: opts.prompt }] });
      const err = await Promise.race([finished, rpc.exited]);
      if (err && !killed) throw new Error(err);
    } catch (e) {
      if (!killed) throw e;
    } finally {
      rpc.kill();
    }
  })();

  return {
    done,
    kill: () => {
      killed = true;
      finish(null);
      rpc.kill();
    },
  };
}

// Current 5-hour usage without running a turn (shown when the app opens).
export async function readCodexUsage(): Promise<Usage | null> {
  const rpc = startAppServer(os.homedir(), () => {}, async () => {
    throw new Error('unexpected request');
  });
  const timeout = setTimeout(rpc.kill, 15000);
  try {
    return toUsage((await rpc.request('account/rateLimits/read')).rateLimits);
  } catch {
    return null; // not installed, not logged in, or no limits for this account
  } finally {
    clearTimeout(timeout);
    rpc.kill();
  }
}

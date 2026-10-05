// Runs one agent turn with the Codex CLI (`codex exec --json`) and translates its JSONL output
// into the same events as claude.ts. Codex has no permission prompt tool, so the approval
// mode picks a sandbox instead: ask-all can only read, the other modes can write inside the folder.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CODEX_DEFAULT_MODEL } from '../shared/models';
import type { ChatApprovalMode } from '../shared/types';
import type { TurnEvent } from './claude';

export type CodexTurnOptions = {
  cwd: string;
  model: string;
  sessionId?: string;
  systemPrompt: string;
  prompt: string;
  approvalMode: ChatApprovalMode;
  onEvent: (e: TurnEvent) => void;
};

export function runCodexTurn(opts: CodexTurnOptions): { done: Promise<void>; kill: () => void } {
  const sandbox = opts.approvalMode === 'ask-all' ? 'read-only' : 'workspace-write';
  const args = [
    'exec',
    ...(opts.sessionId ? ['resume', opts.sessionId] : []),
    '--json',
    '--skip-git-repo-check',
    '-c', `sandbox_mode="${sandbox}"`,
    // workspace-write also opens /tmp and $TMPDIR by default; keep writes inside the work folder.
    '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
    '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    '-c', 'approval_policy="never"',
    '-c', `developer_instructions=${JSON.stringify(opts.systemPrompt)}`,
    ...(opts.model && opts.model !== CODEX_DEFAULT_MODEL ? ['-m', opts.model] : []),
    '-',
  ];

  const child = spawn('codex', args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(opts.prompt);

  let lastEventAt = Date.now();
  let stderr = '';
  let lastError = '';
  let turnError: string | null = null;

  const handle = (msg: any) => {
    if (msg.type === 'thread.started') {
      opts.onEvent({ type: 'session', id: msg.thread_id });
    } else if (msg.type === 'item.completed') {
      const item = msg.item ?? {};
      if (item.type === 'reasoning') {
        opts.onEvent({ type: 'thinking', seconds: Math.max(1, Math.round((Date.now() - lastEventAt) / 1000)) });
      } else if (item.type === 'agent_message' && item.text?.trim()) {
        opts.onEvent({ type: 'text', text: item.text.trim() });
      } else if (item.type === 'file_change' && item.status === 'completed') {
        for (const c of item.changes ?? []) {
          if (c.kind === 'add' || c.kind === 'update') {
            opts.onEvent({ type: 'file', path: path.resolve(opts.cwd, c.path), action: c.kind === 'add' ? 'created' : 'modified' });
          }
        }
      }
    } else if (msg.type === 'turn.failed') {
      turnError = msg.error?.message || 'Codex 작업이 실패했습니다.';
    } else if (msg.type === 'error') {
      // Mostly retry notices ("Reconnecting..."); only kept to explain a failed exit.
      lastError = msg.message ?? '';
    }
    lastEventAt = Date.now();
  };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        // not JSON (warnings); ignore
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));

  let killed = false;
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'ENOENT' ? 'codex CLI를 찾을 수 없습니다. Codex를 설치하고 로그인하세요.' : e.message)),
    );
    child.on('close', (code) => {
      if (killed) resolve();
      else if (turnError) reject(new Error(turnError));
      else if (code !== 0) reject(new Error(lastError || stderr.trim().split('\n').slice(-3).join('\n') || `codex가 코드 ${code}로 종료되었습니다.`));
      else resolve();
    });
  });

  return {
    done,
    kill: () => {
      killed = true;
      child.kill('SIGTERM');
    },
  };
}

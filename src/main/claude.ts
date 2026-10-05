// Runs one agent turn with the Claude Code CLI and translates its stream-json output
// into Ensemble events.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type TurnEvent =
  | { type: 'session'; id: string }
  | { type: 'thinking'; seconds: number }
  | { type: 'text'; text: string }
  | { type: 'file'; path: string; action: 'created' | 'modified' }
  | { type: 'usage'; utilization: number; resetsAt?: number };

export type TurnOptions = {
  cwd: string;
  model: string;
  sessionId?: string;
  systemPrompt: string;
  prompt: string;
  mcpConfig: object;
  onEvent: (e: TurnEvent) => void;
};

const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit'];
const FILE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

export function runClaudeTurn(opts: TurnOptions): { done: Promise<void>; kill: () => void } {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', opts.model,
    '--permission-mode', 'default',
    '--setting-sources', '',
    '--tools', TOOLS.join(','),
    '--mcp-config', JSON.stringify(opts.mcpConfig),
    '--strict-mcp-config',
    '--permission-prompt-tool', 'mcp__ensemble__approve',
    '--append-system-prompt', opts.systemPrompt,
  ];
  if (opts.sessionId) args.push('--resume', opts.sessionId);

  const child = spawn('claude', args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(opts.prompt);

  // tool_use id -> file change it will make once the tool succeeds
  const pendingFiles = new Map<string, { path: string; action: 'created' | 'modified' }>();
  let lastEventAt = Date.now();
  let stderr = '';
  let resultError: string | null = null;

  const handle = (msg: any) => {
    if (msg.type === 'system' && msg.subtype === 'init') {
      opts.onEvent({ type: 'session', id: msg.session_id });
    } else if (msg.type === 'rate_limit_event') {
      const info = msg.rate_limit_info?.unifiedWindows?.five_hour;
      if (info) opts.onEvent({ type: 'usage', utilization: info.utilization, resetsAt: info.resetsAt });
    } else if (msg.type === 'assistant' && msg.parent_tool_use_id == null) {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'thinking') {
          opts.onEvent({ type: 'thinking', seconds: Math.max(1, Math.round((Date.now() - lastEventAt) / 1000)) });
        } else if (block.type === 'text' && block.text.trim()) {
          opts.onEvent({ type: 'text', text: block.text.trim() });
        } else if (block.type === 'tool_use' && FILE_TOOLS.includes(block.name)) {
          const file = block.input?.file_path ?? block.input?.notebook_path;
          if (typeof file === 'string') {
            const abs = path.resolve(opts.cwd, file);
            pendingFiles.set(block.id, { path: abs, action: fs.existsSync(abs) ? 'modified' : 'created' });
          }
        }
      }
    } else if (msg.type === 'user') {
      for (const block of msg.message?.content ?? []) {
        if (block.type !== 'tool_result') continue;
        const change = pendingFiles.get(block.tool_use_id);
        pendingFiles.delete(block.tool_use_id);
        if (change && !block.is_error) opts.onEvent({ type: 'file', ...change });
      }
    } else if (msg.type === 'result' && msg.is_error) {
      resultError = msg.result || msg.subtype;
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
      reject(new Error(e.code === 'ENOENT' ? 'claude CLI를 찾을 수 없습니다. Claude Code를 설치하고 로그인하세요.' : e.message)),
    );
    child.on('close', (code) => {
      if (killed) resolve();
      else if (resultError) reject(new Error(resultError));
      else if (code !== 0) reject(new Error(stderr.trim().split('\n').slice(-3).join('\n') || `claude가 코드 ${code}로 종료되었습니다.`));
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

// Login status of each CLI, from their own status commands.
// `claude auth status` prints JSON with loggedIn; `codex login status` exits 1 when logged out.
import { execFile } from 'node:child_process';
import type { AuthStatus, LoginState } from '../shared/types';

function run(cmd: string, args: string[]): Promise<{ code: number | 'ENOENT'; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      resolve({ code: code === 'ENOENT' ? 'ENOENT' : typeof code === 'number' ? code : err ? 1 : 0, stdout });
    });
  });
}

async function claude(): Promise<LoginState> {
  const r = await run('claude', ['auth', 'status']);
  if (r.code === 'ENOENT') return 'missing';
  try {
    return JSON.parse(r.stdout).loggedIn ? 'in' : 'out';
  } catch {
    return 'out';
  }
}

async function codex(): Promise<LoginState> {
  const r = await run('codex', ['login', 'status']);
  return r.code === 'ENOENT' ? 'missing' : r.code === 0 ? 'in' : 'out';
}

export async function authStatus(): Promise<AuthStatus> {
  const [c, x] = await Promise.all([claude(), codex()]);
  return { claude: c, codex: x };
}

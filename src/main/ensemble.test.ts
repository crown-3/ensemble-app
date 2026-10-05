import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe as group, expect, it } from 'vitest';
import { findMentions, splitMentions } from '../shared/mentions';
import type { Agent, Chat } from '../shared/types';
import type { TurnEvent } from './claude';
import { readCodexUsage, runCodexTurn } from './codex';
import { Ensemble, type RunTurn } from './ensemble';
import { decide, effectiveMode } from './rules';
import { Store } from './store';

group('mentions', () => {
  it('matches names followed by Korean particles', () => {
    expect(findMentions('@서윤이 방향을 정하고 @도윤이 작성해 줘', ['서윤', '도윤'])).toEqual(['서윤', '도윤']);
  });
  it('prefers the longest name and ignores unknown names and emails', () => {
    expect(findMentions('@서윤아 @모름 a@서윤', ['서윤', '서윤아'])).toEqual(['서윤아']);
  });
  it('splits text into segments', () => {
    expect(splitMentions('hi @도윤!', ['도윤'])).toEqual([{ text: 'hi ' }, { text: '@도윤', mention: '도윤' }, { text: '!' }]);
  });
});

group('approval rules', () => {
  const folder = '/work/p';
  it('denies paths outside the work folder in every mode', () => {
    expect(decide('Read', { file_path: '/etc/passwd' }, 'auto-all', folder).kind).toBe('deny');
    expect(decide('Write', { file_path: '../x.md' }, 'auto-all', folder).kind).toBe('deny');
  });
  it('applies the chat mode', () => {
    expect(decide('Write', { file_path: 'a.md' }, 'ask-all', folder).kind).toBe('ask');
    expect(decide('Write', { file_path: 'a.md' }, 'auto-edits', folder).kind).toBe('allow');
    expect(decide('Bash', { command: 'ls' }, 'auto-edits', folder).kind).toBe('ask');
    expect(decide('Bash', { command: 'ls' }, 'auto-all', folder).kind).toBe('allow');
  });
  it('lets the agent setting override the chat setting', () => {
    const chat = { approvalMode: 'auto-all', alwaysApproveAgentIds: [] } as unknown as Chat;
    expect(effectiveMode({ id: 'a', approvalMode: 'always-ask' } as Agent, chat)).toBe('ask-all');
    expect(effectiveMode({ id: 'a', approvalMode: 'inherit' } as Agent, chat)).toBe('auto-all');
  });
});

// A fake CLI: each agent replies with a scripted list of events per turn.
function setup(script: Record<string, TurnEvent[][]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-test-'));
  const calls: { agent: string; prompt: string; sessionId?: string; system: string; memory: boolean; cwd: string }[] = [];
  let app!: Ensemble;
  const runTurn: RunTurn = (opts) => {
    const name = app.data.agents.find((a) => a.id === opts.agentId)!.name;
    calls.push({ agent: name, prompt: opts.prompt, sessionId: opts.sessionId, system: opts.systemPrompt, memory: opts.memory, cwd: opts.cwd });
    const events = script[name]?.shift() ?? [];
    const done = (async () => {
      opts.onEvent({ type: 'session', id: `s-${name}` });
      for (const e of events) {
        await Promise.resolve();
        opts.onEvent(e);
      }
    })();
    return { done, kill: () => {} };
  };
  app = new Ensemble(new Store(dir), runTurn, () => {});
  const base = { title: '직원', provider: 'claude' as const, model: 'claude-opus-5-5', persona: '', approvalMode: 'inherit' as const };
  const ids = Object.fromEntries(['서윤', '도윤', '한서'].map((name) => [name, app.saveAgent(null, { ...base, name })]));
  const idle = async () => {
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { app, ids, calls, idle, dir };
}

group('turn loop', () => {
  it('sends an unmentioned message to the leader only', async () => {
    const { app, ids, calls, idle, dir } = setup({ 서윤: [[{ type: 'text', text: '네' }]] });
    app.createChat({ projectId: null, agentIds: [ids['서윤'], ids['도윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '안녕' });
    await idle();
    expect(calls.map((c) => c.agent)).toEqual(['서윤']);
  });

  it('sends a mentioned message to the mentioned members in order', async () => {
    const { app, ids, calls, idle, dir } = setup({});
    app.createChat({ projectId: null, agentIds: [ids['서윤'], ids['도윤'], ids['한서']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '@한서 @도윤 부탁해' });
    await idle();
    expect(calls.map((c) => c.agent)).toEqual(['한서', '도윤']);
  });

  it('chains agent-to-agent mentions and passes only unseen messages', async () => {
    const { app, ids, calls, idle, dir } = setup({
      서윤: [[{ type: 'text', text: '@도윤 초안 써 주세요' }], [{ type: 'text', text: '좋습니다' }]],
      도윤: [[{ type: 'text', text: '@서윤 확인해 주세요' }]],
    });
    const chatId = app.createChat({ projectId: null, agentIds: [ids['서윤'], ids['도윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '카피 써 줘' });
    await idle();
    expect(calls.map((c) => c.agent)).toEqual(['서윤', '도윤', '서윤']);
    expect(calls[1].prompt).toContain('[사용자] 카피 써 줘');
    expect(calls[1].prompt).toContain('[서윤 · 직원] @도윤 초안 써 주세요');
    // 서윤's second turn resumes its session and gets only 도윤's reply, not its own message again.
    expect(calls[2].sessionId).toBe('s-서윤');
    expect(calls[2].prompt).toBe('[도윤 · 직원] @서윤 확인해 주세요');
    expect(app.data.chats.find((c) => c.id === chatId)!.messages.map((m) => m.kind)).toEqual(['user', 'agent', 'agent', 'agent']);
  });

  it('gives an agent invited "from now" only messages after the invite', async () => {
    const { app, ids, calls, idle, dir } = setup({});
    const chatId = app.createChat({ projectId: null, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '비밀 이야기' });
    await idle();
    app.inviteAgent(chatId, ids['한서'], 'from-now');
    app.sendMessage(chatId, '@한서 안녕');
    await idle();
    const last = calls.at(-1)!;
    expect(last.agent).toBe('한서');
    expect(last.prompt).not.toContain('비밀');
    expect(last.prompt).toContain('[사용자] @한서 안녕');
  });

  it('records created files in the agent history', async () => {
    const { app, ids, idle, dir } = setup({ 서윤: [[{ type: 'file', path: path.join('/x', 'a.md'), action: 'created' }]] });
    app.createChat({ projectId: null, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '파일 만들어' });
    await idle();
    expect(app.data.agents[0].history[0]).toMatchObject({ source: 'auto', content: "'파일 만들어' 채팅에서 a.md 파일을 만듦" });
  });

  it('holds a permission request until the user answers', async () => {
    const { app, ids, dir } = setup({});
    const chatId = app.createChat({ projectId: null, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '' });
    const answer = app.requestApproval(chatId, ids['서윤'], 'Write', { file_path: 'a.md', content: 'x' });
    const card = app.data.chats[0].messages.at(-1)!;
    expect(card).toMatchObject({ kind: 'approval', status: 'pending' });
    app.answerApproval(chatId, card.id, 'always');
    expect(JSON.parse(await answer)).toMatchObject({ behavior: 'allow' });
    // "always" auto-approves this agent's next request in this chat.
    expect(JSON.parse(await app.requestApproval(chatId, ids['서윤'], 'Bash', { command: 'ls' }))).toMatchObject({ behavior: 'allow' });
  });
});

group('projects and memory', () => {
  it('runs project chats in the project folder with its instructions, reference files and the agent memory', async () => {
    const { app, ids, calls, idle, dir } = setup({});
    const projectId = app.createProject({ name: '리뉴얼', description: '', folderPath: dir });
    app.updateProject(projectId, { instructions: '한국어로 씁니다', referenceFiles: ['/refs/guide.md'] });
    app.saveMemory(projectId, ids['서윤'], null, '톤은 차분하게');
    app.saveMemory(projectId, ids['도윤'], null, '도윤만 아는 것');
    const chatId = app.createChat({ projectId, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: '/elsewhere', firstMessage: '시작' });
    await idle();
    expect(app.data.chats.find((c) => c.id === chatId)).toMatchObject({ projectId, folderPath: dir });
    const { system, memory, cwd } = calls[0];
    expect([memory, cwd]).toEqual([true, dir]);
    expect(system).toContain('# 프로젝트 지침\n한국어로 씁니다');
    expect(system).toContain('- /refs/guide.md');
    expect(system).toContain('톤은 차분하게');
    expect(system).not.toContain('도윤만 아는 것');
    // Reference files may be read even though they are outside the folder; nothing else there may.
    expect(JSON.parse(await app.requestApproval(chatId, ids['서윤'], 'Read', { file_path: '/refs/guide.md' }))).toMatchObject({ behavior: 'allow' });
    expect(JSON.parse(await app.requestApproval(chatId, ids['서윤'], 'Write', { file_path: '/refs/guide.md' }))).toMatchObject({ behavior: 'deny' });
  });

  it('offers no memory outside a project', async () => {
    const { app, ids, calls, idle, dir } = setup({});
    const chatId = app.createChat({ projectId: null, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '시작' });
    await idle();
    expect(calls[0].memory).toBe(false);
    expect(calls[0].system).not.toContain('프로젝트 메모리');
    expect(app.memoryTool(chatId, ids['서윤'], 'memory_save', { content: 'x' })).toContain('프로젝트에 속하지 않아');
    expect(app.data.memories).toEqual([]);
  });

  it('lets an agent save, update and delete only its own memory, and tells the chat', () => {
    const { app, ids, dir } = setup({});
    const projectId = app.createProject({ name: 'P', description: '', folderPath: dir });
    const chatId = app.createChat({ projectId, agentIds: [ids['서윤'], ids['도윤']], leaderAgentId: ids['서윤'], folderPath: '', firstMessage: '' });
    app.memoryTool(chatId, ids['서윤'], 'memory_save', { content: '헤드라인은 20자 이내' });
    const entry = app.data.memories[0];
    expect(entry).toMatchObject({ agentId: ids['서윤'], projectId, source: { chatId } });
    expect(app.memoryTool(chatId, ids['도윤'], 'memory_update', { id: entry.id, content: '가로채기' })).toContain('없습니다');
    app.memoryTool(chatId, ids['서윤'], 'memory_update', { id: entry.id, content: '헤드라인은 15자 이내' });
    expect(app.data.memories[0].content).toBe('헤드라인은 15자 이내');
    app.memoryTool(chatId, ids['서윤'], 'memory_delete', { id: entry.id });
    expect(app.data.memories).toEqual([]);
    const notes = app.data.chats[0].messages.filter((m) => m.kind === 'system').map((m) => (m as { text: string }).text);
    expect(notes).toEqual(['서윤이(가) 기억함: 헤드라인은 20자 이내', '서윤이(가) 기억을 고침: 헤드라인은 15자 이내', '서윤이(가) 기억을 지움: 헤드라인은 15자 이내']);
  });

  it('moves project chats to a new folder with fresh sessions', async () => {
    const { app, ids, calls, idle, dir } = setup({ 서윤: [[{ type: 'text', text: '네' }]] });
    const projectId = app.createProject({ name: 'P', description: '', folderPath: dir });
    const chatId = app.createChat({ projectId, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: '', firstMessage: '첫 메시지' });
    await idle();
    app.updateProject(projectId, { folderPath: '/new/place' });
    app.sendMessage(chatId, '두 번째');
    await idle();
    const last = calls.at(-1)!;
    expect([last.cwd, last.sessionId]).toEqual(['/new/place', undefined]); // a fresh session, not a resume
    expect(last.prompt).toContain('[사용자] 첫 메시지'); // which gets the earlier conversation again
  });

  it('deletes a project with its chats and memories', () => {
    const { app, ids, dir } = setup({});
    const projectId = app.createProject({ name: 'P', description: '', folderPath: dir });
    app.createChat({ projectId, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: '', firstMessage: '' });
    const other = app.createChat({ projectId: null, agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '' });
    app.saveMemory(projectId, ids['서윤'], null, '기억');
    app.deleteProject(projectId);
    expect([app.data.projects, app.data.memories, app.data.chats.map((c) => c.id)]).toEqual([[], [], [other]]);
  });
});

group('codex adapter', () => {
  // A fake `codex app-server` on PATH. It answers the handshake, records every message it receives,
  // and on turn/start plays a script: plain entries are sent as notifications, `{ request }` entries
  // as approval requests whose answer it waits for.
  function fakeCodex(script: object[]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-codex-'));
    const src = `#!/usr/bin/env node
const fs = require('fs');
const log = (m) => fs.appendFileSync(${JSON.stringify(path.join(dir, 'received.jsonl'))}, JSON.stringify(m) + '\\n');
fs.writeFileSync(${JSON.stringify(path.join(dir, 'args'))}, process.argv.slice(2).join('\\n'));
const script = ${JSON.stringify(script)};
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
let waiting = null;
async function play() {
  for (const step of script) {
    if (step.request) {
      await new Promise((r) => { waiting = r; send({ id: 'r1', method: step.request, params: step.params }); });
    } else send(step);
  }
}
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
    log(m);
    if (m.id === 'r1') { waiting(); continue; }
    if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 't1' } } });
    else if (m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: m.params.threadId } } });
    else if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: 'u1' } } }); play(); }
    else if (m.method === 'account/rateLimits/read') send({ id: m.id, result: { rateLimits: { primary: { usedPercent: 42, resetsAt: 100 } } } });
    else if (m.id != null) send({ id: m.id, result: {} });
  }
});
`;
    fs.writeFileSync(path.join(dir, 'codex'), src, { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
    return {
      dir,
      args: () => fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\n'),
      received: () => fs.readFileSync(path.join(dir, 'received.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)),
      restore: () => (process.env.PATH = oldPath),
    };
  }
  const turnOpts = { model: 'default', systemPrompt: 'sys', prompt: 'hi', requestApproval: async () => true, onEvent: () => {} };

  it.skipIf(process.platform === 'win32')('maps app-server notifications and picks the sandbox from the approval mode', async () => {
    const fake = fakeCodex([
      { method: 'error', params: { error: { message: 'Reconnecting... 1/5' }, willRetry: true } },
      { method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 11, resetsAt: 1700000000 } } } },
      { method: 'item/completed', params: { item: { type: 'fileChange', status: 'completed', changes: [{ path: 'a.md', kind: { type: 'add' } }, { path: 'b.md', kind: { type: 'delete' } }] } } },
      { method: 'item/completed', params: { item: { type: 'agentMessage', text: ' @도윤 확인해 주세요 ' } } },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]);
    try {
      const events: TurnEvent[] = [];
      await runCodexTurn({ ...turnOpts, cwd: fake.dir, sessionId: 't0', approvalMode: 'ask-all', onEvent: (e) => events.push(e) }).done;
      expect(events).toEqual([
        { type: 'session', id: 't0' },
        { type: 'usage', utilization: 0.11, resetsAt: 1700000000 },
        { type: 'file', path: path.join(fake.dir, 'a.md'), action: 'created' },
        { type: 'text', text: '@도윤 확인해 주세요' },
      ]);
      const resume = fake.received().find((m) => m.method === 'thread/resume');
      expect(resume.params).toMatchObject({ threadId: 't0', sandbox: 'read-only', approvalPolicy: 'on-request', developerInstructions: 'sys' });
      expect(resume.params).not.toHaveProperty('model');
      expect(fake.args()[0]).toBe('app-server');
    } finally {
      fake.restore();
    }
  });

  it.skipIf(process.platform === 'win32')('asks Ensemble before a file change and passes on the answer', async () => {
    const outside = path.join(os.tmpdir(), 'outside.md');
    const fake = fakeCodex([
      { method: 'item/started', params: { item: { id: 'f1', type: 'fileChange', changes: [{ path: 'in.md', kind: { type: 'add' } }, { path: outside, kind: { type: 'add' } }] } } },
      { request: 'item/fileChange/requestApproval', params: { itemId: 'f1' } },
      { request: 'item/commandExecution/requestApproval', params: { command: 'curl example.com' } },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]);
    try {
      const asked: [string, Record<string, unknown>][] = [];
      const requestApproval = async (tool: string, input: Record<string, unknown>) => (asked.push([tool, input]), tool === 'Bash');
      await runCodexTurn({ ...turnOpts, cwd: fake.dir, approvalMode: 'auto-edits', requestApproval }).done;
      expect(asked).toEqual([['Write', { file_path: outside }], ['Bash', { command: 'curl example.com' }]]);
      expect(fake.received().filter((m) => m.id === 'r1').map((m) => m.result.decision)).toEqual(['decline', 'accept']);
      expect(fake.received().find((m) => m.method === 'thread/start').params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request' });
    } finally {
      fake.restore();
    }
  });

  it.skipIf(process.platform === 'win32')('reports a failed turn as an error', async () => {
    const fake = fakeCodex([{ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'model not found' } } } }]);
    try {
      await expect(runCodexTurn({ ...turnOpts, cwd: fake.dir, model: 'gpt-6-sol', approvalMode: 'auto-all' }).done).rejects.toThrow('model not found');
      expect(fake.received().find((m) => m.method === 'thread/start').params).toMatchObject({ model: 'gpt-6-sol', approvalPolicy: 'never' });
    } finally {
      fake.restore();
    }
  });

  it.skipIf(process.platform === 'win32')('reads usage without a turn', async () => {
    const fake = fakeCodex([]);
    try {
      expect(await readCodexUsage()).toEqual({ utilization: 0.42, resetsAt: 100 });
    } finally {
      fake.restore();
    }
  });
});

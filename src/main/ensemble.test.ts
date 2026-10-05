import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe as group, expect, it } from 'vitest';
import { findMentions, splitMentions } from '../shared/mentions';
import type { Agent, Chat } from '../shared/types';
import type { TurnEvent } from './claude';
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
  const calls: { agent: string; prompt: string; sessionId?: string }[] = [];
  let app!: Ensemble;
  const runTurn: RunTurn = (opts) => {
    const name = app.data.agents.find((a) => a.id === opts.agentId)!.name;
    calls.push({ agent: name, prompt: opts.prompt, sessionId: opts.sessionId });
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
    app.createChat({ agentIds: [ids['서윤'], ids['도윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '안녕' });
    await idle();
    expect(calls.map((c) => c.agent)).toEqual(['서윤']);
  });

  it('sends a mentioned message to the mentioned members in order', async () => {
    const { app, ids, calls, idle, dir } = setup({});
    app.createChat({ agentIds: [ids['서윤'], ids['도윤'], ids['한서']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '@한서 @도윤 부탁해' });
    await idle();
    expect(calls.map((c) => c.agent)).toEqual(['한서', '도윤']);
  });

  it('chains agent-to-agent mentions and passes only unseen messages', async () => {
    const { app, ids, calls, idle, dir } = setup({
      서윤: [[{ type: 'text', text: '@도윤 초안 써 주세요' }], [{ type: 'text', text: '좋습니다' }]],
      도윤: [[{ type: 'text', text: '@서윤 확인해 주세요' }]],
    });
    const chatId = app.createChat({ agentIds: [ids['서윤'], ids['도윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '카피 써 줘' });
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
    const chatId = app.createChat({ agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '비밀 이야기' });
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
    app.createChat({ agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '파일 만들어' });
    await idle();
    expect(app.data.agents[0].history[0]).toMatchObject({ source: 'auto', content: "'파일 만들어' 채팅에서 a.md 파일을 만듦" });
  });

  it('holds a permission request until the user answers', async () => {
    const { app, ids, dir } = setup({});
    const chatId = app.createChat({ agentIds: [ids['서윤']], leaderAgentId: ids['서윤'], folderPath: dir, firstMessage: '' });
    const answer = app.requestApproval(chatId, ids['서윤'], 'Write', { file_path: 'a.md', content: 'x' });
    const card = app.data.chats[0].messages.at(-1)!;
    expect(card).toMatchObject({ kind: 'approval', status: 'pending' });
    app.answerApproval(chatId, card.id, 'always');
    expect(JSON.parse(await answer)).toMatchObject({ behavior: 'allow' });
    // "always" auto-approves this agent's next request in this chat.
    expect(JSON.parse(await app.requestApproval(chatId, ids['서윤'], 'Bash', { command: 'ls' }))).toMatchObject({ behavior: 'allow' });
  });
});

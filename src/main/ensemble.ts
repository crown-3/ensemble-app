import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PROVIDERS, TINTS } from '../shared/models';
import type {
  Agent, AgentInput, AppState, Chat, ChatApprovalMode, ChatMember, GlobalSettings, Message, NewChatInput, Provider, Usage,
} from '../shared/types';
import type { TurnEvent } from './claude';
import { decide, describe, effectiveMode, respondersForAgent, respondersForUser } from './rules';
import type { Store } from './store';

export type RunTurn = (opts: {
  chatId: string;
  agentId: string;
  provider: Provider;
  approvalMode: ChatApprovalMode;
  cwd: string;
  model: string;
  sessionId?: string;
  systemPrompt: string;
  prompt: string;
  onEvent: (e: TurnEvent) => void;
}) => { done: Promise<void>; kill: () => void };

type Running = { agentId: string; kill: () => void };
type PendingApproval = { chatId: string; agentId: string; input: Record<string, unknown>; resolve: (answer: string) => void };

const now = () => new Date().toISOString();

export class Ensemble {
  private queue = new Map<string, string[]>(); // chatId -> agentIds waiting
  private running = new Map<string, Running>(); // chatId -> current turn
  private approvals = new Map<string, PendingApproval>(); // approval message id -> waiter
  private usage: Partial<Record<Provider, Usage>> = {};

  constructor(
    private store: Store,
    private runTurn: RunTurn,
    private onChange: () => void,
  ) {
    // Approvals cannot survive a restart: the CLI that asked is gone.
    for (const chat of store.data.chats) {
      for (const m of chat.messages) if (m.kind === 'approval' && m.status === 'pending') m.status = 'denied';
    }
  }

  get data() {
    return this.store.data;
  }

  state(): AppState {
    const working: Record<string, string[]> = {};
    for (const [chatId, r] of this.running) working[chatId] = [r.agentId];
    return { ...this.data, working, queued: Object.fromEntries(this.queue), usage: this.usage };
  }

  private changed() {
    this.store.save();
    this.onChange();
  }

  // --- Agents and settings ---

  saveAgent(id: string | null, input: AgentInput): string {
    const existing = id ? this.agent(id) : undefined;
    if (existing) {
      Object.assign(existing, input, { history: input.history ?? existing.history });
    } else {
      const agent: Agent = {
        ...input,
        id: randomUUID(),
        tint: TINTS[this.data.agents.length % TINTS.length],
        history: input.history ?? [],
      };
      this.data.agents.push(agent);
      id = agent.id;
    }
    this.changed();
    return id!;
  }

  duplicateAgent(id: string) {
    const src = this.agent(id);
    if (!src) return;
    const { id: _id, tint: _tint, ...rest } = structuredClone(src);
    this.saveAgent(null, { ...rest, name: `${src.name} 복사본`, history: [] });
  }

  deleteAgent(id: string) {
    for (const chat of this.data.chats) {
      if (chat.members.some((m) => m.agentId === id)) this.removeAgent(chat.id, id, false);
    }
    this.data.agents = this.data.agents.filter((a) => a.id !== id);
    this.changed();
  }

  saveSettings(patch: Partial<GlobalSettings>) {
    Object.assign(this.data.settings, patch);
    this.changed();
  }

  // --- Chats ---

  createChat(input: NewChatInput): string {
    const text = input.firstMessage.trim();
    const chat: Chat = {
      id: randomUUID(),
      title: text.slice(0, 40) || '새 채팅',
      folderPath: input.folderPath,
      members: input.agentIds.map((agentId) => ({ agentId, readFrom: 0, seenUpTo: 0 })),
      leaderAgentId: input.leaderAgentId,
      approvalMode: this.data.settings.defaultApprovalMode,
      alwaysApproveAgentIds: [],
      messages: [],
      createdAt: now(),
      updatedAt: now(),
      unread: false,
    };
    this.data.chats.unshift(chat);
    if (text) this.sendMessage(chat.id, text);
    else this.changed();
    return chat.id;
  }

  sendMessage(chatId: string, text: string) {
    const chat = this.chat(chatId);
    if (!chat || !text.trim()) return;
    this.push(chat, { kind: 'user', text: text.trim() });
    this.enqueue(chat, respondersForUser(text, chat, this.data.agents));
  }

  stopChat(chatId: string) {
    this.queue.delete(chatId);
    this.running.get(chatId)?.kill();
    for (const [id, p] of this.approvals) if (p.chatId === chatId) this.settleApproval(id, 'deny');
    this.onChange();
  }

  inviteAgent(chatId: string, agentId: string, scope: 'all' | 'from-now') {
    const chat = this.chat(chatId);
    const agent = this.agent(agentId);
    if (!chat || !agent || chat.members.some((m) => m.agentId === agentId)) return;
    this.push(chat, { kind: 'system', text: `${agent.name} 님을 이 채팅에 초대했습니다` });
    const from = scope === 'all' ? 0 : chat.messages.length - 1;
    chat.members.push({ agentId, readFrom: from, seenUpTo: from });
    this.changed();
  }

  removeAgent(chatId: string, agentId: string, announce = true) {
    const chat = this.chat(chatId);
    if (!chat) return;
    if (this.running.get(chatId)?.agentId === agentId) this.running.get(chatId)!.kill();
    this.queue.set(chatId, (this.queue.get(chatId) ?? []).filter((id) => id !== agentId));
    for (const [id, p] of this.approvals) if (p.chatId === chatId && p.agentId === agentId) this.settleApproval(id, 'deny');
    chat.members = chat.members.filter((m) => m.agentId !== agentId);
    if (chat.leaderAgentId === agentId) chat.leaderAgentId = chat.members[0]?.agentId ?? '';
    if (announce) this.push(chat, { kind: 'system', text: `${this.agent(agentId)?.name ?? '에이전트'} 님을 이 채팅에서 내보냈습니다` });
    this.changed();
  }

  setLeader(chatId: string, agentId: string) {
    const chat = this.chat(chatId);
    if (!chat || !chat.members.some((m) => m.agentId === agentId)) return;
    chat.leaderAgentId = agentId;
    this.changed();
  }

  setChatApproval(chatId: string, mode: ChatApprovalMode) {
    const chat = this.chat(chatId);
    if (!chat) return;
    chat.approvalMode = mode;
    this.changed();
  }

  markRead(chatId: string) {
    const chat = this.chat(chatId);
    if (!chat || !chat.unread) return;
    chat.unread = false;
    this.changed();
  }

  // --- Approvals ---

  // Called (via the approval MCP bridge) when the CLI wants to use a tool that needs permission.
  // Resolves with the JSON the CLI expects from a permission prompt tool.
  requestApproval(chatId: string, agentId: string, toolName: string, input: Record<string, unknown>): Promise<string> {
    const chat = this.chat(chatId);
    const agent = this.agent(agentId);
    if (!chat || !agent) return Promise.resolve(deny('채팅이나 에이전트를 찾을 수 없습니다.'));
    const d = decide(toolName, input, effectiveMode(agent, chat), chat.folderPath);
    if (d.kind === 'allow') return Promise.resolve(allow(input));
    if (d.kind === 'deny') return Promise.resolve(deny(d.message));
    const msg = this.push(chat, { kind: 'approval', agentId, toolName, ...describe(toolName, input, chat.folderPath), status: 'pending' });
    this.changed();
    return new Promise((resolve) => this.approvals.set(msg.id, { chatId, agentId, input, resolve }));
  }

  answerApproval(chatId: string, messageId: string, answer: 'approve' | 'deny' | 'always') {
    const chat = this.chat(chatId);
    const p = this.approvals.get(messageId);
    if (!chat || !p) return;
    if (answer === 'always' && !chat.alwaysApproveAgentIds.includes(p.agentId)) chat.alwaysApproveAgentIds.push(p.agentId);
    this.settleApproval(messageId, answer === 'deny' ? 'deny' : 'approve');
  }

  private settleApproval(messageId: string, answer: 'approve' | 'deny') {
    const p = this.approvals.get(messageId);
    if (!p) return;
    this.approvals.delete(messageId);
    const msg = this.chat(p.chatId)?.messages.find((m) => m.id === messageId);
    if (msg?.kind === 'approval') msg.status = answer === 'approve' ? 'approved' : 'denied';
    p.resolve(answer === 'approve' ? allow(p.input) : deny('사용자가 거절했습니다.'));
    this.changed();
  }

  // --- Turn loop ---

  private enqueue(chat: Chat, agentIds: string[]) {
    const q = this.queue.get(chat.id) ?? [];
    // An agent that is running right now may be queued again: it has not seen the new message.
    for (const id of agentIds) if (!q.includes(id)) q.push(id);
    this.queue.set(chat.id, q);
    this.changed();
    if (!this.running.has(chat.id)) void this.drain(chat.id);
  }

  private async drain(chatId: string) {
    let next: string | undefined;
    while ((next = this.queue.get(chatId)?.shift()) !== undefined) {
      const chat = this.chat(chatId);
      const member = chat?.members.find((m) => m.agentId === next);
      const agent = this.agent(next);
      if (!chat || !member || !agent) continue;
      await this.turn(chat, member, agent);
    }
    this.queue.delete(chatId);
    this.onChange();
  }

  private async turn(chat: Chat, member: ChatMember, agent: Agent) {
    if (!PROVIDERS.find((p) => p.id === agent.provider)?.available) {
      this.push(chat, { kind: 'error', agentId: agent.id, text: `${agent.name}: ${agent.provider.toUpperCase()} 에이전트는 아직 실행할 수 없습니다. 지금은 Claude와 Codex 에이전트만 지원합니다.` });
      this.changed();
      return;
    }
    const prompt = this.promptFor(chat, member);
    member.seenUpTo = chat.messages.length;
    let stopped = false;
    const { done, kill } = this.runTurn({
      chatId: chat.id,
      agentId: agent.id,
      provider: agent.provider,
      approvalMode: effectiveMode(agent, chat),
      cwd: chat.folderPath,
      model: agent.model,
      sessionId: member.sessionId,
      systemPrompt: this.systemPromptFor(chat, agent),
      prompt,
      onEvent: (e) => this.onTurnEvent(chat, member, agent, e),
    });
    this.running.set(chat.id, {
      agentId: agent.id,
      kill: () => {
        stopped = true;
        kill();
      },
    });
    this.onChange();
    try {
      await done;
      if (stopped) this.push(chat, { kind: 'system', text: `${agent.name}의 작업을 멈췄습니다` });
    } catch (e) {
      this.push(chat, { kind: 'error', agentId: agent.id, text: `${agent.name}: ${(e as Error).message}` });
    } finally {
      this.running.delete(chat.id);
      this.changed();
    }
  }

  private onTurnEvent(chat: Chat, member: ChatMember, agent: Agent, e: TurnEvent) {
    switch (e.type) {
      case 'session':
        member.sessionId = e.id;
        break;
      case 'usage':
        this.usage[agent.provider] = { utilization: e.utilization, resetsAt: e.resetsAt };
        break;
      case 'thinking':
        this.push(chat, { kind: 'thinking', agentId: agent.id, seconds: e.seconds });
        break;
      case 'text':
        this.push(chat, { kind: 'agent', agentId: agent.id, text: e.text });
        chat.unread = true;
        this.enqueue(chat, respondersForAgent(e.text, agent.id, chat, this.data.agents));
        break;
      case 'file': {
        this.push(chat, { kind: 'file', agentId: agent.id, path: e.path, action: e.action });
        const verb = e.action === 'created' ? '만듦' : '수정함';
        agent.history.unshift({ id: randomUUID(), time: now(), content: `'${chat.title}' 채팅에서 ${path.basename(e.path)} 파일을 ${verb}`, source: 'auto' });
        break;
      }
    }
    this.changed();
  }

  // The new messages this agent has not seen yet, as plain text.
  private promptFor(chat: Chat, member: ChatMember): string {
    const start = Math.max(member.seenUpTo, member.readFrom);
    const lines = chat.messages.slice(start).filter((m) => !('agentId' in m && m.agentId === member.agentId)).map((m) => this.line(m)).filter(Boolean);
    return lines.length ? lines.join('\n\n') : '(새 메시지 없음. 이어서 진행하세요.)';
  }

  private line(m: Message): string {
    const who = (id: string) => {
      const a = this.agent(id);
      return a ? `${a.name} · ${a.title}` : '삭제된 에이전트';
    };
    switch (m.kind) {
      case 'user': return `[사용자] ${m.text}`;
      case 'agent': return `[${who(m.agentId)}] ${m.text}`;
      case 'file': return `[${who(m.agentId)}] 파일 ${m.action === 'created' ? '생성' : '수정'}: ${path.relative(this.folderOf(m), m.path) || m.path}`;
      case 'system': return `[알림] ${m.text}`;
      default: return '';
    }
  }

  private folderOf(m: Message): string {
    return this.data.chats.find((c) => c.messages.includes(m))?.folderPath ?? '/';
  }

  private systemPromptFor(chat: Chat, agent: Agent): string {
    const members = chat.members
      .map((m) => this.agent(m.agentId))
      .filter((a): a is Agent => !!a)
      .map((a) => `- ${a.name} (${a.title})${a.id === agent.id ? ' ← 당신' : ''}${a.id === chat.leaderAgentId ? ' · 리더' : ''}`);
    return [
      `당신은 Ensemble이라는 그룹 채팅에 참여한 AI 에이전트입니다. 당신의 이름은 ${agent.name}, 직책은 ${agent.title}입니다.`,
      `채팅 참여자는 사용자 한 명과 다음 에이전트들입니다:\n${members.join('\n')}`,
      [
        '채팅 규칙:',
        '- 받은 메시지는 "[보낸 사람] 내용" 형식입니다.',
        '- 다른 에이전트에게 일을 맡기거나 묻고 싶으면 답변에 @이름 을 씁니다(예: @도윤). 멘션된 에이전트가 당신의 답변을 받고 이어서 응답합니다.',
        '- 멘션은 정말 필요할 때만 씁니다. 멘션하지 않으면 다른 에이전트를 깨우지 않습니다. 고맙다는 인사처럼 일이 아닌 이유로 멘션하지 않습니다.',
        '- 사용자가 멘션 없이 보낸 메시지는 리더가 받습니다.',
        '- 답변은 채팅 메시지처럼 간결하게 씁니다.',
        `- 작업 폴더는 ${chat.folderPath} 입니다. 이 폴더 안에서만 파일을 읽고 만들고 수정합니다.`,
      ].join('\n'),
      this.data.settings.globalInstructions && `# 전역 지침\n${this.data.settings.globalInstructions}`,
      agent.persona && `# 페르소나 및 역할\n${agent.persona}`,
    ].filter(Boolean).join('\n\n');
  }

  // --- helpers ---

  private push(chat: Chat, m: DistributiveOmit<Message, 'id' | 'time'>): Message {
    const msg = { ...m, id: randomUUID(), time: now() } as Message;
    chat.messages.push(msg);
    chat.updatedAt = msg.time;
    return msg;
  }

  private chat(id: string) {
    return this.data.chats.find((c) => c.id === id);
  }

  private agent(id: string) {
    return this.data.agents.find((a) => a.id === id);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const allow = (input: Record<string, unknown>) => JSON.stringify({ behavior: 'allow', updatedInput: input });
const deny = (message: string) => JSON.stringify({ behavior: 'deny', message });

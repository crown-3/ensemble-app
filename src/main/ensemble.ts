import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PROVIDERS, TINTS } from '../shared/models';
import type {
  Agent, AgentInput, AppState, Chat, ChatApprovalMode, ChatMember, GlobalSettings, MemoryEntry, Message, NewChatInput, Project,
  ProjectInput, Provider, Usage,
} from '../shared/types';
import type { TurnEvent } from './claude';
import { decide, describe, effectiveMode, respondersForAgent, respondersForUser } from './rules';
import type { Store } from './store';

export type RunTurn = (opts: {
  chatId: string;
  agentId: string;
  provider: Provider;
  approvalMode: ChatApprovalMode;
  memory: boolean; // the chat is in a project, so the memory tools are offered
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
  private usageAt: Partial<Record<Provider, number>> = {}; // when each usage was measured

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
    this.data.memories = this.data.memories.filter((m) => m.agentId !== id);
    this.changed();
  }

  saveSettings(patch: Partial<GlobalSettings>) {
    Object.assign(this.data.settings, patch);
    this.changed();
  }

  // --- Projects ---

  createProject(input: ProjectInput): string {
    const project: Project = { ...input, id: randomUUID(), instructions: '', referenceFiles: [], createdAt: now() };
    this.data.projects.push(project);
    this.changed();
    return project.id;
  }

  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) {
    const project = this.project(id);
    if (!project) return;
    if (patch.folderPath && patch.folderPath !== project.folderPath) {
      for (const chat of this.data.chats.filter((c) => c.projectId === id)) {
        chat.folderPath = patch.folderPath;
        // CLI sessions belong to the folder they started in, so start fresh ones and resend what each member may read.
        for (const m of chat.members) {
          m.sessionId = undefined;
          m.seenUpTo = m.readFrom;
        }
      }
    }
    Object.assign(project, patch);
    this.changed();
  }

  // Deletes the project with its chats and memories. Files in the work folder are left alone.
  deleteProject(id: string) {
    for (const chat of this.data.chats.filter((c) => c.projectId === id)) this.stopChat(chat.id);
    this.data.chats = this.data.chats.filter((c) => c.projectId !== id);
    this.data.memories = this.data.memories.filter((m) => m.projectId !== id);
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.changed();
  }

  // --- Memory ---

  // Added or edited by the user on the project memory screen.
  saveMemory(projectId: string, agentId: string, id: string | null, content: string) {
    const text = content.trim();
    if (!text || !this.project(projectId) || !this.agent(agentId)) return;
    const existing = id ? this.data.memories.find((m) => m.id === id) : undefined;
    if (existing) existing.content = text;
    else this.data.memories.push({ id: randomUUID(), agentId, projectId, content: text, createdAt: now(), source: 'manual' });
    this.changed();
  }

  deleteMemory(id: string) {
    this.data.memories = this.data.memories.filter((m) => m.id !== id);
    this.changed();
  }

  // Called (via the Ensemble MCP server) when an agent uses its memory tools. Returns the tool's text result.
  memoryTool(chatId: string, agentId: string, tool: string, args: { id?: string; content?: string }): string {
    const chat = this.chat(chatId);
    const agent = this.agent(agentId);
    if (!chat || !agent) return '채팅이나 에이전트를 찾을 수 없습니다.';
    if (!chat.projectId) return '이 채팅은 프로젝트에 속하지 않아 메모리를 사용할 수 없습니다.';
    const content = args.content?.trim() ?? '';
    const own = (id?: string) => this.data.memories.find((m) => m.id === id && m.agentId === agentId && m.projectId === chat.projectId);
    let result: string;
    if (tool === 'memory_save') {
      if (!content) return '기록할 내용이 비어 있습니다.';
      const entry: MemoryEntry = { id: randomUUID(), agentId, projectId: chat.projectId, content, createdAt: now(), source: { chatId } };
      this.data.memories.push(entry);
      this.push(chat, { kind: 'system', text: `${agent.name}이(가) 기억함: ${content}` });
      result = `기록했습니다. (id: ${entry.id})`;
    } else if (tool === 'memory_update') {
      const entry = own(args.id);
      if (!entry) return `id가 ${args.id}인 내 메모리 항목이 없습니다.`;
      if (!content) return '고칠 내용이 비어 있습니다.';
      entry.content = content;
      this.push(chat, { kind: 'system', text: `${agent.name}이(가) 기억을 고침: ${content}` });
      result = '고쳤습니다.';
    } else if (tool === 'memory_delete') {
      const entry = own(args.id);
      if (!entry) return `id가 ${args.id}인 내 메모리 항목이 없습니다.`;
      this.data.memories = this.data.memories.filter((m) => m !== entry);
      this.push(chat, { kind: 'system', text: `${agent.name}이(가) 기억을 지움: ${entry.content}` });
      result = '지웠습니다.';
    } else {
      return `알 수 없는 도구입니다: ${tool}`;
    }
    this.changed();
    return result;
  }

  // --- Chats ---

  createChat(input: NewChatInput): string {
    const text = input.firstMessage.trim();
    const project = input.projectId ? this.project(input.projectId) : undefined;
    const chat: Chat = {
      id: randomUUID(),
      title: text.slice(0, 40) || '새 채팅',
      projectId: project?.id ?? null,
      folderPath: project?.folderPath ?? input.folderPath,
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

  // Keeps the newest measurement, so a slow startup check cannot overwrite what a turn just reported.
  setUsage(provider: Provider, usage: Usage, at = Date.now()) {
    if ((this.usageAt[provider] ?? 0) > at) return;
    this.usage[provider] = usage;
    this.usageAt[provider] = at;
    this.onChange();
  }

  // --- Approvals ---

  // Called (via the approval MCP bridge) when the CLI wants to use a tool that needs permission.
  // Resolves with the JSON the CLI expects from a permission prompt tool.
  requestApproval(chatId: string, agentId: string, toolName: string, input: Record<string, unknown>): Promise<string> {
    const chat = this.chat(chatId);
    const agent = this.agent(agentId);
    if (!chat || !agent) return Promise.resolve(deny('채팅이나 에이전트를 찾을 수 없습니다.'));
    const d = decide(toolName, input, effectiveMode(agent, chat), chat.folderPath, this.referenceFiles(chat));
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
      memory: !!chat.projectId,
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
        this.setUsage(agent.provider, { utilization: e.utilization, resetsAt: e.resetsAt });
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
    const project = chat.projectId ? this.project(chat.projectId) : undefined;
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
      // Order from the spec (4.3): global instructions, project instructions, persona.
      this.data.settings.globalInstructions && `# 전역 지침\n${this.data.settings.globalInstructions}`,
      project?.instructions && `# 프로젝트 지침\n${project.instructions}`,
      project?.referenceFiles.length &&
        `# 참고 파일\n이 프로젝트에서 항상 참고하는 파일입니다. 작업과 관련이 있으면 먼저 읽습니다. 작업 폴더 밖에 있어도 읽을 수 있지만 수정하지는 않습니다.\n${project.referenceFiles.map((f) => `- ${f}`).join('\n')}`,
      agent.persona && `# 페르소나 및 역할\n${agent.persona}`,
      project && this.memoryPrompt(project, agent),
    ].filter(Boolean).join('\n\n');
  }

  // Follows the precedent of ChatGPT saved memories and Claude Code auto memory: always record what the user asks
  // to remember, otherwise only what a later chat would need, one short fact per entry, kept up to date.
  private memoryPrompt(project: Project, agent: Agent): string {
    const entries = this.data.memories.filter((m) => m.agentId === agent.id && m.projectId === project.id);
    return [
      '# 프로젝트 메모리',
      `이 채팅은 '${project.name}' 프로젝트에 속합니다. 당신에게는 이 프로젝트의 채팅들 사이에서 이어지는 당신만의 메모리가 있습니다. 다른 에이전트의 메모리와 분리되어 있고, 다른 프로젝트에서는 쓰이지 않습니다.`,
      '- 사용자가 기억해 달라고 하면 반드시 memory_save 도구로 기록합니다.',
      '- 그 밖에는 이 프로젝트의 다음 채팅에서도 쓸모 있는 정보일 때만 기록합니다: 사용자의 선호와 작업 방식, 사용자가 바로잡아 주거나 확인해 준 방식, 확정된 결정, 파일만 봐서는 알 수 없는 프로젝트 사정.',
      '- 작업 폴더의 파일에서 알 수 있는 내용, 지침에 이미 있는 내용, 이번 채팅에서만 필요한 내용은 기록하지 않습니다. 매 턴 기록할 필요는 없습니다.',
      '- 사용자가 요청하지 않는 한 민감한 개인 정보는 기록하지 않습니다.',
      '- 한 항목에는 한 가지 사실만 한두 문장으로 씁니다. 이미 있는 항목과 겹치거나 바뀐 내용이면 새로 만들지 말고 memory_update로 고치고, 더 이상 맞지 않는 항목은 memory_delete로 지웁니다.',
      '',
      '현재 메모리:',
      entries.length ? entries.map((m) => `- [id: ${m.id}] ${m.content}`).join('\n') : '(아직 없음)',
    ].join('\n');
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

  private project(id: string) {
    return this.data.projects.find((p) => p.id === id);
  }

  private referenceFiles(chat: Chat): string[] {
    return (chat.projectId && this.project(chat.projectId)?.referenceFiles) || [];
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const allow = (input: Record<string, unknown>) => JSON.stringify({ behavior: 'allow', updatedInput: input });
const deny = (message: string) => JSON.stringify({ behavior: 'deny', message });

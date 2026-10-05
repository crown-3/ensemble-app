// Data model. Based on PRODUCT_SPEC.md section 6, extended for phase 1
// (leader, per-member CLI session, message list).

export type Provider = 'claude' | 'gpt' | 'gemini';

export type AgentApprovalMode = 'inherit' | 'always-ask' | 'always-auto';
export type ChatApprovalMode = 'ask-all' | 'auto-edits' | 'auto-all';

export type HistoryEntry = {
  id: string;
  time: string; // ISO
  content: string;
  source: 'auto' | 'auto-edited' | 'manual';
};

export type Agent = {
  id: string;
  name: string;
  title: string;
  provider: Provider;
  model: string;
  avatar?: string; // data URL
  tint: string;
  persona: string;
  history: HistoryEntry[];
  approvalMode: AgentApprovalMode;
};

export type ChatMember = {
  agentId: string;
  // Index into chat.messages from which this agent may read.
  readFrom: number;
  // Index of the first message this agent has not been given yet.
  seenUpTo: number;
  sessionId?: string;
};

export type Chat = {
  id: string;
  title: string;
  folderPath: string;
  members: ChatMember[];
  leaderAgentId: string;
  approvalMode: ChatApprovalMode;
  // "이 채팅에서 이 에이전트는 항상 승인"
  alwaysApproveAgentIds: string[];
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  unread: boolean;
};

type Base = { id: string; time: string };

export type Message =
  | (Base & { kind: 'user'; text: string })
  | (Base & { kind: 'agent'; agentId: string; text: string })
  | (Base & { kind: 'thinking'; agentId: string; seconds: number })
  | (Base & { kind: 'file'; agentId: string; path: string; action: 'created' | 'modified' })
  | (Base & {
      kind: 'approval';
      agentId: string;
      toolName: string;
      summary: string;
      detail?: string;
      status: 'pending' | 'approved' | 'denied';
    })
  | (Base & { kind: 'system'; text: string })
  | (Base & { kind: 'error'; agentId?: string; text: string });

export type GlobalSettings = {
  globalInstructions: string;
  defaultApprovalMode: ChatApprovalMode;
  theme: 'light' | 'dark' | 'system';
};

export type Data = {
  agents: Agent[];
  chats: Chat[];
  settings: GlobalSettings;
};

export type Usage = { utilization: number; resetsAt?: number };

// What the renderer sees: persisted data plus live runtime status.
export type AppState = Data & {
  working: Record<string, string[]>; // chatId -> agentIds currently running
  queued: Record<string, string[]>; // chatId -> agentIds waiting their turn
  usage: Partial<Record<Provider, Usage>>;
};

export type AgentInput = Omit<Agent, 'id' | 'history' | 'tint'> & { history?: HistoryEntry[] };

export type NewChatInput = {
  agentIds: string[];
  leaderAgentId: string;
  folderPath: string;
  firstMessage: string;
};

export type Api = {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  saveAgent(id: string | null, input: AgentInput): Promise<string>;
  duplicateAgent(id: string): Promise<void>;
  deleteAgent(id: string): Promise<void>;
  saveSettings(patch: Partial<GlobalSettings>): Promise<void>;
  pickFolder(): Promise<string | null>;
  defaultFolder(): Promise<string>;
  openPath(path: string): Promise<void>;
  createChat(input: NewChatInput): Promise<string>;
  sendMessage(chatId: string, text: string): Promise<void>;
  stopChat(chatId: string): Promise<void>;
  inviteAgent(chatId: string, agentId: string, scope: 'all' | 'from-now'): Promise<void>;
  removeAgent(chatId: string, agentId: string): Promise<void>;
  setLeader(chatId: string, agentId: string): Promise<void>;
  setChatApproval(chatId: string, mode: ChatApprovalMode): Promise<void>;
  answerApproval(chatId: string, messageId: string, answer: 'approve' | 'deny' | 'always'): Promise<void>;
  markRead(chatId: string): Promise<void>;
};

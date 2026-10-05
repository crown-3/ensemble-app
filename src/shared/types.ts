// Data model. Based on PRODUCT_SPEC.md section 6, extended for phase 1
// (leader, per-member CLI session, message list).

export type Provider = 'claude' | 'codex' | 'gemini';

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

export type Project = {
  id: string;
  name: string;
  description: string;
  folderPath: string; // every chat of the project works here
  instructions: string; // sent to every agent in every chat of the project
  referenceFiles: string[]; // absolute paths the agents always consult
  createdAt: string;
};

// Memory is scoped to an (agent, project) pair. Chats outside a project have none (DECISIONS.md #5).
export type MemoryEntry = {
  id: string;
  agentId: string;
  projectId: string;
  content: string;
  createdAt: string;
  source: { chatId: string } | 'manual';
};

export type Chat = {
  id: string;
  title: string;
  projectId: string | null; // fixed when the chat is created
  folderPath: string; // the project's folder when projectId is set
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
  projects: Project[];
  chats: Chat[];
  memories: MemoryEntry[];
  settings: GlobalSettings;
};

export type LoginState = 'in' | 'out' | 'missing';
export type AuthStatus = { claude: LoginState; codex: LoginState };

export type Usage = { utilization: number; resetsAt?: number };

// What the renderer sees: persisted data plus live runtime status.
export type AppState = Data & {
  working: Record<string, string[]>; // chatId -> agentIds currently running
  queued: Record<string, string[]>; // chatId -> agentIds waiting their turn
  usage: Partial<Record<Provider, Usage>>;
};

export type AgentInput = Omit<Agent, 'id' | 'history' | 'tint'> & { history?: HistoryEntry[] };

export type ProjectInput = Pick<Project, 'name' | 'description' | 'folderPath'>;

export type NewChatInput = {
  projectId: string | null;
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
  pickFile(): Promise<string | null>;
  createProject(input: ProjectInput): Promise<string>;
  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveMemory(projectId: string, agentId: string, id: string | null, content: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  createChat(input: NewChatInput): Promise<string>;
  sendMessage(chatId: string, text: string): Promise<void>;
  stopChat(chatId: string): Promise<void>;
  inviteAgent(chatId: string, agentId: string, scope: 'all' | 'from-now'): Promise<void>;
  removeAgent(chatId: string, agentId: string): Promise<void>;
  setLeader(chatId: string, agentId: string): Promise<void>;
  setChatApproval(chatId: string, mode: ChatApprovalMode): Promise<void>;
  answerApproval(chatId: string, messageId: string, answer: 'approve' | 'deny' | 'always'): Promise<void>;
  markRead(chatId: string): Promise<void>;
  authStatus(): Promise<AuthStatus>;
};

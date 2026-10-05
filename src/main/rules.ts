import path from 'node:path';
import { findMentions } from '../shared/mentions';
import type { Agent, Chat, ChatApprovalMode } from '../shared/types';

// --- Who replies (DECISIONS.md #3, #4) ---

// A user message goes to the members it mentions, or to the leader if it mentions none.
export function respondersForUser(text: string, chat: Chat, agents: Agent[]): string[] {
  const mentioned = mentionedMembers(text, chat, agents);
  return mentioned.length ? mentioned : [chat.leaderAgentId];
}

// An agent message wakes the other members it mentions. There is no hop limit;
// the chain ends when nobody is mentioned or the user presses stop.
export function respondersForAgent(text: string, fromAgentId: string, chat: Chat, agents: Agent[]): string[] {
  return mentionedMembers(text, chat, agents).filter((id) => id !== fromAgentId);
}

function mentionedMembers(text: string, chat: Chat, agents: Agent[]): string[] {
  const members = chat.members.map((m) => agents.find((a) => a.id === m.agentId)).filter((a): a is Agent => !!a);
  return findMentions(text, members.map((a) => a.name)).map((name) => members.find((a) => a.name === name)!.id);
}

// --- Approval (spec 4.1) ---

export function effectiveMode(agent: Agent, chat: Chat): ChatApprovalMode {
  if (chat.alwaysApproveAgentIds.includes(agent.id)) return 'auto-all';
  if (agent.approvalMode === 'always-ask') return 'ask-all';
  if (agent.approvalMode === 'always-auto') return 'auto-all';
  return chat.approvalMode;
}

const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

export type Decision = { kind: 'allow' } | { kind: 'deny'; message: string } | { kind: 'ask' };

// readable: files outside the folder that may still be read (the project's reference files).
export function decide(toolName: string, input: Record<string, unknown>, mode: ChatApprovalMode, folder: string, readable: string[] = []): Decision {
  const target = targetPath(input);
  if (target && toolName === 'Read' && readable.includes(path.resolve(folder, target))) return { kind: 'allow' };
  if (target && !isInside(path.resolve(folder, target), folder)) {
    return { kind: 'deny', message: `작업 폴더(${folder}) 밖의 파일에는 접근할 수 없습니다.` };
  }
  if (mode === 'auto-all') return { kind: 'allow' };
  if (mode === 'auto-edits' && EDIT_TOOLS.includes(toolName)) return { kind: 'allow' };
  return { kind: 'ask' };
}

export function describe(toolName: string, input: Record<string, unknown>, folder: string): { summary: string; detail?: string } {
  const target = targetPath(input);
  const rel = target ? path.relative(folder, path.resolve(folder, target)) || '.' : '';
  switch (toolName) {
    case 'Write':
      return { summary: `작업 폴더의 ${rel}에 파일을 저장하려고 합니다.` };
    case 'Edit':
    case 'NotebookEdit':
      return { summary: `작업 폴더의 ${rel}을(를) 수정하려고 합니다.` };
    case 'Bash':
      return { summary: '명령을 실행하려고 합니다.', detail: String(input.command ?? '') };
    case 'WebFetch':
      return { summary: '웹 페이지를 읽으려고 합니다.', detail: String(input.url ?? '') };
    case 'WebSearch':
      return { summary: '웹을 검색하려고 합니다.', detail: String(input.query ?? '') };
    default:
      return { summary: `${toolName} 도구를 사용하려고 합니다.`, detail: rel || undefined };
  }
}

function targetPath(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path ?? input.path;
  return typeof p === 'string' ? p : null;
}

export function isInside(p: string, folder: string): boolean {
  const rel = path.relative(path.resolve(folder), p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

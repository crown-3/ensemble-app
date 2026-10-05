import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { splitMentions } from '../../shared/mentions';
import { modelLabel } from '../../shared/models';
import type { Agent, AppState, Chat, ChatApprovalMode, Message, Usage } from '../../shared/types';
import { api, Avatar, dayLabel, Icon, MentionText, timeLabel } from './ui';

const CHAT_MODES: { id: ChatApprovalMode; label: string }[] = [
  { id: 'ask-all', label: '모든 작업을 승인 후 실행' },
  { id: 'auto-edits', label: '파일 수정만 자동 승인' },
  { id: 'auto-all', label: '모든 작업을 자동 승인' },
];
const AGENT_MODE_LABEL = { inherit: '채팅 설정을 따름', 'always-ask': '항상 승인 요청', 'always-auto': '항상 자동 승인' };

export function ChatView({ state, chatId }: { state: AppState; chatId: string }) {
  const chat = state.chats.find((c) => c.id === chatId)!;
  const [invite, setInvite] = useState(false);
  const [removing, setRemoving] = useState<Agent | null>(null);
  const agentOf = (id: string) => state.agents.find((a) => a.id === id);
  const members = chat.members.map((m) => agentOf(m.agentId)).filter((a): a is Agent => !!a);
  const working = state.working[chat.id] ?? [];
  const queued = state.queued[chat.id] ?? [];
  const busy = working.length > 0 || queued.length > 0;
  const project = state.projects.find((p) => p.id === chat.projectId);

  useEffect(() => {
    if (chat.unread) api().markRead(chat.id);
  }, [chat.unread, chat.id]);

  return (
    <>
      <main className="chat-main">
        <header className="chat-top glass">
          <div className="col grow" style={{ gap: 2 }}>
            <h1 style={{ fontSize: 13, lineHeight: '16px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.title}</h1>
            <div className="meta">
              {project ? <a href={`#/project/${project.id}`}>{project.name}</a> : '프로젝트 없음'} · 에이전트 {members.length}명 참여
            </div>
          </div>
          <button className="btn float-btn" aria-expanded={invite} onClick={() => setInvite(!invite)}>
            <Icon.invite /><span>에이전트 초대</span>
          </button>
        </header>
        {invite && <InvitePopover state={state} chat={chat} onClose={() => setInvite(false)} />}

        <div className="chat-tabs glass">
          <div role="tablist" aria-label="채팅 보기" className="row" style={{ gap: 16 }}>
            <button role="tab" className="tab" aria-selected="true">메시지</button>
          </div>
          <span className="grow" />
          <button className="row btn-text small" style={{ color: 'var(--ink-secondary)', gap: 4 }} title="작업 폴더 열기" onClick={() => api().openPath(chat.folderPath)}>
            <Icon.folder size={14} /><span>{tildify(chat.folderPath)}</span>
          </button>
          <label className="row small muted" style={{ gap: 8 }}>
            <span>승인</span>
            <select value={chat.approvalMode} onChange={(e) => api().setChatApproval(chat.id, e.target.value as ChatApprovalMode)}
              style={{ height: 28, padding: '0 4px', border: '1px solid var(--field-border)', borderRadius: 8, background: 'var(--field)', color: 'var(--ink)', fontSize: 12 }}>
              {CHAT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>

        <Transcript state={state} chat={chat} working={working} queued={queued} />
        <Composer chat={chat} members={members} busy={busy} />
      </main>

      <MembersPanel state={state} chat={chat} members={members} working={working} queued={queued}
        onRemove={setRemoving} onInvite={() => setInvite(true)} />

      {removing && (
        <div className="overlay" onClick={() => setRemoving(null)}>
          <div role="alertdialog" aria-labelledby="rm-title" className="popover dialog" onClick={(e) => e.stopPropagation()}>
            <h1 id="rm-title" className="title">{removing.name}을(를) 이 채팅에서 내보낼까요?</h1>
            <p className="muted" style={{ lineHeight: '17px' }}>
              {removing.name}은(는) 이후의 대화를 볼 수 없습니다. 진행 중인 작업은 멈춥니다.{' '}
              {project ? '이 프로젝트에서 쌓은 기억은 그대로 유지되며, 언제든지 다시 초대할 수 있습니다.' : '언제든지 다시 초대할 수 있습니다.'}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
              <button className="btn" onClick={() => setRemoving(null)}>취소</button>
              <button className="btn-danger" onClick={() => { api().removeAgent(chat.id, removing.id); setRemoving(null); }}>내보내기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Transcript ---

type Item =
  | { type: 'day'; label: string }
  | { type: 'user'; msg: Extract<Message, { kind: 'user' }> }
  | { type: 'agent'; agentId: string; msgs: Message[] }
  | { type: 'note'; msg: Message };

function group(messages: Message[]): Item[] {
  const items: Item[] = [];
  let day = '';
  for (const m of messages) {
    const d = dayLabel(m.time);
    if (d !== day) items.push({ type: 'day', label: (day = d) });
    const last = items.at(-1);
    if (m.kind === 'user') items.push({ type: 'user', msg: m });
    else if ('agentId' in m && m.agentId) {
      if (last?.type === 'agent' && last.agentId === m.agentId) last.msgs.push(m);
      else items.push({ type: 'agent', agentId: m.agentId, msgs: [m] });
    } else items.push({ type: 'note', msg: m });
  }
  return items;
}

function Transcript({ state, chat, working, queued }: { state: AppState; chat: Chat; working: string[]; queued: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const names = useMemo(() => state.agents.map((a) => a.name), [state.agents]);
  const items = useMemo(() => group(chat.messages), [chat.messages]);
  const agentOf = (id: string) => state.agents.find((a) => a.id === id);

  useLayoutEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });

  return (
    <div ref={ref} className="transcript" onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }}>
      {items.map((it, i) => {
        if (it.type === 'day') return <div key={i} className="day meta-strong">{it.label}</div>;
        if (it.type === 'note') {
          return it.msg.kind === 'error'
            ? <div key={i} className="error-line system-note"><Icon.alert />{it.msg.text}</div>
            : <div key={i} className="system-note meta-strong">{'text' in it.msg ? it.msg.text : ''}</div>;
        }
        if (it.type === 'user') {
          return (
            <div key={i} className="out-group">
              <div className="bubble sent"><MentionText text={it.msg.text} names={names} /></div>
              <div className="meta">전달됨 · {timeLabel(it.msg.time)}</div>
            </div>
          );
        }
        const agent = agentOf(it.agentId);
        return (
          <div key={i} className="in-group">
            <Avatar agent={agent} size={28} />
            <div className="in-stack">
              <div className="sender meta">{agent ? `${agent.name} · ${agent.title}` : '삭제된 에이전트'}</div>
              {it.msgs.map((m) => <AgentPiece key={m.id} m={m} chat={chat} agent={agent} names={names} />)}
            </div>
          </div>
        );
      })}

      {working.map((id) => {
        const agent = agentOf(id);
        return (
          <div key={id} className="row" style={{ gap: 8, paddingTop: 8 }}>
            <Avatar agent={agent} size={28} />
            <div className="typing" aria-hidden="true"><span /><span /><span /></div>
            <span className="meta">{agent?.name}이(가) 작업하는 중{queued.length ? ` · 다음 차례: ${queued.map((q) => agentOf(q)?.name).join(', ')}` : ''}</span>
          </div>
        );
      })}

      {chat.messages.length === 0 && (
        <div className="system-note meta" style={{ marginTop: 40 }}>첫 메시지를 보내 대화를 시작하세요. 멘션 없이 보내면 리더가 답합니다.</div>
      )}
    </div>
  );
}

function AgentPiece({ m, chat, agent, names }: { m: Message; chat: Chat; agent?: Agent; names: string[] }) {
  switch (m.kind) {
    case 'agent':
      return <div className="bubble received"><MentionText text={m.text} names={names} /></div>;
    case 'thinking':
      return <div className="pill">생각함 · {m.seconds}초</div>;
    case 'file': {
      const name = m.path.split(/[\\/]/).pop();
      if (m.action === 'modified') {
        return (
          <div className="row meta" style={{ gap: 4, padding: '4px 12px 0' }}>
            <Icon.pencil /><span>{name} 수정</span>
            <button className="btn-text" style={{ height: 20, fontSize: 11 }} onClick={() => api().openPath(m.path)}>열기</button>
          </div>
        );
      }
      return (
        <div className="file-card">
          <div className="file-icon"><Icon.file /></div>
          <div className="col grow" style={{ gap: 2 }}>
            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div className="meta">파일 생성 · {relative(chat.folderPath, m.path)}</div>
          </div>
          <button className="btn-text" onClick={() => api().openPath(m.path)}>열기</button>
        </div>
      );
    }
    case 'approval':
      return (
        <div className="approval">
          <div className="meta-strong">승인 요청</div>
          <div style={{ lineHeight: '17px' }}>{m.summary}</div>
          {m.detail && <pre>{m.detail}</pre>}
          {m.status === 'pending' ? (
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn-primary btn-sm" onClick={() => api().answerApproval(chat.id, m.id, 'approve')}>승인</button>
              <button className="btn btn-sm" onClick={() => api().answerApproval(chat.id, m.id, 'deny')}>거절</button>
              <button className="btn-text" onClick={() => api().answerApproval(chat.id, m.id, 'always')}>이 채팅에서 {agent?.name}은(는) 항상 승인</button>
            </div>
          ) : (
            <div className="meta">{m.status === 'approved' ? '승인함' : '거절함'}</div>
          )}
        </div>
      );
    case 'error':
      return <div className="error-line"><Icon.alert />{m.text}</div>;
    default:
      return null;
  }
}

// --- Composer ---

function Composer({ chat, members, busy }: { chat: Chat; members: Agent[]; busy: boolean }) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const names = members.map((a) => a.name);
  const options = menu
    ? members.filter((a) => a.name.includes(menu.query) || a.title.includes(menu.query))
    : [];

  // Grow the field with its content.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }, [text]);

  const updateMenu = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1])) && !/\s/.test(before.slice(at + 1))) {
      setMenu({ start: at, query: before.slice(at + 1) });
      setActive(0);
    } else setMenu(null);
  };

  const pick = (agent: Agent) => {
    const el = ta.current!;
    const start = menu ? menu.start : el.selectionStart;
    const end = menu ? menu.start + 1 + menu.query.length : el.selectionStart;
    const insert = `@${agent.name} `;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + insert.length;
    });
  };

  const send = () => {
    if (!text.trim()) return;
    api().sendMessage(chat.id, text);
    setText('');
    setMenu(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // Hangul IME is still composing
    if (menu && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[active]); return; }
    }
    if (menu && e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <form className="composer glass" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <button type="button" className="icon-btn round" aria-label="멘션 추가" aria-expanded={!!menu}
        style={{ fontSize: 15, fontWeight: 600 }}
        onClick={() => { if (menu) setMenu(null); else { setMenu({ start: ta.current?.selectionStart ?? text.length, query: '' }); setActive(0); } }}>@</button>
      <div className="grow" style={{ position: 'relative', display: 'flex' }}>
        <div aria-hidden="true" className="composer-backdrop">
          {splitMentions(text, names).map((s, i) => (s.mention ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}{'\n'}
        </div>
        <textarea ref={ta} rows={1} value={text} aria-label="메시지 입력" placeholder="메시지 입력 · @로 에이전트 멘션"
          onChange={(e) => { setText(e.target.value); updateMenu(e.target.value, e.target.selectionStart); }}
          onKeyDown={onKeyDown}
          onClick={(e) => updateMenu(text, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setMenu(null), 150)} />
      </div>
      {menu && (
        <div role="listbox" aria-label="멘션 자동완성" className="popover mention-menu">
          <div className="meta-strong" style={{ padding: '4px 8px' }}>에이전트</div>
          {options.map((a, i) => (
            <button key={a.id} type="button" role="option" aria-selected={i === active} className="option"
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)} onMouseEnter={() => setActive(i)}>
              <Avatar agent={a} size={24} />
              <span style={{ fontWeight: 700 }}>{a.name}</span>
              <span className="grow small muted">{a.title}</span>
              {i === active && <span className="meta">Enter</span>}
            </button>
          ))}
          {!options.length && <div className="meta" style={{ padding: '8px' }}>일치하는 멤버가 없습니다.</div>}
          <div className="meta" style={{ padding: '8px 8px 2px', borderTop: '1px solid var(--separator)', marginTop: 4 }}>↑↓ 이동 · Enter 선택 · Esc 닫기</div>
        </div>
      )}
      {busy && (
        <button type="button" className="icon-btn round" aria-label="모든 에이전트 작업 멈추기" title="멈추기" style={{ color: 'var(--ink)' }} onClick={() => api().stopChat(chat.id)}>
          <Icon.stop />
        </button>
      )}
      <button type="submit" className="send" aria-label="보내기" disabled={!text.trim()}><Icon.send /></button>
    </form>
  );
}

// --- Members panel ---

function MembersPanel({ state, chat, members, working, queued, onRemove, onInvite }: {
  state: AppState; chat: Chat; members: Agent[]; working: string[]; queued: string[];
  onRemove: (a: Agent) => void; onInvite: () => void;
}) {
  const others = state.agents.filter((a) => !members.includes(a));
  const project = state.projects.find((p) => p.id === chat.projectId);
  return (
    <aside className="side right" aria-label="멤버 상태">
      <div className="side-head"><h2 style={{ fontSize: 13, lineHeight: '16px', fontWeight: 700 }}>멤버</h2></div>
      <div className="side-scroll" style={{ padding: '12px 8px', gap: 16 }}>
        <section className="col" style={{ gap: 2 }}>
          <h3 className="section-label">이 채팅에 참여 중 · {members.length}</h3>
          {members.map((a) => {
            const isWorking = working.includes(a.id);
            const isQueued = queued.includes(a.id);
            const usage = state.usage[a.provider];
            const pct = usage ? Math.round(usage.utilization * 100) : null;
            const leader = chat.leaderAgentId === a.id;
            const alwaysApproved = chat.alwaysApproveAgentIds.includes(a.id);
            return (
              <div key={a.id} className="member">
                <div className="status-wrap">
                  <Avatar agent={a} size={40} />
                  <StatusDot usage={usage} />
                </div>
                <div className="col grow" style={{ gap: 2 }}>
                  <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{a.name}</span>
                    {leader && <span className="leader-chip">리더</span>}
                    <span className="meta">{isWorking ? '작업 중' : isQueued ? '차례 대기' : '대기'}</span>
                  </div>
                  <div className="small muted">{a.title} · {modelLabel(a.provider, a.model)}</div>
                  <div className="meta">승인: {alwaysApproved ? '이 채팅에서 항상 승인' : AGENT_MODE_LABEL[a.approvalMode]}</div>
                  <div className="row" style={{ gap: 8, paddingTop: 4 }}>
                    <div className="usage-track" role="img" aria-label={pct === null ? '세션 한도 사용량 알 수 없음' : `세션 한도 사용량 ${pct}%`}>
                      <div className="usage-fill" style={{ width: `${pct ?? 0}%` }} />
                    </div>
                    <span className="meta" style={{ whiteSpace: 'nowrap' }} title={usage?.resetsAt ? `${new Date(usage.resetsAt * 1000).toLocaleString('ko-KR')}에 초기화` : undefined}>
                      세션 {pct === null ? '—' : `${pct}%`}
                    </span>
                  </div>
                  {!leader && (
                    <button className="btn-text" style={{ alignSelf: 'flex-start', height: 22, padding: 0, fontSize: 12 }} onClick={() => api().setLeader(chat.id, a.id)}>
                      리더로 지정
                    </button>
                  )}
                </div>
                <button className="btn-text" aria-label={`${a.name} 내보내기`} title={members.length === 1 ? '마지막 멤버는 내보낼 수 없습니다' : `${a.name} 내보내기`}
                  disabled={members.length === 1} onClick={() => onRemove(a)}
                  style={{ width: 28, padding: 0, color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon.close />
                </button>
              </div>
            );
          })}
        </section>

        {others.length > 0 && (
          <section className="col" style={{ gap: 2 }}>
            <h3 className="section-label">초대할 수 있는 에이전트</h3>
            {others.map((a) => (
              <div key={a.id} className="row" style={{ gap: 12, padding: 8 }}>
                <div className="status-wrap">
                  <Avatar agent={a} size={40} />
                  <StatusDot usage={state.usage[a.provider]} />
                </div>
                <div className="col grow" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700 }}>{a.name}</span>
                  <span className="small muted">{a.title} · {modelLabel(a.provider, a.model)}</span>
                </div>
                <button className="btn-text" onClick={onInvite}>초대</button>
              </div>
            ))}
          </section>
        )}
      </div>
      <div className="meta" style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--separator)' }}>
        {project
          ? `에이전트는 '${project.name}' 프로젝트 안에서만 이 프로젝트의 기억을 공유합니다.`
          : '프로젝트에 속하지 않은 채팅이므로 에이전트는 이 채팅의 대화만 기억합니다.'}
      </div>
    </aside>
  );
}

function InvitePopover({ state, chat, onClose }: { state: AppState; chat: Chat; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'from-now'>('all');
  const others = state.agents.filter((a) => !chat.members.some((m) => m.agentId === a.id))
    .filter((a) => a.name.includes(query.trim()) || a.title.includes(query.trim()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 4 }} onClick={onClose} />
      <div role="dialog" aria-label="에이전트 초대" className="popover invite">
        <h1 className="title">에이전트 초대</h1>
        <label className="search">
          <Icon.search />
          <input type="search" autoFocus placeholder="이름 또는 직책 검색" aria-label="이름 또는 직책 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="col" style={{ gap: 2, maxHeight: 240, overflowY: 'auto' }}>
          {others.map((a) => (
            <div key={a.id} className="row" style={{ gap: 12, padding: '8px 0' }}>
              <Avatar agent={a} size={40} />
              <span className="col grow" style={{ gap: 2 }}>
                <span style={{ fontWeight: 700 }}>{a.name}</span>
                <span className="small muted">{a.title} · {modelLabel(a.provider, a.model)}</span>
              </span>
              <button className="btn-primary btn-sm" onClick={() => { api().inviteAgent(chat.id, a.id, scope); onClose(); }}>초대</button>
            </div>
          ))}
          {!others.length && <p className="meta" style={{ padding: '8px 0' }}>초대할 수 있는 에이전트가 없습니다.</p>}
        </div>
        <fieldset className="col" style={{ margin: 0, padding: '12px 0 0', border: 0, borderTop: '1px solid var(--separator)', gap: 8 }}>
          <legend className="meta-strong" style={{ padding: 0 }}>초대된 에이전트가 읽을 범위</legend>
          {([['all', '이전 대화 전체', '이 채팅의 처음부터 읽고 참여합니다.'], ['from-now', '지금부터', '초대된 이후의 메시지만 읽습니다.']] as const).map(([id, label, help]) => (
            <label key={id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
              <input type="radio" name="scope" checked={scope === id} onChange={() => setScope(id)} style={{ margin: '2px 0 0' }} />
              <span className="col" style={{ gap: 2 }}><span>{label}</span><span className="meta">{help}</span></span>
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}

function tildify(p: string): string {
  const m = p.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/);
  return m ? '~' + p.slice(m[1].length) : p;
}

function relative(folder: string, p: string): string {
  return p.startsWith(folder + '/') ? p.slice(folder.length + 1) : p;
}

// Green while the agent's session limit has room left, grey once it is used up. Unknown usage counts as available.
function StatusDot({ usage }: { usage?: Usage }) {
  const out = !!usage && usage.utilization >= 1;
  return <span className="status-dot" title={out ? '세션 한도 소진' : '사용 가능'} style={{ background: out ? 'var(--idle)' : 'var(--available)' }} />;
}

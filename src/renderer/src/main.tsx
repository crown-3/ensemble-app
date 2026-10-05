import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, AuthStatus, Chat, LoginState } from '../../shared/types';
import { AgentEdit, Agents } from './Agents';
import { ChatView } from './ChatView';
import logo from './logo.png';
import { NewChat } from './NewChat';
import { NewProjectDialog, ProjectHome, ProjectMemory } from './Projects';
import './styles.css';
import { api, go, Icon, shortWhen, useAppState, useRoute } from './ui';
import { installWebApi } from './webApi';

installWebApi();

function App() {
  const state = useAppState();
  const route = useRoute();
  if (!state) return null;
  const [page, id] = route;

  let content;
  if (page === 'chat' && state.chats.some((c) => c.id === id)) content = <ChatView key={id} state={state} chatId={id} />;
  // A chat that was just created can be opened before the new state arrives; wait for it.
  else if (page === 'chat') content = <main className="page" />;
  else if (page === 'new') content = <NewChat key={id ?? ''} state={state} projectId={state.projects.some((p) => p.id === id) ? id : null} />;
  else if (page === 'project' && state.projects.some((p) => p.id === id)) {
    content = route[2] === 'memory'
      ? <ProjectMemory state={state} projectId={id} agentId={route[3]} />
      : <ProjectHome key={id} state={state} projectId={id} />;
  }
  else if (page === 'agents' && id) content = <AgentEdit key={id} state={state} agentId={id === 'new' ? null : id} />;
  else if (page === 'agents') content = <Agents state={state} />;
  else if (page === 'home') content = <Welcome state={state} />;
  else if (state.chats.length) {
    go(`#/chat/${state.chats[0].id}`);
    return null;
  } else content = <Welcome state={state} />;

  return (
    <div className="shell">
      <Sidebar state={state} route={route} />
      {content}
    </div>
  );
}

function Sidebar({ state, route }: { state: AppState; route: string[] }) {
  const [query, setQuery] = useState('');
  const [newProject, setNewProject] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const matches = (c: Chat) => c.title.toLowerCase().includes(q);
  const currentChat = route[0] === 'chat' ? state.chats.find((c) => c.id === route[1]) : undefined;
  const currentProject = route[0] === 'project' || route[0] === 'new' ? route[1] : currentChat?.projectId;
  const loose = state.chats.filter((c) => !c.projectId && matches(c));
  const projects = state.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || state.chats.some((c) => c.projectId === p.id && matches(c)));

  return (
    <nav className="side" aria-label="프로젝트와 채팅">
      <div className="side-head">
        <a href="#/home" aria-label="처음 화면">
          <img className="logo" src={logo} alt="Ensemble" />
        </a>
        <a className="icon-btn" href="#/new" aria-label="새 채팅">
          <Icon.compose />
        </a>
      </div>
      <div style={{ padding: '12px 12px 4px' }}>
        <label className="search">
          <Icon.search />
          <input type="search" placeholder="프로젝트, 채팅 검색" aria-label="프로젝트, 채팅 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="side-scroll" style={{ gap: 16 }}>
        <section className="col" style={{ gap: 2 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '4px 4px 4px 8px' }}>
            <h2 className="section-label" style={{ padding: 0 }}>프로젝트</h2>
            <button className="tiny-btn" aria-label="새 프로젝트" title="새 프로젝트" onClick={() => setNewProject(true)}><Icon.plus /></button>
          </div>
          {projects.map((p) => {
            const chats = state.chats.filter((c) => c.projectId === p.id);
            const shown = q && !p.name.toLowerCase().includes(q) ? chats.filter(matches) : chats;
            const expanded = q ? true : open[p.id] ?? p.id === currentProject;
            return (
              <div key={p.id} className="col" style={{ gap: 2 }}>
                <div className="row project-row" aria-current={route[0] === 'project' && route[1] === p.id ? 'page' : undefined}>
                  <button className="tiny-btn" aria-expanded={expanded} aria-label={expanded ? `${p.name} 접기` : `${p.name} 펼치기`}
                    onClick={() => setOpen({ ...open, [p.id]: !expanded })}>
                    {expanded ? <Icon.chevronDown /> : <Icon.chevronRight />}
                  </button>
                  <a className="row grow" href={`#/project/${p.id}`} style={{ gap: 8, color: 'inherit', height: 36 }}>
                    <Icon.folder />
                    <span className="grow" style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    <span className="meta count">{chats.length}</span>
                  </a>
                </div>
                {expanded && (
                  <div className="col" style={{ gap: 2, paddingLeft: 20 }}>
                    {shown.map((c) => <ChatRow key={c.id} state={state} chat={c} current={currentChat?.id === c.id} />)}
                    <a className="row" href={`#/new/${p.id}`} style={{ gap: 4, height: 32, padding: '0 12px', borderRadius: 8 }}>
                      <Icon.plus /><span>이 프로젝트에 새 채팅</span>
                    </a>
                  </div>
                )}
              </div>
            );
          })}
          {!state.projects.length && <p className="meta" style={{ padding: '4px 8px' }}>아직 프로젝트가 없습니다.</p>}
        </section>

        <section className="col" style={{ gap: 2 }}>
          <h2 className="section-label">채팅</h2>
          {loose.map((c) => <ChatRow key={c.id} state={state} chat={c} current={currentChat?.id === c.id} />)}
          {!state.chats.some((c) => !c.projectId) && <p className="meta" style={{ padding: '4px 8px' }}>프로젝트에 속하지 않은 채팅이 없습니다.</p>}
        </section>
        {q && !projects.length && !loose.length && <p className="meta" style={{ padding: '4px 8px' }}>검색 결과가 없습니다.</p>}
      </div>
      <div className="side-foot">
        <a className="nav-row" href="#/agents" aria-current={route[0] === 'agents' ? 'page' : undefined}>
          <Icon.sliders />
          <span>전역 역할 설정</span>
        </a>
      </div>
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
    </nav>
  );
}

function ChatRow({ state, chat, current }: { state: AppState; chat: Chat; current: boolean }) {
  const name = (id: string) => state.agents.find((a) => a.id === id)?.name;
  return (
    <a className="chat-row" href={`#/chat/${chat.id}`} aria-current={current ? 'page' : undefined}>
      <span className="col grow" style={{ gap: 2 }}>
        <span className="name">{chat.title}</span>
        <span className="sub">
          {chat.members.map((m) => name(m.agentId)).filter(Boolean).join(', ')} · {shortWhen(chat.updatedAt)}
        </span>
      </span>
      {chat.unread && !current && <span className="unread-dot" aria-label="읽지 않음" />}
    </a>
  );
}

const LOGIN_LABEL: Record<LoginState, string> = { in: '로그인됨', out: '로그인 필요', missing: '설치되지 않음' };

function Welcome({ state }: { state: AppState }) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const checkAuth = () => {
    setAuth(null);
    api().authStatus().then(setAuth);
  };
  useEffect(checkAuth, []);
  const loggedIn = !!auth && (auth.claude === 'in' || auth.codex === 'in');
  const steps = [
    {
      title: 'Claude Code 또는 Codex 로그인',
      body: (
        <>
          터미널에서 claude 나 codex 를 실행해 로그인합니다. 에이전트는 이 계정의 세션 한도를 사용합니다.
          <br />
          {auth ? `Claude Code: ${LOGIN_LABEL[auth.claude]} · Codex: ${LOGIN_LABEL[auth.codex]}` : '로그인 상태 확인 중…'}
        </>
      ),
      done: loggedIn,
      button: auth && !loggedIn ? '다시 확인' : undefined,
    },
    { title: '에이전트 만들기', body: '이름, 직책, 모델, 페르소나를 정합니다.', href: '#/agents/new', action: '만들기', done: state.agents.length > 0 },
    { title: '첫 채팅 시작', body: '에이전트를 초대하고 첫 메시지를 보냅니다.', href: '#/new', action: '새 채팅', done: false },
  ];
  return (
    <main className="page" style={{ alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
      <div className="col" style={{ maxWidth: 520, gap: 24 }}>
        <div className="col" style={{ gap: 8 }}>
          <h1 className="title-large">나만의 에이전트 회사를 시작하세요</h1>
          <p className="muted" style={{ lineHeight: '17px' }}>
            Ensemble에서는 직책과 역할이 다른 에이전트들이 한 채팅에 모여 함께 결과물을 만듭니다.
          </p>
        </div>
        <ol className="col" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 12 }}>
          {steps.map((s, i) => (
            <li key={s.title} className="row card" style={{ gap: 12, padding: 12 }}>
              <span className="avatar" style={{ width: 28, height: 28, background: 'var(--selected)', color: 'var(--ink)', fontSize: 11, fontWeight: 600 }}>
                {i + 1}
              </span>
              <span className="col grow" style={{ gap: 2 }}>
                <span style={{ fontWeight: 700 }}>{s.title}</span>
                <span className="small muted">{s.body}</span>
              </span>
              {s.href && (!s.done || i === 2) && <a href={s.href}>{s.action}</a>}
              {s.button && (
                <button className="btn" onClick={checkAuth}>
                  {s.button}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

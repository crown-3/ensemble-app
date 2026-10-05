import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState } from '../../shared/types';
import { AgentEdit, Agents } from './Agents';
import { ChatView } from './ChatView';
import logo from './logo.png';
import { NewChat } from './NewChat';
import './styles.css';
import { go, Icon, shortWhen, useAppState, useRoute } from './ui';
import { installWebApi } from './webApi';

installWebApi();

function App() {
  const state = useAppState();
  const route = useRoute();
  if (!state) return null;
  const [page, id] = route;

  let content;
  if (page === 'chat' && state.chats.some((c) => c.id === id)) content = <ChatView key={id} state={state} chatId={id} />;
  else if (page === 'new') content = <NewChat state={state} />;
  else if (page === 'agents' && id) content = <AgentEdit key={id} state={state} agentId={id === 'new' ? null : id} />;
  else if (page === 'agents') content = <Agents state={state} />;
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
  const name = (id: string) => state.agents.find((a) => a.id === id)?.name;
  const chats = state.chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <nav className="side" aria-label="채팅">
      <div className="side-head">
        <img className="logo" src={logo} alt="Ensemble" />
        <a className="icon-btn" href="#/new" aria-label="새 채팅">
          <Icon.compose />
        </a>
      </div>
      <div style={{ padding: '12px 12px 4px' }}>
        <label className="search">
          <Icon.search />
          <input type="search" placeholder="채팅 검색" aria-label="채팅 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="side-scroll">
        <h2 className="section-label">채팅</h2>
        {chats.map((c) => {
          const current = route[0] === 'chat' && route[1] === c.id;
          return (
            <a key={c.id} className="chat-row" href={`#/chat/${c.id}`} aria-current={current ? 'page' : undefined}>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="name">{c.title}</span>
                <span className="sub">
                  {c.members.map((m) => name(m.agentId)).filter(Boolean).join(', ')} · {shortWhen(c.updatedAt)}
                </span>
              </span>
              {c.unread && !current && <span className="unread-dot" aria-label="읽지 않음" />}
            </a>
          );
        })}
        {!state.chats.length && <p className="meta" style={{ padding: '4px 8px' }}>아직 채팅이 없습니다.</p>}
        {state.chats.length > 0 && !chats.length && <p className="meta" style={{ padding: '4px 8px' }}>검색 결과가 없습니다.</p>}
      </div>
      <div className="side-foot">
        <a className="nav-row" href="#/agents" aria-current={route[0] === 'agents' ? 'page' : undefined}>
          <Icon.sliders />
          <span>전역 역할 설정</span>
        </a>
      </div>
    </nav>
  );
}

function Welcome({ state }: { state: AppState }) {
  const steps = [
    { title: 'Claude Code 로그인', body: '터미널에서 claude 를 실행해 로그인합니다. 에이전트는 이 계정의 세션 한도를 사용합니다.', done: true },
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
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

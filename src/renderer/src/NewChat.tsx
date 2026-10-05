import { useEffect, useState } from 'react';
import { modelLabel } from '../../shared/models';
import type { AppState } from '../../shared/types';
import { api, Avatar, go, Icon } from './ui';

export function NewChat({ state }: { state: AppState }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [leader, setLeader] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    api().defaultFolder().then((f) => setFolder((cur) => cur || f));
  }, []);

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (!leader || !next.includes(leader)) setLeader(next[0] ?? null);
  };
  const names = picked.map((id) => state.agents.find((a) => a.id === id)!.name);
  const canStart = picked.length > 0 && leader && folder;

  const start = async () => {
    if (!canStart) return;
    const id = await api().createChat({ agentIds: picked, leaderAgentId: leader, folderPath: folder, firstMessage: text });
    go(`#/chat/${id}`);
  };

  return (
    <main className="page">
      <header className="page-head"><h1>새 채팅</h1></header>
      <div className="page-body" style={{ padding: '48px 24px' }}>
        <div className="col" style={{ maxWidth: 720, margin: '0 auto', gap: 24 }}>
          <div className="col" style={{ gap: 8 }}>
            <h2 className="title-large">누구와 시작할까요?</h2>
            <p className="muted">에이전트를 한 명 이상 선택하세요. 채팅을 진행하는 중에도 다른 에이전트를 초대하거나 내보낼 수 있습니다.</p>
          </div>

          {state.agents.length === 0 ? (
            <div className="card row" style={{ padding: 16, gap: 12 }}>
              <span className="grow">아직 에이전트가 없습니다. 먼저 에이전트를 만드세요.</span>
              <a className="btn-primary row" href="#/agents/new">에이전트 만들기</a>
            </div>
          ) : (
            <div className="pick-grid">
              {state.agents.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button key={a.id} className="pick" aria-pressed={on} onClick={() => toggle(a.id)}>
                    <Avatar agent={a} size={40} />
                    <span className="col grow" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 700 }}>{a.name}</span>
                      <span className="small muted">{a.title}</span>
                      <span className="meta">{modelLabel(a.provider, a.model)}</span>
                    </span>
                    {on && <span className="check" aria-hidden="true"><Icon.check /></span>}
                  </button>
                );
              })}
            </div>
          )}

          {picked.length > 1 && (
            <fieldset className="col card" style={{ margin: 0, padding: 12, gap: 8 }}>
              <legend style={{ padding: 0, fontWeight: 700, float: 'left' }}>리더</legend>
              <span className="small muted">멘션 없이 보낸 메시지에는 리더가 답합니다. 리더는 필요하면 다른 에이전트를 멘션해 일을 넘깁니다.</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {picked.map((id, i) => (
                  <label key={id} className="row" style={{ gap: 6, height: 28, padding: '0 12px', borderRadius: 999, background: leader === id ? 'var(--selected)' : 'transparent', fontWeight: leader === id ? 600 : 400, cursor: 'pointer' }}>
                    <input type="radio" name="leader" checked={leader === id} onChange={() => setLeader(id)} style={{ margin: 0 }} />
                    {names[i]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="row" style={{ alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 14, background: 'var(--surface-sidebar)' }}>
            <span className="muted" style={{ flexShrink: 0 }}><Icon.folder /></span>
            <div className="col" style={{ gap: 2 }}>
              <div style={{ fontWeight: 700 }}>프로젝트 없음</div>
              <div className="small muted">이 채팅은 어느 프로젝트에도 속하지 않습니다. 채팅을 만든 뒤에는 프로젝트로 옮길 수 없습니다.</div>
            </div>
          </div>

          <div className="row card" style={{ flexWrap: 'wrap', gap: 12, padding: 12 }}>
            <div className="col" style={{ flex: '1 1 280px', minWidth: 0, gap: 2 }}>
              <div style={{ fontWeight: 700 }}>작업 폴더</div>
              <div className="mono" style={{ overflowWrap: 'anywhere' }}>{folder || '…'}</div>
              <div className="small muted">에이전트는 이 폴더 안에서만 파일을 읽고 만들고 수정합니다.</div>
            </div>
            <button className="btn" onClick={async () => { const f = await api().pickFolder(); if (f) setFolder(f); }}>폴더 변경</button>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div className="meta">
              {names.length
                ? `${names.join(', ')} 선택됨 · ${names.length}명${leader && names.length > 1 ? ` · 리더 ${state.agents.find((a) => a.id === leader)?.name}` : ''}`
                : '선택된 에이전트가 없습니다. 한 명 이상 선택해야 채팅을 시작할 수 있습니다.'}
            </div>
            <form className="row" style={{ margin: 0, gap: 8 }} onSubmit={(e) => { e.preventDefault(); start(); }}>
              <label className="row grow" style={{ minHeight: 36, padding: '0 12px', background: 'var(--field)', border: '1px solid var(--field-border)', borderRadius: 17 }}>
                <input className="grow" placeholder="첫 메시지 입력" aria-label="첫 메시지 입력" value={text} onChange={(e) => setText(e.target.value)}
                  style={{ border: 0, outline: 0, background: 'transparent', lineHeight: '17px' }} />
              </label>
              <button className="btn-primary" style={{ height: 36 }} disabled={!canStart}>채팅 시작</button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

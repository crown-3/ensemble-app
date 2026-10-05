import { useEffect, useState } from 'react';
import { modelLabel } from '../../shared/models';
import type { AppState, MemoryEntry, Project } from '../../shared/types';
import { api, Avatar, go, Icon, shortWhen, timeLabel } from './ui';

const basename = (p: string) => p.split(/[\\/]/).pop() || p;

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folder, setFolder] = useState('');
  const create = async () => {
    const id = await api().createProject({ name: name.trim(), description: description.trim(), folderPath: folder });
    onClose();
    go(`#/project/${id}`);
  };
  return (
    <div className="overlay" onClick={onClose}>
      <form role="dialog" aria-labelledby="np-title" className="popover dialog" style={{ width: 432, gap: 16 }}
        onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (name.trim() && folder) create(); }}>
        <h1 id="np-title" className="title">새 프로젝트</h1>
        <label className="label">
          <span>이름</span>
          <input className="field" placeholder="프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="label">
          <span>설명 (선택)</span>
          <textarea className="field" rows={3} placeholder="이 프로젝트에서 하려는 작업" value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'none' }} />
        </label>
        <div className="label">
          <span>작업 폴더</span>
          <div className="row" style={{ gap: 8 }}>
            <div className="field row grow mono" style={{ color: folder ? 'var(--ink)' : 'var(--ink-placeholder)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {folder || '선택한 폴더가 없습니다'}
            </div>
            <button type="button" className="btn" style={{ height: 36 }} onClick={async () => { const f = await api().pickFolder(); if (f) setFolder(f); }}>폴더 선택</button>
          </div>
          <span className="meta">이 프로젝트의 모든 채팅이 이 폴더 안에서 작업합니다.</span>
        </div>
        <p className="small muted">
          에이전트는 프로젝트마다 별도의 메모리를 가집니다. 이미 만든 채팅은 프로젝트로 옮길 수 없으며, 프로젝트 안에서 새로 만든 채팅만 여기에 속합니다.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={!name.trim() || !folder}>만들기</button>
        </div>
      </form>
    </div>
  );
}

export function ProjectHome({ state, projectId }: { state: AppState; projectId: string }) {
  const project = state.projects.find((p) => p.id === projectId)!;
  const [instructions, setInstructions] = useState(project.instructions);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const chats = state.chats.filter((c) => c.projectId === projectId);
  const memoryCount = (agentId: string) => state.memories.filter((m) => m.projectId === projectId && m.agentId === agentId).length;
  const name = (id: string) => state.agents.find((a) => a.id === id)?.name;
  const update = (patch: Partial<Project>) => api().updateProject(projectId, patch);

  return (
    <main className="page">
      <header className="page-head" style={{ gap: 8 }}>
        <h1 className="grow">{project.name}</h1>
        <button className="btn-text" style={{ height: 32 }} onClick={() => setRenaming(true)}>이름 변경</button>
        <button className="btn-text danger" style={{ height: 32 }} onClick={() => setDeleting(true)}>프로젝트 삭제</button>
        <a className="btn-primary row" href={`#/new/${projectId}`}>이 프로젝트에 새 채팅</a>
      </header>
      <div className="page-body">
        <div className="col" style={{ maxWidth: 760, margin: '0 auto', gap: 32 }}>
          <div className="col" style={{ gap: 8 }}>
            <h2 className="title-large">{project.name}</h2>
            {project.description && <p className="muted" style={{ lineHeight: '17px' }}>{project.description}</p>}
          </div>

          <section className="col" style={{ gap: 8 }}>
            <h3 className="title">작업 폴더</h3>
            <div className="card row" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 16px' }}>
              <span className="muted"><Icon.folder /></span>
              <div className="col" style={{ flex: '1 1 280px', minWidth: 0, gap: 2 }}>
                <div className="mono" style={{ overflowWrap: 'anywhere' }}>{project.folderPath}</div>
                <div className="small muted">이 프로젝트의 모든 채팅은 이 폴더 안에서 파일을 읽고 만들고 수정합니다.</div>
              </div>
              <button className="btn-text" onClick={() => api().openPath(project.folderPath)}>폴더 열기</button>
              <button className="btn-text" onClick={async () => { const f = await api().pickFolder(); if (f) update({ folderPath: f }); }}>폴더 변경</button>
            </div>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h3 className="title">프로젝트 지침</h3>
            <label className="label">
              <span className="muted" style={{ fontWeight: 400 }}>이 프로젝트의 모든 채팅에서 모든 에이전트에게 전달됩니다. 전역 지침 다음에, 에이전트의 페르소나보다 먼저 적용됩니다.</span>
              <textarea className="field" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </label>
            <button className="btn-primary" style={{ alignSelf: 'flex-end' }} disabled={instructions === project.instructions} onClick={() => update({ instructions })}>지침 저장</button>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 className="title grow">참고 파일</h3>
              <button className="btn" onClick={async () => {
                const f = await api().pickFile();
                if (f && !project.referenceFiles.includes(f)) update({ referenceFiles: [...project.referenceFiles, f] });
              }}>
                <Icon.plus /><span>파일 추가</span>
              </button>
            </div>
            <p className="muted">에이전트가 이 프로젝트에서 항상 참고하는 파일입니다. 작업 폴더 밖에 있어도 읽을 수 있지만 수정하지는 않습니다.</p>
            {project.referenceFiles.length > 0 && (
              <div className="list-card">
                {project.referenceFiles.map((f) => (
                  <div key={f} className="row" style={{ gap: 12, padding: '12px 16px' }}>
                    <span className="muted"><Icon.file /></span>
                    <button className="col grow" style={{ gap: 2, border: 0, padding: 0, background: 'transparent', textAlign: 'left' }} title="파일 열기" onClick={() => api().openPath(f)}>
                      <span style={{ fontWeight: 700 }}>{basename(f)}</span>
                      <span className="meta mono" style={{ overflowWrap: 'anywhere' }}>{f}</span>
                    </button>
                    <button className="btn-text danger" onClick={() => update({ referenceFiles: project.referenceFiles.filter((x) => x !== f) })}>제거</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h3 className="title">채팅</h3>
            {chats.length > 0 ? (
              <div className="list-card">
                {chats.map((c) => (
                  <a key={c.id} href={`#/chat/${c.id}`} className="row" style={{ gap: 12, minHeight: 62, padding: '12px 16px', color: 'var(--ink)' }}>
                    <span className="col grow" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 700 }}>{c.title}</span>
                      <span className="small muted">{c.members.map((m) => name(m.agentId)).filter(Boolean).join(', ')}</span>
                    </span>
                    <span className="meta" style={{ whiteSpace: 'nowrap' }}>{shortWhen(c.updatedAt)}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="note">아직 채팅이 없습니다. "이 프로젝트에 새 채팅"으로 시작하세요.</p>
            )}
            <p className="meta">이 프로젝트 안에서 만든 채팅만 여기에 표시됩니다. 다른 곳에서 만든 채팅은 프로젝트로 옮길 수 없습니다.</p>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h3 className="title">에이전트 메모리</h3>
            <p className="muted">각 에이전트는 이 프로젝트의 채팅들에서 쌓은 기억을 공유하며, 다른 프로젝트에서는 이 기억을 사용하지 않습니다.</p>
            {state.agents.length > 0 ? (
              <div className="list-card">
                {state.agents.map((a) => (
                  <div key={a.id} className="row" style={{ gap: 12, minHeight: 62, padding: '12px 16px' }}>
                    <Avatar agent={a} size={40} />
                    <span className="col grow" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 700 }}>{a.name}</span>
                      <span className="small muted">{a.title} · 기억 {memoryCount(a.id)}개</span>
                    </span>
                    <a href={`#/project/${projectId}/memory/${a.id}`} style={{ whiteSpace: 'nowrap' }}>메모리 보기</a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="note">아직 에이전트가 없습니다.</p>
            )}
          </section>
        </div>
      </div>

      {renaming && <RenameDialog project={project} onClose={() => setRenaming(false)} />}
      {deleting && (
        <div className="overlay" onClick={() => setDeleting(false)}>
          <div role="alertdialog" aria-labelledby="dp-title" className="popover dialog" onClick={(e) => e.stopPropagation()}>
            <h1 id="dp-title" className="title">'{project.name}' 프로젝트를 삭제할까요?</h1>
            <p className="muted" style={{ lineHeight: '17px' }}>
              이 프로젝트의 채팅 {chats.length}개와 에이전트 메모리 {state.memories.filter((m) => m.projectId === projectId).length}개가 함께 삭제되며 되돌릴 수 없습니다.
              진행 중인 작업은 멈춥니다. 작업 폴더의 파일은 삭제되지 않습니다.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
              <button className="btn" onClick={() => setDeleting(false)}>취소</button>
              <button className="btn-danger" onClick={async () => { await api().deleteProject(projectId); go('#/home'); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function RenameDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  return (
    <div className="overlay" onClick={onClose}>
      <form role="dialog" aria-labelledby="rn-title" className="popover dialog" style={{ gap: 16 }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; api().updateProject(project.id, { name: name.trim(), description: description.trim() }); onClose(); }}>
        <h1 id="rn-title" className="title">이름 변경</h1>
        <label className="label">
          <span>이름</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="label">
          <span>설명 (선택)</span>
          <textarea className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'none' }} />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={!name.trim()}>저장</button>
        </div>
      </form>
    </div>
  );
}

export function ProjectMemory({ state, projectId, agentId }: { state: AppState; projectId: string; agentId?: string }) {
  const project = state.projects.find((p) => p.id === projectId)!;
  const agent = state.agents.find((a) => a.id === agentId) ?? state.agents[0];
  const [editing, setEditing] = useState<string | null>(null); // entry id, or 'new'
  const [draft, setDraft] = useState('');
  useEffect(() => setEditing(null), [agent?.id]);

  const entriesOf = (id: string) => state.memories.filter((m) => m.projectId === projectId && m.agentId === id);
  const entries = agent ? entriesOf(agent.id) : [];
  const chatTitle = (id: string) => state.chats.find((c) => c.id === id)?.title;
  const sourceLabel = (m: MemoryEntry) =>
    m.source === 'manual' ? '직접 추가함' : chatTitle(m.source.chatId) ? `${chatTitle(m.source.chatId)}에서 기록` : '삭제된 채팅에서 기록';
  const startEdit = (id: string, text: string) => {
    setEditing(id);
    setDraft(text);
  };
  const save = () => {
    if (!agent || !draft.trim()) return;
    api().saveMemory(projectId, agent.id, editing === 'new' ? null : editing, draft);
    setEditing(null);
  };

  const editor = (label: string, meta: string) => (
    <article className="col" style={{ gap: 8, padding: '12px 16px', border: '1px solid var(--field-border)', borderRadius: 14 }}>
      <label className="label">
        <span className="meta-strong">{label}</span>
        <textarea className="field" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      </label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="meta grow">{meta}</span>
        <button className="btn btn-sm" onClick={() => setEditing(null)}>취소</button>
        <button className="btn-primary btn-sm" disabled={!draft.trim()} onClick={save}>저장</button>
      </div>
    </article>
  );

  return (
    <main className="page">
      <header className="page-head" style={{ gap: 8 }}>
        <a href={`#/project/${projectId}`}>{project.name}</a>
        <span className="muted">/</span>
        <h1>에이전트 메모리</h1>
      </header>
      <div className="row" style={{ flexGrow: 1, minHeight: 0, alignItems: 'stretch', flexWrap: 'wrap', overflowY: 'auto' }}>
        <div role="tablist" aria-label="에이전트" className="col" style={{ flex: '1 1 220px', maxWidth: 280, padding: '16px 8px', gap: 2 }}>
          {state.agents.map((a) => (
            <a key={a.id} role="tab" aria-selected={a.id === agent?.id} href={`#/project/${projectId}/memory/${a.id}`} className="row"
              style={{ gap: 12, padding: 8, borderRadius: 8, color: 'var(--ink)', background: a.id === agent?.id ? 'var(--selected)' : 'transparent' }}>
              <Avatar agent={a} size={28} />
              <span className="grow" style={{ fontWeight: 700 }}>{a.name}</span>
              <span className="meta">{entriesOf(a.id).length}</span>
            </a>
          ))}
          {!state.agents.length && <p className="meta" style={{ padding: 8 }}>아직 에이전트가 없습니다.</p>}
        </div>
        {agent && (
          <div style={{ flex: '999 1 420px', minWidth: 0, padding: 24, borderLeft: '1px solid var(--separator)' }}>
            <div className="col" style={{ maxWidth: 640, gap: 16 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="col grow" style={{ gap: 2 }}>
                  <h2 className="title">{agent.name}의 메모리</h2>
                  <div className="small muted">{agent.title} · {modelLabel(agent.provider, agent.model)}</div>
                </div>
                <button className="btn" onClick={() => startEdit('new', '')}><Icon.plus /><span>기억 추가</span></button>
              </div>
              <p className="note">
                {agent.name}이(가) {project.name} 프로젝트의 모든 채팅에서 함께 사용하는 기억입니다. 다른 프로젝트에서는 이 기억을 사용하지 않습니다.
              </p>
              {editing === 'new' && editor('새 기억', '직접 추가함')}
              {entries.map((m) =>
                editing === m.id ? (
                  <div key={m.id}>{editor('기억 수정', `${when(m.createdAt)} · ${sourceLabel(m)}`)}</div>
                ) : (
                  <article key={m.id} className="card col" style={{ gap: 8, padding: '12px 16px' }}>
                    <p style={{ lineHeight: '17px', whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <span className="meta grow">{when(m.createdAt)} · {sourceLabel(m)}</span>
                      <button className="btn-text" onClick={() => startEdit(m.id, m.content)}>수정</button>
                      <button className="btn-text danger" onClick={() => api().deleteMemory(m.id)}>삭제</button>
                    </div>
                  </article>
                ),
              )}
              {!entries.length && editing !== 'new' && (
                <p className="meta">아직 기억이 없습니다. 에이전트가 이 프로젝트의 채팅에서 필요한 내용을 스스로 기록하며, 직접 추가할 수도 있습니다.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// "오늘 오전 10:05", "어제 오후 4:12", "10월 3일 오후 2:00"
function when(iso: string): string {
  const day = shortWhen(iso);
  return day === timeLabel(iso) ? `오늘 ${day}` : `${day} ${timeLabel(iso)}`;
}

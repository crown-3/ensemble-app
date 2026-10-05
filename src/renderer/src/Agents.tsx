import { useState } from 'react';
import { MODELS, modelLabel, PROVIDERS } from '../../shared/models';
import type { Agent, AgentApprovalMode, AppState, HistoryEntry, Provider } from '../../shared/types';
import { api, Avatar, go, Icon } from './ui';

export function Agents({ state }: { state: AppState }) {
  const [instructions, setInstructions] = useState(state.settings.globalInstructions);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const dirty = instructions !== state.settings.globalInstructions;
  return (
    <main className="page">
      <header className="page-head">
        <h1 className="grow">전역 역할 설정</h1>
        <a className="btn-primary row" href="#/agents/new">에이전트 추가</a>
      </header>
      <div className="page-body">
        <div className="col" style={{ maxWidth: 960, margin: '0 auto', gap: 24 }}>
          <div className="col" style={{ gap: 8 }}>
            <h2 className="title-large">에이전트 회사원</h2>
            <p className="muted" style={{ lineHeight: '17px' }}>
              에이전트의 기본 속성을 관리합니다. 여기에서 변경한 내용은 모든 채팅에 적용됩니다.
            </p>
          </div>

          <section className="col card" style={{ gap: 8, padding: 16 }}>
            <h3 className="title">전역 지침</h3>
            <label className="col" style={{ gap: 4 }}>
              <span className="muted">모든 에이전트에게 공통으로 전달됩니다. 전역 지침, 프로젝트 지침, 에이전트의 페르소나 순서로 적용됩니다.</span>
              <textarea className="field" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="예: 항상 한국어로 답합니다." />
            </label>
            <button className="btn-primary" style={{ alignSelf: 'flex-end' }} disabled={!dirty} onClick={() => api().saveSettings({ globalInstructions: instructions })}>
              {dirty ? '지침 저장' : '저장됨'}
            </button>
          </section>

          {state.agents.length === 0 && (
            <div className="card col" style={{ padding: 24, gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>아직 에이전트가 없습니다</span>
              <span className="muted">에이전트를 추가해 첫 직원을 만드세요.</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
            {state.agents.map((a) => (
              <article key={a.id} className="col card" style={{ gap: 12, padding: 16 }}>
                <div className="row" style={{ gap: 12 }}>
                  <Avatar agent={a} size={56} />
                  <div className="col" style={{ minWidth: 0, gap: 2 }}>
                    <h3 className="title">{a.name}</h3>
                    <div className="muted">{a.title}</div>
                  </div>
                </div>
                <div className="chip" style={{ alignSelf: 'flex-start', padding: '4px 8px', background: 'var(--surface-sidebar)' }}>
                  {modelLabel(a.provider, a.model).replace(' ', ' · ')}
                </div>
                <p className="small muted" style={{ flexGrow: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {a.persona}
                </p>
                <div className="row" style={{ gap: 4, paddingTop: 8, borderTop: '1px solid var(--separator)' }}>
                  <a className="btn-text row" href={`#/agents/${a.id}`}>편집</a>
                  <button className="btn-text" onClick={() => api().duplicateAgent(a.id)}>복제</button>
                  <span className="grow" />
                  <button className="btn-text danger" onClick={() => setDeleting(a)}>삭제</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
      {deleting && (
        <div className="overlay" onClick={() => setDeleting(null)}>
          <div role="alertdialog" aria-labelledby="del-title" className="popover dialog" onClick={(e) => e.stopPropagation()}>
            <h1 id="del-title" className="title">{deleting.name}을(를) 삭제할까요?</h1>
            <p className="muted" style={{ lineHeight: '17px' }}>
              참여 중인 모든 채팅에서 나가고, 이력도 함께 삭제됩니다. 지금까지의 채팅 메시지는 남습니다. 되돌릴 수 없습니다.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
              <button className="btn" onClick={() => setDeleting(null)}>취소</button>
              <button className="btn-danger" onClick={() => { api().deleteAgent(deleting.id); setDeleting(null); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const APPROVAL_OPTIONS: { id: AgentApprovalMode; label: string; help: string }[] = [
  { id: 'inherit', label: '채팅 설정을 따름', help: '각 채팅에서 고른 승인 방식을 그대로 사용합니다.' },
  { id: 'always-ask', label: '항상 승인 요청', help: '채팅 설정이 자동 승인이어도 이 에이전트는 매번 승인을 요청합니다.' },
  { id: 'always-auto', label: '항상 자동 승인', help: '이 에이전트의 작업은 승인을 요청하지 않고 실행합니다.' },
];

const SOURCE_LABEL: Record<HistoryEntry['source'], string> = {
  auto: '자동 기록',
  'auto-edited': '자동 기록 · 수정됨',
  manual: '직접 입력',
};

export function AgentEdit({ state, agentId }: { state: AppState; agentId: string | null }) {
  const existing = state.agents.find((a) => a.id === agentId);
  const [form, setForm] = useState(() => ({
    name: existing?.name ?? '',
    title: existing?.title ?? '',
    provider: existing?.provider ?? ('claude' as Provider),
    model: existing?.model ?? MODELS.claude[0].id,
    avatar: existing?.avatar,
    persona: existing?.persona ?? '',
    approvalMode: existing?.approvalMode ?? ('inherit' as AgentApprovalMode),
    history: existing?.history ?? [],
  }));
  const [editing, setEditing] = useState<{ id: string; time: string; content: string } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.title.trim() && form.model;

  const save = async () => {
    if (!valid) return;
    await api().saveAgent(agentId, { ...form, name: form.name.trim(), title: form.title.trim() });
    go('#/agents');
  };

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const s = Math.min(img.width, img.height);
      canvas.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      set('avatar', canvas.toDataURL('image/png'));
    };
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.readAsDataURL(file);
  };

  const commitHistory = () => {
    if (!editing || !editing.content.trim()) return setEditing(null);
    const time = new Date(editing.time).toISOString();
    const old = form.history.find((h) => h.id === editing.id);
    const entry: HistoryEntry = old
      ? { ...old, time, content: editing.content.trim(), source: old.source === 'manual' ? 'manual' : 'auto-edited' }
      : { id: editing.id, time, content: editing.content.trim(), source: 'manual' };
    const history = old ? form.history.map((h) => (h.id === old.id ? entry : h)) : [entry, ...form.history];
    set('history', history.sort((a, b) => b.time.localeCompare(a.time)));
    setEditing(null);
  };

  const preview = { ...(existing ?? { id: '', tint: '#dfe6f1' }), name: form.name || '?', avatar: form.avatar } as Agent;

  return (
    <main className="page">
      <header className="page-head" style={{ gap: 8 }}>
        <a href="#/agents">전역 역할 설정</a>
        <span className="muted">/</span>
        <h1 className="grow">{existing ? existing.name : '새 에이전트'}</h1>
        <a className="btn" href="#/agents" style={{ color: 'var(--ink)' }}>취소</a>
        <button className="btn-primary" disabled={!valid} onClick={save}>저장</button>
      </header>
      <div className="page-body">
        <form className="col" style={{ maxWidth: 680, margin: '0 auto', gap: 24 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="row" style={{ gap: 16 }}>
            <Avatar agent={preview} size={80} />
            <div className="col" style={{ alignItems: 'flex-start', gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <label className="btn" style={{ cursor: 'pointer' }}>
                  아바타 이미지 변경
                  <input type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
                </label>
                {form.avatar && <button type="button" className="btn-text danger" onClick={() => set('avatar', undefined)}>이미지 삭제</button>}
              </div>
              <span className="meta">이미지가 없으면 이름의 첫 글자를 표시합니다.</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            <label className="label"><span>이름</span>
              <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 서윤" required />
            </label>
            <label className="label"><span>직책</span>
              <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 기획 리드" required />
            </label>
            <label className="label"><span>모델</span>
              <select className="field" value={form.provider} onChange={(e) => {
                const p = e.target.value as Provider;
                setForm((f) => ({ ...f, provider: p, model: MODELS[p][0]?.id ?? '' }));
              }}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? '' : ' (준비 중)'}</option>
                ))}
              </select>
            </label>
            <label className="label"><span>성능</span>
              <select className="field" value={form.model} onChange={(e) => set('model', e.target.value)}>
                {MODELS[form.provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <span className="meta">선택한 모델에 따라 목록이 달라집니다.</span>
            </label>
          </div>

          <label className="label"><span>페르소나 및 역할</span>
            <textarea className="field" rows={6} value={form.persona} onChange={(e) => set('persona', e.target.value)}
              placeholder="예: 당신은 이 회사의 기획 리드입니다. 요청을 작업 단위로 나누고, 각 작업에 적합한 담당자를 지정합니다." />
            <span className="meta">이 내용은 모든 채팅에서 이 에이전트에게 프롬프트로 전달됩니다.</span>
          </label>

          <fieldset className="col" style={{ margin: 0, padding: 0, border: 0, gap: 8 }}>
            <legend style={{ padding: '0 0 4px', fontWeight: 600 }}>승인 모드</legend>
            {APPROVAL_OPTIONS.map((o) => (
              <label key={o.id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input type="radio" name="approval" checked={form.approvalMode === o.id} onChange={() => set('approvalMode', o.id)} style={{ margin: '2px 0 0' }} />
                <span className="col" style={{ gap: 2 }}><span>{o.label}</span><span className="meta">{o.help}</span></span>
              </label>
            ))}
          </fieldset>

          <section className="col" style={{ gap: 8 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 className="title grow">이력</h2>
              <button type="button" className="btn" onClick={() => setEditing({ id: crypto.randomUUID(), time: localInput(new Date().toISOString()), content: '' })}>
                <Icon.plus size={12} /><span>이력 추가</span>
              </button>
            </div>
            <p className="muted">에이전트의 활동이 자동으로 기록됩니다. 각 항목은 직접 수정하거나 삭제할 수 있고, 새 항목을 추가할 수도 있습니다.</p>
            {(form.history.length > 0 || editing) && (
              <div className="list-card">
                {editing && !form.history.some((h) => h.id === editing.id) && (
                  <HistoryEditor editing={editing} setEditing={setEditing} commit={commitHistory} />
                )}
                {form.history.map((h) =>
                  editing?.id === h.id ? (
                    <HistoryEditor key={h.id} editing={editing} setEditing={setEditing} commit={commitHistory} />
                  ) : (
                    <div key={h.id} className="row" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 16px' }}>
                      <span className="meta" style={{ width: 108, flexShrink: 0 }}>{new Date(h.time).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      <span style={{ flex: '1 1 240px', minWidth: 0, lineHeight: '17px' }}>{h.content}</span>
                      <span className="chip">{SOURCE_LABEL[h.source]}</span>
                      <button type="button" className="btn-text" onClick={() => setEditing({ id: h.id, time: localInput(h.time), content: h.content })}>수정</button>
                      <button type="button" className="btn-text danger" onClick={() => set('history', form.history.filter((x) => x.id !== h.id))}>삭제</button>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>

          <p className="note">저장하면 변경한 내용이 모든 채팅에 적용됩니다. 이력 변경도 저장해야 반영됩니다.</p>
        </form>
      </div>
    </main>
  );
}

function HistoryEditor({ editing, setEditing, commit }: {
  editing: { id: string; time: string; content: string };
  setEditing: (e: { id: string; time: string; content: string } | null) => void;
  commit: () => void;
}) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 16px', background: 'var(--surface-glass-tinted)' }}>
      <label className="col" style={{ width: 180, flexShrink: 0, gap: 4 }}>
        <span className="meta-strong">시각</span>
        <input type="datetime-local" className="field" style={{ height: 32, padding: '0 8px', fontSize: 12 }} value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} />
      </label>
      <label className="col" style={{ flex: '1 1 240px', minWidth: 0, gap: 4 }}>
        <span className="meta-strong">내용</span>
        <input className="field" style={{ height: 32, padding: '0 8px' }} value={editing.content} autoFocus
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(null); }} />
      </label>
      <button type="button" className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setEditing(null)}>취소</button>
      <button type="button" className="btn-primary" style={{ alignSelf: 'flex-end' }} onClick={commit}>완료</button>
    </div>
  );
}

// ISO -> value for <input type="datetime-local"> in local time.
function localInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

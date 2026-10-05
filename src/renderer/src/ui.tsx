import { useEffect, useState, type CSSProperties } from 'react';
import { splitMentions } from '../../shared/mentions';
import type { Agent, Api, AppState } from '../../shared/types';

declare global {
  interface Window {
    ensemble: Api;
  }
}
export const api = () => window.ensemble;

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    api().getState().then(setState);
    return api().onState(setState);
  }, []);
  return state;
}

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (hash: string) => (location.hash = hash);

export function Avatar({ agent, size }: { agent?: Agent; size: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size >= 80 ? 28 : size >= 56 ? 20 : size >= 40 ? 15 : 11,
    background: agent?.avatar ? `center / cover url(${agent.avatar})` : agent?.tint ?? '#e3e3ea',
  };
  return (
    <span className="avatar" aria-hidden="true" style={style}>
      {!agent?.avatar && (agent?.name.slice(0, 1) ?? '?')}
    </span>
  );
}

export function MentionText({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      {splitMentions(text, names).map((s, i) =>
        s.mention ? (
          <span key={i} className="mention">
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return '오늘';
  if (d.toDateString() === yesterday.toDateString()) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}

export function shortWhen(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return timeLabel(iso);
  if (days === 1) return '어제';
  if (days < 7) return d.toLocaleDateString('ko-KR', { weekday: 'long' });
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

const icon = (paths: React.ReactNode, size = 16, extra: React.SVGProps<SVGSVGElement> = {}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...extra}>
    {paths}
  </svg>
);

export const Icon = {
  compose: () => icon(<><path d="M13 8.5V13H3V3h4.5" /><path d="M11.5 2.5l2 2L8 10H6V8z" /></>),
  search: () => icon(<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>, 14),
  plus: ({ size = 16 }: { size?: number }) => icon(<path d="M8 3v10M3 8h10" />, size),
  folder: ({ size = 16 }: { size?: number }) => icon(<path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />, size),
  sliders: () => icon(<><path d="M2 4.5h7M12.5 4.5H14M2 11.5h1.5M7 11.5h7" /><circle cx="10.75" cy="4.5" r="1.75" /><circle cx="5.25" cy="11.5" r="1.75" /></>),
  gear: () => icon(<><path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z" /><circle cx="8" cy="8" r="2" /></>),
  invite: () => icon(<><circle cx="6.5" cy="5.5" r="2.5" /><path d="M2 13c.5-2.5 2.2-3.8 4.5-3.8S10.5 10.5 11 13M12.5 4.5v4M10.5 6.5h4" /></>, 15),
  chevronRight: () => icon(<path d="M6 4l4 4-4 4" />, 12),
  chevronDown: () => icon(<path d="M4 6l4 4 4-4" />, 12),
  file: () => icon(<><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3M6 8.5h4M6 11h4" /></>),
  pencil: () => icon(<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />, 12),
  close: () => icon(<path d="M4 4l8 8M12 4l-8 8" />, 14),
  send: () => icon(<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />, 16, { strokeWidth: 1.8 }),
  stop: () => <svg width="14" height="14" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" /></svg>,
  check: () => icon(<path d="M3.5 8.5l3 3 6-7" />, 12, { strokeWidth: 2 }),
  alert: () => icon(<><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11h.01" /></>, 14),
};

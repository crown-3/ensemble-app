// In browser mode there is no Electron preload, so window.ensemble talks to web.ts over HTTP.
import type { Api, AppState } from '../../shared/types';

export function installWebApi() {
  if (window.ensemble) return; // running inside Electron

  const call = (method: string) => async (...args: unknown[]) => {
    const res = await fetch(`/api/${method}`, { method: 'POST', body: JSON.stringify(args) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };
  const listeners = new Set<(s: AppState) => void>();
  new EventSource('/events').onmessage = (e) => {
    const state = JSON.parse(e.data);
    for (const cb of listeners) cb(state);
  };

  window.ensemble = new Proxy({} as Api, {
    get: (_t, method: string) => {
      if (method === 'onState') {
        return (cb: (s: AppState) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        };
      }
      // No native folder dialog in a browser: ask for a path on the server machine.
      if (method === 'pickFolder') return async () => prompt('작업 폴더 경로 (Codespace 안의 절대 경로)')?.trim() || null;
      if (method === 'pickFile') return async () => prompt('파일 경로 (Codespace 안의 절대 경로)')?.trim() || null;
      if (method === 'openPath') return async (p: string) => void open(`/file?path=${encodeURIComponent(p)}`, '_blank');
      return call(method);
    },
  });
}

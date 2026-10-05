import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppState } from '../shared/types';

// contextBridge copies plain objects only, so every method is listed explicitly.
const methods: Exclude<keyof Api, 'onState'>[] = [
  'getState', 'saveAgent', 'duplicateAgent', 'deleteAgent', 'saveSettings', 'pickFolder', 'pickFile', 'defaultFolder', 'openPath',
  'createProject', 'updateProject', 'deleteProject', 'saveMemory', 'deleteMemory',
  'createChat', 'sendMessage', 'stopChat', 'inviteAgent', 'removeAgent', 'setLeader', 'setChatApproval', 'answerApproval',
  'markRead', 'authStatus',
];

const api = Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke('api', m, ...args)]));

contextBridge.exposeInMainWorld('ensemble', {
  ...api,
  onState: (cb: (s: AppState) => void) => {
    const listener = (_e: unknown, s: AppState) => cb(s);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});

import { contextBridge, ipcRenderer } from 'electron';
import type { KeeperApi, UpdateApi, UpdateState } from '../shared';

// A sandboxed preload cannot call app.getVersion(); main passes it as an argument.
const PREFIX = '--app-version=';
const arg = process.argv.find((a) => a.startsWith(PREFIX));

// Named functions only: the screen can never name a keeper route.
const keeper: KeeperApi = {
  health: () => ipcRenderer.invoke('keeper:health'),
  onStatus: (callback) => {
    // Wrapped so the screen never sees the IPC event object.
    const listener = (_e: unknown, push: Parameters<typeof callback>[0]) => callback(push);
    ipcRenderer.on('keeper:status', listener);
    return () => {
      ipcRenderer.removeListener('keeper:status', listener);
    };
  },
  backups: {
    list: () => ipcRenderer.invoke('keeper:backups-list'),
    exportTo: () => ipcRenderer.invoke('keeper:backups-export'),
  },
  restore: {
    preview: (file) => ipcRenderer.invoke('keeper:restore-preview', file),
    apply: (file, token) => ipcRenderer.invoke('keeper:restore-apply', file, token),
  },
  pins: {
    setup: (admin, system) => ipcRenderer.invoke('keeper:pins-setup', admin, system),
    verify: (kind, pin) => ipcRenderer.invoke('keeper:pins-verify', kind, pin),
    changeSystem: (admin, pin) => ipcRenderer.invoke('keeper:pins-change-system', admin, pin),
    changeAdmin: (admin, pin) => ipcRenderer.invoke('keeper:pins-change-admin', admin, pin),
    recover: (code, admin, system) => ipcRenderer.invoke('keeper:pins-recover', code, admin, system),
  },
  masters: {
    all: () => ipcRenderer.invoke('keeper:masters-all'),
    create: (kind, fields, confirmSimilar) => ipcRenderer.invoke('keeper:masters-create', kind, fields, confirmSimilar),
    update: (kind, id, version, fields, pin, confirmSimilar) => ipcRenderer.invoke('keeper:masters-update', kind, id, version, fields, pin, confirmSimilar),
    setActive: (kind, id, version, active, pin) => ipcRenderer.invoke('keeper:masters-set-active', kind, id, version, active, pin),
  },
};

const update: UpdateApi = {
  state: () => ipcRenderer.invoke('update:state'),
  onState: (callback) => {
    const listener = (_e: unknown, state: UpdateState) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => {
      ipcRenderer.removeListener('update:state', listener);
    };
  },
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: (adminPin) => ipcRenderer.invoke('update:install', adminPin),
};

contextBridge.exposeInMainWorld('bm', { version: arg ? arg.slice(PREFIX.length) : 'unknown', keeper, update });

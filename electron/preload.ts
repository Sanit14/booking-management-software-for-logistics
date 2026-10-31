import { contextBridge, ipcRenderer } from 'electron';
import type { KeeperApi, KeysApi, UpdateApi, UpdateState } from '../shared';

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
  onChanged: (callback) => {
    const listener = (_e: unknown, change: Parameters<typeof callback>[0]) => callback(change);
    ipcRenderer.on('keeper:changed', listener);
    return () => {
      ipcRenderer.removeListener('keeper:changed', listener);
    };
  },
  lrs: {
    defaults: (date) => ipcRenderer.invoke('keeper:lrs-defaults', date),
    preview: (input) => ipcRenderer.invoke('keeper:lrs-preview', input),
    create: (input) => ipcRenderer.invoke('keeper:lrs-create', input),
    byDate: (date) => ipcRenderer.invoke('keeper:lrs-by-date', date),
    get: (id) => ipcRenderer.invoke('keeper:lrs-get', id),
    find: (no) => ipcRenderer.invoke('keeper:lrs-find', no),
    update: (id, version, input, systemPin) => ipcRenderer.invoke('keeper:lrs-update', id, version, input, systemPin),
    cancel: (id, version, reason, systemPin) => ipcRenderer.invoke('keeper:lrs-cancel', id, version, reason, systemPin),
    restore: (id, version, systemPin) => ipcRenderer.invoke('keeper:lrs-restore', id, version, systemPin),
    history: (id) => ipcRenderer.invoke('keeper:lrs-history', id),
  },
  settings: {
    setLrDefaults: (input, adminPin) => ipcRenderer.invoke('keeper:settings-set-lr-defaults', input, adminPin),
  },
  dashboard: {
    summary: (date) => ipcRenderer.invoke('keeper:dashboard-summary', date),
    pendingByStation: () => ipcRenderer.invoke('keeper:dashboard-pending'),
    recentLrs: () => ipcRenderer.invoke('keeper:dashboard-recent'),
  },
  memos: {
    defaults: (date) => ipcRenderer.invoke('keeper:memos-defaults', date),
    pending: (filters, cursor) => ipcRenderer.invoke('keeper:memos-pending', filters, cursor),
    totals: (ids) => ipcRenderer.invoke('keeper:memos-totals', ids),
    create: (input) => ipcRenderer.invoke('keeper:memos-create', input),
    get: (id) => ipcRenderer.invoke('keeper:memos-get', id),
    byDate: (date) => ipcRenderer.invoke('keeper:memos-by-date', date),
    list: (filters, cursor) => ipcRenderer.invoke('keeper:memos-list', filters, cursor),
    editHeader: (id, version, input, pin) => ipcRenderer.invoke('keeper:memos-edit', id, version, input, pin),
    removeLrs: (id, lrIds, pin) => ipcRenderer.invoke('keeper:memos-remove-lrs', id, lrIds, pin),
    moveLrs: (id, lrIds, targetId, pin) => ipcRenderer.invoke('keeper:memos-move-lrs', id, lrIds, targetId, pin),
    addLrs: (id, lrIds, pin) => ipcRenderer.invoke('keeper:memos-add-lrs', id, lrIds, pin),
    recalculate: (id, version, pin) => ipcRenderer.invoke('keeper:memos-recalculate', id, version, pin),
    cancel: (id, version, reason, pin) => ipcRenderer.invoke('keeper:memos-cancel', id, version, reason, pin),
    history: (id) => ipcRenderer.invoke('keeper:memos-history', id),
  },
  search: (text) => ipcRenderer.invoke('keeper:search', text),
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

const keys: KeysApi = {
  get: () => ipcRenderer.invoke('seat:keys-get'),
  set: (map) => ipcRenderer.invoke('seat:keys-set', map),
};

contextBridge.exposeInMainWorld('bm', { version: arg ? arg.slice(PREFIX.length) : 'unknown', keeper, update, keys });

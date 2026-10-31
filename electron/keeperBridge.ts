// Main-process side of the keeper chain: find the keeper (or start it), check it is ours and current, answer
// the screen's keeper.health(). There is no fallback database: if the keeper cannot be reached the screen
// gets an error code and nothing else happens.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  KEEPER_PORT,
  KEEPER_VERSION,
  type BackupInfo,
  type DashboardSummary,
  type KeeperErrorCode,
  type KeeperPush,
  type KeeperResult,
  type KeeperStatus,
  type LrDay,
  type LrDefaults,
  type LrDetail,
  type LrHistoryEntry,
  type LrPreview,
  type LrSaved,
  type LrUpdated,
  type MasterRow,
  type MastersAll,
  type MemoChanged,
  type MemoDefaults,
  type MemoDetail,
  type MemoHistoryEntry,
  type MemoListRow,
  type MemoSaved,
  type SavedMemoPage,
  type PendingPage,
  type PendingStation,
  type PendingTotals,
  type RecentLr,
  type RestorePreview,
  type RootRefusal,
  type SearchAnswer,
} from '../shared';
import { strings } from '../src/strings';
import { callJson, probe, shutdown, subscribeEvents } from '../keeper/client';
import { checkDataRoot, resolveDataRoot } from '../keeper/dataRoot';
import { makeLog } from '../keeper/log';
import { logPath, pointerPath, programDir } from '../keeper/paths';
import { KEEPER_PING_MS, keeperAction } from './watchdog';

// A big database is checked (and backed up) before the keeper says ready; the loop still gives up at once if the keeper it started dies.
const START_WAIT_MS = 60000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The Windows user name by default (each NComputing seat is its own Windows user); kept in this user's
// userData so a later rename UI has somewhere to write.
export function loadSeat(userDataDir: string): string {
  const file = path.join(userDataDir, 'seat.json');
  try {
    const name = (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') return name;
  } catch {
    /* no seat file yet */
  }
  let name = 'seat';
  try {
    name = os.userInfo().username || name;
  } catch {
    /* no user name available */
  }
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name }));
  } catch {
    /* the default still works without the file */
  }
  return name;
}

class LauncherError extends Error {
  constructor(readonly code: KeeperErrorCode, readonly detail = '', readonly refusal?: RootRefusal) {
    super(code);
  }
}

async function resolveStatus(seat: string): Promise<KeeperStatus> {
  const pd = programDir();
  let dataRoot: string;
  try {
    dataRoot = resolveDataRoot(process.env, pointerPath(pd));
  } catch {
    throw new LauncherError('root-pointer-unreadable', pointerPath(pd));
  }
  const check = checkDataRoot(dataRoot);
  if (!check.ok) throw new LauncherError('root-refused', dataRoot, check.reason);

  const opts = { seat };
  let p = await probe(KEEPER_PORT, opts);
  if (keeperAction(p, KEEPER_VERSION) === 'replace') {
    // Left over from an older build: replace it (it checkpoints and closes the database first). Look again
    // first: another seat may just have replaced it, and its new keeper must not be shut down.
    const again = await probe(KEEPER_PORT, opts);
    if (keeperAction(again, KEEPER_VERSION) === 'replace') {
      await shutdown(KEEPER_PORT, opts);
      for (let i = 0; i < 40 && (await probe(KEEPER_PORT, opts)).kind === 'up'; i++) await sleep(150);
    }
    p = await probe(KEEPER_PORT, opts);
    if (keeperAction(p, KEEPER_VERSION) === 'replace') {
      throw new LauncherError('keeper-unreachable', 'the old keeper did not stop');
    }
  }

  const spawned: { exitCode?: number } = {};
  if (keeperAction(p, KEEPER_VERSION) === 'start') {
    // Several seats may get here at once; the keeper takes the port before the database, so only one survives.
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'keeper', 'server.js'), dataRoot, String(KEEPER_PORT)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.unref(); // the keeper outlives this seat and serves the others
    child.on('exit', (code) => (spawned.exitCode = code ?? -1));
    child.on('error', () => (spawned.exitCode = -1)); // ENOENT/EACCES: without a listener this would crash main
  }

  const deadline = Date.now() + START_WAIT_MS;
  // 'starting' = the keeper has the port but is still checking, backing up and migrating the database.
  while (p.kind !== 'up' || p.health.state === 'starting') {
    if (p.kind === 'foreign') throw new LauncherError('keeper-wrong-app', String(KEEPER_PORT));
    // Exit code 0 = another keeper took the port first; keep waiting for that one.
    if (spawned.exitCode !== undefined && spawned.exitCode !== 0) throw new LauncherError('keeper-unreachable', `exit ${spawned.exitCode}; see keeper.log`);
    if (Date.now() > deadline) throw new LauncherError('keeper-unreachable', 'timeout');
    await sleep(200);
    p = await probe(KEEPER_PORT, opts);
  }

  const { health } = p;
  if (health.dataRoot.toLowerCase() !== dataRoot.toLowerCase()) {
    throw new LauncherError('keeper-other-root', health.dataRoot);
  }
  return health.state === 'safe-mode' ? { kind: 'safe-mode', health, seat } : { kind: 'connected', health, seat };
}

export function initKeeperBridge(userDataDir: string) {
  const seat = loadSeat(userDataDir);
  const log = makeLog(logPath(programDir()));
  let inflight: Promise<KeeperStatus> | null = null;
  let unreachable = false; // the last answer given to the screen was "keeper-unreachable"
  let paused = false; // the updater stopped the keeper on purpose: do not start it again

  // Concurrent callers share one attempt. Each call re-probes, so a keeper that died is started again.
  const status = (): Promise<KeeperStatus> => {
    inflight ??= resolveStatus(seat)
      .catch((e): KeeperStatus => {
        const err = e instanceof LauncherError ? e : new LauncherError('keeper-unreachable', String((e as Error)?.message ?? e));
        log('launcher-error', { seat, code: err.code, detail: err.detail });
        return { kind: 'error', code: err.code, detail: err.detail, ...(err.refusal ? { refusal: err.refusal } : {}) };
      })
      .then((s) => {
        unreachable = s.kind === 'error' && s.code === 'keeper-unreachable';
        return s;
      })
      .finally(() => (inflight = null));
    return inflight;
  };

  const push = (p: KeeperPush) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('keeper:status', p);
  };

  // The keeper is gone (or a request to it failed): tell the screen, start it again, tell the screen the result.
  // status() is the same single-instance start as at launch; every save is already committed, so nothing is lost.
  const recover = async (why: string) => {
    if (inflight || paused) return; // an attempt is already running (its caller reports the result), or the keeper is stopped on purpose
    log('watchdog-restart', { seat, why });
    push({ kind: 'reconnecting' });
    push(await status());
  };

  // A named keeper route, answered with the keeper's own KeeperResult. Only the handlers below call it.
  const call = async <T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<KeeperResult<T>> => {
    try {
      const r = await callJson(KEEPER_PORT, method, url, body, { seat, timeoutMs: 60000 }); // a backup of a big file takes a while
      const j = r.json as { ok?: unknown } | null;
      if (j && typeof j.ok === 'boolean') return j as KeeperResult<T>;
      return { ok: false, code: 'failed', detail: `the keeper answered ${r.status}` };
    } catch (e) {
      void recover('request-failed');
      return { ok: false, code: 'keeper-unreachable', detail: String((e as Error)?.message ?? e) };
    }
  };
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');

  // The routes the screen can reach. Add routes here by name; there is no generic forwarder.
  ipcMain.handle('keeper:health', status);
  ipcMain.handle('keeper:backups-list', () => call<BackupInfo[]>('POST', '/backups/list'));
  ipcMain.handle('keeper:backups-export', async (): Promise<KeeperResult<{ file: string }>> => {
    const options = { title: strings.exportBackup, properties: ['openDirectory' as const, 'createDirectory' as const] };
    const win = BrowserWindow.getFocusedWindow();
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (chosen.canceled || chosen.filePaths.length === 0) return { ok: false, code: 'cancelled' };
    return call('POST', '/backups/export', { dir: chosen.filePaths[0] });
  });
  ipcMain.handle('keeper:restore-preview', (_e, file: unknown) => call<RestorePreview>('POST', '/restore/preview', { file: text(file) }));
  ipcMain.handle('keeper:restore-apply', (_e, file: unknown, token: unknown) =>
    call<{ schemaVersion: number }>('POST', '/restore/apply', { file: text(file), confirmToken: text(token) }),
  );
  ipcMain.handle('keeper:pins-setup', (_e, admin: unknown, system: unknown) =>
    call<{ recoveryCode: string }>('POST', '/pins/setup', { adminPin: text(admin), systemPin: text(system) }),
  );
  ipcMain.handle('keeper:pins-verify', (_e, kind: unknown, pin: unknown) => call<true>('POST', '/pins/verify', { kind: text(kind), pin: text(pin) }));
  ipcMain.handle('keeper:pins-change-system', (_e, admin: unknown, pin: unknown) =>
    call<true>('POST', '/pins/change-system', { adminPin: text(admin), newPin: text(pin) }),
  );
  ipcMain.handle('keeper:pins-change-admin', (_e, admin: unknown, pin: unknown) =>
    call<true>('POST', '/pins/change-admin', { adminPin: text(admin), newPin: text(pin) }),
  );
  ipcMain.handle('keeper:pins-recover', (_e, code: unknown, admin: unknown, system: unknown) =>
    call<{ recoveryCode: string }>('POST', '/pins/recover', { recoveryCode: text(code), newAdminPin: text(admin), newSystemPin: text(system) }),
  );
  // Master data: the keeper checks every value (kind, fields, version, PIN); main only forwards named arguments.
  ipcMain.handle('keeper:masters-all', () => call<MastersAll>('POST', '/masters/all'));
  ipcMain.handle('keeper:masters-create', (_e, kind: unknown, fields: unknown, confirmSimilar: unknown) =>
    call<MasterRow>('POST', '/masters/create', { kind, fields, confirmSimilar }),
  );
  ipcMain.handle('keeper:masters-update', (_e, kind: unknown, id: unknown, version: unknown, fields: unknown, pin: unknown, confirmSimilar: unknown) =>
    call<MasterRow>('POST', '/masters/update', { kind, id, version, fields, systemPin: text(pin), confirmSimilar }),
  );
  ipcMain.handle('keeper:masters-set-active', (_e, kind: unknown, id: unknown, version: unknown, active: unknown, pin: unknown) =>
    call<MasterRow>('POST', '/masters/set-active', { kind, id, version, active, systemPin: text(pin) }),
  );
  // LRs: the keeper parses and checks every value (money is sent as typed text); main forwards named arguments.
  const dateOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  ipcMain.handle('keeper:lrs-defaults', (_e, date: unknown) => call<LrDefaults>('POST', '/lrs/defaults', { date: dateOrNull(date) }));
  ipcMain.handle('keeper:lrs-preview', (_e, input: unknown) => call<LrPreview>('POST', '/lrs/preview', { input }));
  ipcMain.handle('keeper:lrs-create', (_e, input: unknown) => call<LrSaved>('POST', '/lrs/create', { input }));
  ipcMain.handle('keeper:lrs-by-date', (_e, date: unknown) => call<LrDay>('POST', '/lrs/by-date', { date: dateOrNull(date) }));
  // Open, edit, cancel, restore: ids and versions are checked as integers by the keeper (a bad one answers 400).
  ipcMain.handle('keeper:lrs-get', (_e, id: unknown) => call<LrDetail>('POST', '/lrs/get', { id }));
  ipcMain.handle('keeper:lrs-find', (_e, no: unknown) => call<LrDetail>('POST', '/lrs/find', { no }));
  ipcMain.handle('keeper:lrs-update', (_e, id: unknown, version: unknown, input: unknown, pin: unknown) =>
    call<LrUpdated>('POST', '/lrs/update', { id, version, input, systemPin: text(pin) }),
  );
  ipcMain.handle('keeper:lrs-cancel', (_e, id: unknown, version: unknown, reason: unknown, pin: unknown) =>
    call<LrDetail>('POST', '/lrs/cancel', { id, version, reason: text(reason), systemPin: text(pin) }),
  );
  ipcMain.handle('keeper:lrs-restore', (_e, id: unknown, version: unknown, pin: unknown) =>
    call<LrDetail>('POST', '/lrs/restore', { id, version, systemPin: text(pin) }),
  );
  ipcMain.handle('keeper:lrs-history', (_e, id: unknown) => call<LrHistoryEntry[]>('POST', '/lrs/history', { id }));
  ipcMain.handle('keeper:settings-set-lr-defaults', (_e, input: unknown, pin: unknown) =>
    call<LrDefaults>('POST', '/settings/set-lr-defaults', { input, adminPin: text(pin) }),
  );
  // Dashboard counts and the search box: reads only; the keeper checks the date and cleans the text.
  ipcMain.handle('keeper:dashboard-summary', (_e, date: unknown) => call<DashboardSummary>('POST', '/dashboard/summary', { date: dateOrNull(date) }));
  ipcMain.handle('keeper:dashboard-pending', () => call<PendingStation[]>('POST', '/dashboard/pending-by-station'));
  ipcMain.handle('keeper:dashboard-recent', () => call<RecentLr[]>('POST', '/dashboard/recent'));
  ipcMain.handle('keeper:search', (_e, typed: unknown) => call<SearchAnswer>('POST', '/search', { text: text(typed) }));
  // Loading memos: the keeper cleans the filters and parses the typed money; main forwards named arguments.
  ipcMain.handle('keeper:memos-defaults', (_e, date: unknown) => call<MemoDefaults>('POST', '/memos/defaults', { date: dateOrNull(date) }));
  ipcMain.handle('keeper:memos-pending', (_e, filters: unknown, cursor: unknown) => call<PendingPage>('POST', '/memos/pending', { filters, cursor }));
  ipcMain.handle('keeper:memos-totals', (_e, ids: unknown) => call<PendingTotals>('POST', '/memos/totals', { ids }));
  ipcMain.handle('keeper:memos-create', (_e, input: unknown) => call<MemoSaved>('POST', '/memos/create', { input }));
  ipcMain.handle('keeper:memos-get', (_e, id: unknown) => call<MemoDetail>('POST', '/memos/get', { id }));
  ipcMain.handle('keeper:memos-by-date', (_e, date: unknown) => call<MemoListRow[]>('POST', '/memos/by-date', { date: dateOrNull(date) }));
  // Saved memos (3.2): the keeper checks the PIN with each change; main only passes the typed values on.
  ipcMain.handle('keeper:memos-list', (_e, filters: unknown, cursor: unknown) => call<SavedMemoPage>('POST', '/memos/list', { filters, cursor }));
  ipcMain.handle('keeper:memos-edit', (_e, id: unknown, version: unknown, input: unknown, pin: unknown) =>
    call<MemoChanged>('POST', '/memos/edit', { id, version, input, systemPin: text(pin) }),
  );
  ipcMain.handle('keeper:memos-remove-lrs', (_e, id: unknown, lrIds: unknown, pin: unknown) => call<MemoDetail>('POST', '/memos/remove-lrs', { id, lrIds, systemPin: text(pin) }));
  ipcMain.handle('keeper:memos-move-lrs', (_e, id: unknown, lrIds: unknown, targetId: unknown, pin: unknown) =>
    call<MemoDetail>('POST', '/memos/move-lrs', { id, lrIds, targetId, systemPin: text(pin) }),
  );
  ipcMain.handle('keeper:memos-add-lrs', (_e, id: unknown, lrIds: unknown, pin: unknown) => call<MemoDetail>('POST', '/memos/add-lrs', { id, lrIds, systemPin: text(pin) }));
  ipcMain.handle('keeper:memos-recalculate', (_e, id: unknown, version: unknown, pin: unknown) => call<MemoChanged>('POST', '/memos/recalculate', { id, version, adminPin: text(pin) }));
  ipcMain.handle('keeper:memos-cancel', (_e, id: unknown, version: unknown, reason: unknown, pin: unknown) =>
    call<MemoDetail>('POST', '/memos/cancel', { id, version, reason: text(reason), adminPin: text(pin) }),
  );
  ipcMain.handle('keeper:memos-history', (_e, id: unknown) => call<MemoHistoryEntry[]>('POST', '/memos/history', { id }));
  void status(); // warm up before the screen asks

  // One event stream per seat, handed on to every window of this seat. It reconnects by itself (after a keeper
  // restart too) and then says "everything changed", so a view that missed events refetches.
  subscribeEvents(KEEPER_PORT, { seat }, (change) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('keeper:changed', change);
  });

  // The one liveness ping (not a data poll). Only a missing or outdated keeper is acted on; "wrong app" and
  // the like are reported by the launch path, and a busy keeper that is slow to answer is left alone.
  setInterval(() => {
    if (paused) return;
    void probe(KEEPER_PORT, { seat }).then((p) => {
      const action = keeperAction(p, KEEPER_VERSION);
      if (action === 'start' || action === 'replace') void recover(action);
      else if (action === 'ok' && unreachable) void recover('screen-showed-unreachable');
    });
  }, KEEPER_PING_MS);

  return {
    seat,
    status,
    call,
    /** The updater is about to stop the keeper and replace the program. */
    pauseWatchdog: () => {
      paused = true;
    },
    /** The update stopped before the installer ran: bring the keeper back now. */
    resumeWatchdog: () => {
      paused = false;
      void recover('update-stopped');
    },
  };
}

export type KeeperBridge = ReturnType<typeof initKeeperBridge>;

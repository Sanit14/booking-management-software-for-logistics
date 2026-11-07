// The keeper: the one process per Windows host that owns booking.db. Started detached by the first seat
// (electron/keeperBridge.ts) as `electron.exe server.js <dataRoot> <port>` with ELECTRON_RUN_AS_NODE=1.
// Listens on 127.0.0.1 only. Taking the port is the single-instance rule: it happens BEFORE the database is
// touched, so a second keeper started at the same moment exits without doing anything.
// The data root is checked by main before it spawns this (keeper/dataRoot.ts); the keeper trusts its argument.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  APP_ID,
  CHANGE_TABLES,
  KEEPER_VERSION,
  type BackupStatus,
  type ChangeTable,
  type GuardReason,
  type KeeperHealth,
  type KeeperResult,
  type LrDetail,
  type LrSaved,
  type LrUpdated,
  type MasterFields,
  type MasterKind,
  type MemoChanged,
  type MemoDetail,
  type MemoSaved,
  type PrintCompany,
  type ResultCode,
  type WasuliChanged,
} from '../shared';
import { makeAdmin } from './admin';
import { writeAudit } from './audit';
import { backupName } from './backupNames';
import { isAbsoluteWindows, sameDrive, sameFolder } from './backupRules';
import { backupFiles, listBackups, makeBackup, migrateSafely, pruneBackups } from './backup';
import { makeDashboard } from './dashboard';
import { businessRows, closeDatabase, hasTable, openChecked, raiseMarker, type Db } from './db';
import { makeEvents } from './events';
import { makeFirmAccounts } from './firmAccounts';
import { asAccountCursor, asAccountFilters, asRole, asStatementCursor, asStatementQuery, asYear } from './firmRules';
import { blankReason, inspectBeforeOpen, markRunning, readMarkerClean, readMarkerRows, writeMarker } from './guard';
import { makeHistory } from './history';
import { asHistoryCursor, asHistoryFilters } from './historyRules';
import { asDefaultsInput, asLrInput } from './lrRules';
import { makeLog } from './log';
import { makeLrs } from './lrs';
import { asCursor, asHeaderInput, asIds, asLrIds, asMemoInput, asPendingFilters, asSavedFilters } from './memoRules';
import { makeMasters } from './masters';
import { makeMemos } from './memos';
import { MIGRATIONS, migrate } from './migrations';
import { DEFAULT_BACKUP_DIR, logPath, programDir } from './paths';
import { ROUTES } from './routes';
import type { LockKind } from './lockout';
import { makePins } from './pins';
import { asPrintDone, makePrint } from './print';
import { makeReports } from './reports';
import { asLrsRequest, asPartySide, asReportCursor, asReportKind, asReportLrCursor, asReportQuery } from './reportRules';
import { makeTokens, previewRestore, restoreFiles, verifyApply } from './restore';
import { search } from './search';
import { makeSeats } from './seats';
import { makeWasuli } from './wasuli';
import { asCollectInput, asPeriod, asSeen, asSeenList, asWasuliCursor, asWasuliFilters } from './wasuliRules';

const HOST = '127.0.0.1';
// BM_MARKER_REFRESH_MS: tests only, so the marker's rise can be seen without waiting five minutes.
const MARKER_REFRESH_MS = Math.max(100, Number(process.env.BM_MARKER_REFRESH_MS) || 5 * 60 * 1000);
const MASTER_KINDS: MasterKind[] = ['stations', 'firms', 'trucks', 'drivers', 'agents'];
const BACKUP_EVERY_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENT_STREAMS = 32;
const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version;

const msg = (e: unknown): string => String((e as Error)?.message ?? e);

/** settings.backupDir, when the database has that table and key (plain text, not JSON). */
function configuredBackupDir(db: Db): string | undefined {
  if (!hasTable(db, 'settings')) return undefined;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'backupDir'").get() as { value: string } | undefined;
  return row?.value || undefined;
}

function main(): void {
  const [dataRoot, portArg] = process.argv.slice(2);
  const port = Number(portArg);
  const programDirPath = programDir();
  const log = makeLog(logPath(programDirPath));
  if (!dataRoot || !Number.isInteger(port) || port < 1) {
    log('keeper-usage', 'expected: server.js <dataRoot> <port>');
    process.exit(1);
  }

  const dbPath = path.join(dataRoot, 'booking.db');
  const startedAt = new Date().toISOString();
  // 'starting' until the database has been checked, backed up and migrated (or safe mode decided): the port is
  // taken first, so a request can arrive while start() is still awaiting a backup.
  let state: 'starting' | 'ready' | 'safe-mode' = 'starting';
  let reason: GuardReason | undefined;
  let schemaVersion: number | undefined;
  let db: Db | null = null;
  let markedRows = 0;
  // BM_BACKUP_DIR: dev and tests. Otherwise settings.backupDir once the database is open, else the default.
  const backupDirFromEnv = process.env.BM_BACKUP_DIR;
  let backupDir = backupDirFromEnv || DEFAULT_BACKUP_DIR;
  const backup: BackupStatus = {};
  let backingUp: Promise<void> | null = null;
  const tokens = makeTokens();
  // BM_PIN_LOCK_MS: tests only (how long a locked PIN stays locked), like BM_MARKER_REFRESH_MS.
  const lockouts: LockKind[] = [];
  const pins = makePins(Date.now, (kind) => lockouts.push(kind), Math.max(100, Number(process.env.BM_PIN_LOCK_MS)) || undefined);
  const masters = makeMasters(pins);
  const lrs = makeLrs(pins, masters);
  const memos = makeMemos(pins);
  const firmAccounts = makeFirmAccounts();
  const reports = makeReports();
  const history = makeHistory();
  const admin = makeAdmin(pins);
  const printing = makePrint(pins, memos, firmAccounts, reports);
  const wasuli = makeWasuli(pins);
  const dashboard = makeDashboard();
  const events = makeEvents();
  const seats = makeSeats();
  let stopping: Promise<number> | null = null;
  let timersStarted = false;

  // One backup at a time (two would write the same file name). Never throws: a failure is logged and shown in
  // the status line, and the keeper carries on.
  function runBackup(why: string): Promise<void> {
    if (backingUp) return backingUp;
    const open = db;
    if (!open) return Promise.resolve();
    const run = (async () => {
      try {
        const made = await makeBackup(open, backupDir);
        delete backup.failing;
        backup.lastAt = new Date().toISOString();
        log('backup-ok', { why, file: made.file, rows: made.rows, bytes: made.bytes });
        events.publish(['settings']); // the seats' status line shows the new time
        try {
          const dropped = pruneBackups(backupDir);
          if (dropped.length) log('backup-pruned', { count: dropped.length });
        } catch (e) {
          log('backup-prune-failed', msg(e)); // a good backup is not undone by failing to tidy up
        }
      } catch (e) {
        backup.failing = msg(e);
        log('backup-failed', { why, dir: backupDir, error: msg(e) });
        events.publish(['settings']);
      }
    })().finally(() => {
      backingUp = null;
    });
    backingUp = run;
    return run;
  }

  // An unreadable folder is the backup's problem to report (runBackup does), not a reason to stop the keeper.
  function namesInBackupDir(): ReturnType<typeof backupFiles> {
    try {
      return backupFiles(backupDir);
    } catch {
      return [];
    }
  }

  // The backup folder the open database names (unless BM_BACKUP_DIR overrides it), and when its newest backup is.
  // Called for every database the keeper opens: at start and after a restore, which may bring another setting.
  function adoptBackupFolder(open: Db): void {
    if (!backupDirFromEnv) backupDir = configuredBackupDir(open) ?? backupDir;
    const newest = namesInBackupDir()[0]?.at;
    if (newest) backup.lastAt = newest.toISOString();
  }

  // The database is open and migrated: write the guard's baseline, start the timers (once), serve.
  function becomeReady(): void {
    if (!db) throw new Error('becomeReady without a database');
    markedRows = businessRows(db);
    writeMarker(programDirPath, dataRoot, dbPath, markedRows);
    if (!timersStarted) {
      timersStarted = true;
      // Records entered since the last marker would be forgotten by a crash: keep the baseline rising.
      setInterval(() => {
        try {
          if (db && !stopping) markedRows = raiseMarker(db, programDirPath, dataRoot, dbPath, markedRows);
        } catch (e) {
          log('marker-refresh-failed', msg(e));
        }
      }, MARKER_REFRESH_MS).unref();
      setInterval(() => {
        if (db && !stopping) void runBackup('hourly');
      }, BACKUP_EVERY_MS).unref();
    }
    state = 'ready';
    reason = undefined;
  }

  async function start(): Promise<void> {
    // Read first, then say "running": from here on a crash (or a safe mode that ends in a failed restore) must ask for the full check.
    const full = !readMarkerClean(programDirPath, dataRoot, dbPath);
    markRunning(programDirPath, dataRoot, dbPath);
    const decision = inspectBeforeOpen(programDirPath, dataRoot, dbPath);
    if (decision.action === 'safe-mode') {
      state = 'safe-mode';
      reason = decision.reason;
      log('guard-trip', { dataRoot, dbPath, reason });
      return;
    }
    // quick_check runs here, before anything is migrated or written: in full after anything but a clean stop (a crash, a power cut, a killed
    // process, a first start of this file), skipped after a clean one — it reads the whole file, 16 s for a 3-year book. The backup check
    // (verifyBackup, every hour and on stop) still reads a whole copy, so a file that went bad while the app was off is found within the hour.
    const opened = openChecked(dbPath, full);
    if ('damaged' in opened) {
      state = 'safe-mode';
      reason = 'damaged';
      log('guard-trip', { dataRoot, dbPath, reason, detail: opened.damaged });
      return;
    }
    // Opens fine but has no records although it had before (emptied, or swapped for a blank file): safe mode.
    // Nothing is migrated or written, and db stays null so a later stop() does not refresh the marker either.
    const blank = blankReason(readMarkerRows(programDirPath, dataRoot), businessRows(opened.db));
    if (blank) {
      opened.db.close();
      state = 'safe-mode';
      reason = blank;
      log('guard-trip', { dataRoot, dbPath, reason: blank });
      return;
    }
    db = opened.db;
    adoptBackupFolder(db);

    const migrated = await migrateSafely(db, backupDir);
    schemaVersion = migrated.version;
    if (migrated.backup) {
      backup.lastAt = new Date().toISOString();
      log('backup-ok', { why: 'before-migration', file: migrated.backup.file, rows: migrated.backup.rows, bytes: migrated.backup.bytes });
    }
    if (migrated.backupError) {
      backup.failing = migrated.backupError;
      log('backup-failed', { why: 'before-migration', dir: backupDir, error: migrated.backupError });
    }
    // The first backup of the day starts once the keeper is ready, not before: the book is usable at once, and the status line shows the
    // newest backup until the new one is done (seconds on a big book).
    const today = new Date().toDateString();
    const needsBackup = !namesInBackupDir().some((b) => b.at.toDateString() === today);
    becomeReady();
    log('database-open', { dbPath, action: decision.action, schemaVersion, check: full ? 'full' : 'quick' });
    if (needsBackup) void runBackup('start');
  }

  // Idempotent: every caller gets the same exit code, and none exits before the first stop has finished (a second
  // /shutdown must not cut a backup short). Failures are logged and turn the exit code to 1, never swallowed.
  function stop(why: string, finish: (code: number) => void = (code) => process.exit(code)): void {
    stopping ??= (async () => {
      let code = 0;
      const failed = (what: string) => (e: unknown) => {
        code = 1;
        log(what, { why, error: msg(e) });
      };
      events.closeAll(); // the seats' streams end now; they reconnect to the next keeper and refetch
      if (db) {
        await backingUp; // never fails: runBackup logs its own errors
        await runBackup('stop'); // a failed backup must not keep the keeper from closing the database
        // The guard's baseline for the next start, written after the close: "clean" only if the database closed (and was checkpointed).
        // A failure counting the rows must not skip the checkpoint below.
        let rows: number | null = null;
        try {
          rows = businessRows(db);
        } catch (e) {
          failed('marker-write-failed')(e);
        }
        let closed = false;
        try {
          closeDatabase(db);
          closed = true;
        } catch (e) {
          failed('stop-failed')(e);
        }
        if (rows !== null) {
          try {
            writeMarker(programDirPath, dataRoot, dbPath, rows, closed);
          } catch (e) {
            failed('marker-write-failed')(e);
          }
        }
        db = null;
      }
      log('stop', { why, code });
      return code;
    })();
    void stopping.then(finish);
  }

  // A PIN was refused. Never the PIN: the route, the seat and the code go to keeper.log. A try that started a lock (the fifth wrong one) also goes
  // into the book, with its kind and seat — here, after the route has answered, in a transaction of its own, because several PIN checks run inside
  // a transaction that a refusal can roll back. Single wrong tries are not in the book (noise).
  function pinRefused(url: string, seat: string, code: ResultCode, wait?: string): void {
    log('pin-refused', { url, seat, code, wait });
    const kinds = lockouts.splice(0);
    const open = db;
    if (!open || kinds.length === 0) return;
    try {
      open.transaction(() => {
        for (const kind of kinds) writeAudit(open, { seat, action: 'pins.locked', entity: 'settings', entityId: 'pins', after: { kind } });
      })();
      events.publish(['settings']);
    } catch (e) {
      log('audit-failed', { url, seat, error: msg(e) });
    }
  }

  function send(res: http.ServerResponse, status: number, body: unknown, after?: () => void): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    res.end(json, after);
  }

  const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });
  const refuse = (code: ResultCode, detail?: string): KeeperResult<never> => ({ ok: false, code, ...(detail ? { detail } : {}) });
  const sendResult = (res: http.ServerResponse, r: KeeperResult<unknown>): void => send(res, r.ok ? 200 : r.code === 'failed' ? 500 : 409, r);

  function readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY_BYTES) chunks.push(c);
      });
      req.on('end', () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }

  // Restoring a backup over booking.db (1.4 in safe mode, 4.2 also while the app runs). The file swap is synchronous from the first file
  // operation to the end: no request is answered between the old file going and the new one being open. The caller has closed its own
  // handle (a keeper in safe mode has none). Opening the restored file, migrating it and starting the services is the same in both.
  function swapIn(file: string, seat: string, whileRunning: boolean): KeeperResult<{ schemaVersion: number }> {
    try {
      markRunning(programDirPath, dataRoot, dbPath);
      const savedAs = restoreFiles(dbPath, backupDir, file);
      try {
        const opened = openChecked(dbPath);
        if ('damaged' in opened) throw new Error(`the restored file is damaged: ${opened.damaged}`);
        db = opened.db;
        schemaVersion = migrate(db);
        adoptBackupFolder(db);
        if (whileRunning) {
          // The book of the restored database says that it was restored, by whom, from which file and where the database as it was is kept.
          const restored = db;
          restored.transaction(() => writeAudit(restored, { seat, action: 'backup.restore', entity: 'backup', entityId: file, after: { file, savedAs: savedAs ? path.basename(savedAs) : null } }))();
        }
        becomeReady();
        void runBackup('restore'); // the first backup of the restored database, not an hour from now
      } catch (e) {
        if (db) closeDatabase(db);
        db = null;
        state = 'safe-mode';
        reason = 'damaged';
        throw e;
      }
      log('restore-applied', { file, savedAs: savedAs ?? null, schemaVersion, seat });
      events.publish([...CHANGE_TABLES]); // the whole database was replaced
      return ok({ schemaVersion: schemaVersion ?? 0 });
    } catch (e) {
      log('restore-failed', { file, error: msg(e) });
      // Failing before the last rename leaves the live file as it was: it was only closed, so open it again.
      if (!db && state !== 'safe-mode') {
        const again = openChecked(dbPath);
        if ('db' in again) db = again.db;
        else {
          state = 'safe-mode';
          reason = 'damaged';
        }
      }
      return refuse('failed', msg(e));
    }
  }

  // Restore while the app runs: the Admin PIN, nobody else has the app open, a fresh verified backup of the database as it is now (under a name
  // no backup in the folder has, the one asked for included), and only then the swap. A backup that cannot be made means no restore.
  async function restoreLive(file: string, token: string, adminPin: string, seat: string): Promise<KeeperResult<{ schemaVersion: number }>> {
    const open = db;
    if (!open || stopping) return refuse('no-database');
    const gate = pins.verify(open, 'admin', adminPin);
    if (!gate.ok) return gate;
    const others = seats.othersOnline(seat);
    if (others.length > 0) return refuse('restore-others-online', others.join(', '));
    const verdict = verifyApply(dbPath, backupDir, file, token, tokens, LATEST_SCHEMA);
    if (!verdict.ok) return refuse(verdict.code);
    await backingUp;
    // A seat may have opened while the checks above ran: look again before anything is closed.
    const nowOthers = seats.othersOnline(seat);
    if (nowOthers.length > 0) return refuse('restore-others-online', nowOthers.join(', '));
    let at = new Date();
    while (fs.existsSync(path.join(backupDir, backupName(at)))) at = new Date(at.getTime() + 60 * 1000);
    try {
      const made = await makeBackup(open, backupDir, at);
      log('backup-ok', { why: 'before-restore', file: made.file, rows: made.rows, bytes: made.bytes });
    } catch (e) {
      log('backup-failed', { why: 'before-restore', dir: backupDir, error: msg(e) });
      return refuse('restore-backup-failed', msg(e));
    }
    if (db !== open || stopping) return refuse('no-database');
    closeDatabase(open); // checkpointed: the file on disk is whole
    db = null;
    return swapIn(file, seat, true);
  }

  // A new backup folder (Admin PIN): a verified backup is made there first - that is both "can it be written" and "a backup at once" - and only
  // when it worked the setting and its audit row are written and the keeper switches. Old backups stay where they were.
  async function setBackupDir(open: Db, seat: string, dir: string, adminPin: string, confirmSameDrive: boolean): Promise<KeeperResult<{ dir: string; file: string }>> {
    const gate = pins.verify(open, 'admin', adminPin);
    if (!gate.ok) return gate;
    if (sameFolder(dir, backupDir)) return ok({ dir: backupDir, file: '' });
    if (sameDrive(dir, dataRoot) && !confirmSameDrive) return refuse('backup-dir-same-drive', dir);
    await backingUp;
    let made;
    try {
      made = await makeBackup(open, dir);
    } catch (e) {
      log('backup-failed', { why: 'new-folder', dir, error: msg(e) });
      return refuse('backup-dir-unusable', msg(e));
    }
    if (db !== open || stopping) return refuse('no-database');
    const was = backupDir;
    open.transaction(() => {
      open.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run('backupDir', dir);
      writeAudit(open, { seat, action: 'settings.backup-dir', entity: 'settings', entityId: 'backup-dir', before: { dir: was }, after: { dir } });
    })();
    backupDir = dir;
    delete backup.failing;
    backup.lastAt = new Date().toISOString();
    log('backup-ok', { why: 'new-folder', file: made.file, rows: made.rows, bytes: made.bytes });
    events.publish(['settings']);
    return ok({ dir, file: made.file });
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse, raw: string | null): Promise<void> {
    // A web page in a browser on this PC must not be able to drive the keeper (DNS rebinding included).
    if (req.headers.host !== `${HOST}:${port}`) return send(res, 403, { error: 'bad host' });
    // Every seat pings /health every 15 s with its name; that is what "this seat has the app open" rests on.
    const seatHeader = req.headers['x-bm-seat'];
    let seat = '';
    try {
      seat = typeof seatHeader === 'string' ? decodeURIComponent(seatHeader) : '';
    } catch {
      /* a malformed name is no name */
    }
    if (seat) seats.saw(seat);
    lockouts.length = 0; // a lock-out belongs to the request that caused it: none left over from one that never reached pinRefused
    const url = (req.url ?? '').split('?')[0];
    const method = req.method;
    if (url === '/health' && method === 'GET') {
      const health: KeeperHealth = { app: APP_ID, state, keeperVersion: KEEPER_VERSION, pid: process.pid, dataRoot, dbPath, backupDir, startedAt };
      if (state === 'ready' && db) health.pinsSet = pins.isSet(db);
      if (reason) health.reason = reason;
      if (schemaVersion !== undefined) health.schemaVersion = schemaVersion;
      if (backup.lastAt || backup.failing) health.backup = { ...backup };
      return send(res, 200, health);
    }

    // The one long-lived answer: a stream of change events. A GET with nothing to read; a web page cannot read it
    // (no CORS headers), and the host check above has already turned DNS rebinding away.
    if (url === '/events' && method === 'GET') {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      // One stream per seat is the norm; a page on this PC that opens many must not be able to pile them up.
      if (events.count() >= MAX_EVENT_STREAMS) return send(res, 429, { error: 'too many event streams' });
      return events.add(res);
    }

    // Everything else is a POST from our own client: JSON content type, so a cross-origin browser POST (which
    // would need a preflight we never answer) cannot reach it. Listing is a POST too: it opens every backup,
    // which a plain cross-origin GET from a web page on this PC must not be able to trigger.
    if (!ROUTES.includes(url)) return send(res, 404, { error: 'unknown route' });
    const json = /^application\/json/i.test(String(req.headers['content-type'] ?? ''));
    if (method !== 'POST' || !json) return send(res, 405, { error: 'method not allowed' });

    if (url === '/shutdown') {
      return stop('shutdown-request', (code) => {
        // Exit once the reply is out, or when the client has already gone, or after a second at the latest:
        // a keeper that closed its database must not linger and still answer /health as ready.
        send(res, 200, { bye: true });
        res.on('close', () => process.exit(code));
        setTimeout(() => process.exit(code), 1000);
      });
    }

    if (raw === null) return send(res, 413, { error: 'body too large' });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || '{}') as Record<string, unknown>;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    } catch {
      return send(res, 400, { error: 'bad json' });
    }
    const str = (k: string): string | null => (typeof body[k] === 'string' && body[k] !== '' ? (body[k] as string) : null);

    if (url === '/backups/list') {
      try {
        return sendResult(res, ok(listBackups(backupDir)));
      } catch (e) {
        return sendResult(res, refuse('failed', msg(e)));
      }
    }

    // Restore (1.4 in safe mode; 4.2 also while the app runs): preview is a read, apply swaps the database file.
    if (url === '/restore/preview') {
      const file = str('file');
      if (!file) return send(res, 400, { error: 'file required' });
      if (state === 'ready' && db && !stopping) {
        const others = seats.othersOnline(seat);
        if (others.length > 0) return sendResult(res, refuse('restore-others-online', others.join(', ')));
      } else if (state !== 'safe-mode') return sendResult(res, refuse('no-database'));
      const r = previewRestore(dbPath, backupDir, file, tokens, LATEST_SCHEMA);
      return sendResult(res, r.ok ? ok(r.value) : refuse(r.code));
    }

    if (url === '/restore/apply') {
      const file = str('file');
      const token = str('confirmToken');
      if (!file || !token) return send(res, 400, { error: 'file and confirmToken required' });
      const running = state === 'ready' && db && !stopping;
      if (!running && state !== 'safe-mode') return sendResult(res, refuse('no-database'));
      let r: KeeperResult<{ schemaVersion: number }>;
      if (running) {
        try {
          r = await restoreLive(file, token, typeof body.adminPin === 'string' ? body.adminPin : '', seat);
        } catch (e) {
          log('restore-failed', { file, error: msg(e) });
          r = refuse('failed', msg(e));
        }
        if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) pinRefused(url, seat, r.code, r.detail);
        return sendResult(res, r);
      }
      const verdict = verifyApply(dbPath, backupDir, file, token, tokens, LATEST_SCHEMA);
      if (!verdict.ok) return sendResult(res, refuse(verdict.code));
      // ponytail: a restored older schema is migrated without a fresh backup; the restored backup itself and
      // the set-aside copy are both still in the backup folder.
      return sendResult(res, swapIn(file, seat, false));
    }

    // The Admin settings (4.2): a new backup folder, this seat's name.
    if (url === '/settings/set-backup-dir' || url === '/seats/rename') {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const adminPin = typeof body.adminPin === 'string' ? body.adminPin : '';
      let r: KeeperResult<unknown>;
      try {
        if (url === '/seats/rename') {
          r = admin.renameSeat(db, seat, typeof body.name === 'string' ? body.name : '', adminPin, seats.othersOnline(seat));
          if (r.ok) {
            log('seat-renamed', { seat });
            events.publish(['settings']);
          }
        } else {
          const dir = str('dir');
          if (!dir || !isAbsoluteWindows(dir)) return send(res, 400, { error: 'absolute dir required' });
          r = await setBackupDir(db, seat, dir, adminPin, body.confirmSameDrive === true);
        }
      } catch (e) {
        log('admin-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) pinRefused(url, seat, r.code, r.detail);
      return sendResult(res, r);
    }

    if (url === '/seats') return sendResult(res, ok({ others: seats.othersOnline(seat) }));

    if (url.startsWith('/pins/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const text = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
      let r: KeeperResult<unknown>;
      try {
        if (url === '/pins/setup') r = pins.setup(db, seat, text('adminPin'), text('systemPin'));
        else if (url === '/pins/verify') {
          const kind = text('kind');
          r = kind === 'admin' || kind === 'system' ? pins.verify(db, kind, text('pin')) : refuse('bad-pin');
        } else if (url === '/pins/change-system') r = pins.changeSystem(db, seat, text('adminPin'), text('newPin'));
        else if (url === '/pins/change-admin') r = pins.changeAdmin(db, seat, text('adminPin'), text('newPin'));
        else r = pins.recover(db, seat, text('recoveryCode'), text('newAdminPin'), text('newSystemPin'));
      } catch (e) {
        log('pins-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // Never the PIN itself: the route, the seat and the outcome.
      if (r.ok) {
        if (url !== '/pins/verify') {
          log('pins-changed', { url, seat });
          events.publish(['settings']);
        }
      } else if (r.code === 'wrong-pin' || r.code === 'wrong-recovery-code' || r.code === 'pin-locked') {
        pinRefused(url, seat, r.code, r.detail);
      }
      return sendResult(res, r);
    }

    if (url.startsWith('/masters/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      // The values are checked, type by type, in masters.ts (a wrong type answers master-bad).
      const fields = (body.fields !== null && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {}) as MasterFields;
      const kind = MASTER_KINDS.find((k) => k === body.kind);
      const id = body.id;
      const version = body.version;
      const confirmSimilar = body.confirmSimilar === true;
      const pin = typeof body.systemPin === 'string' ? body.systemPin : '';
      let r: KeeperResult<unknown>;
      try {
        if (url === '/masters/all') r = ok(masters.all(db));
        else if (!kind) return send(res, 400, { error: 'kind required' });
        else if (url === '/masters/create') r = masters.create(db, seat, kind, fields, confirmSimilar);
        else if (typeof id !== 'number' || !Number.isInteger(id) || typeof version !== 'number' || !Number.isInteger(version)) {
          return send(res, 400, { error: 'id and version required' });
        } else if (url === '/masters/update') r = masters.update(db, seat, kind, id, version, fields, pin, confirmSimilar);
        else if (typeof body.active !== 'boolean') return send(res, 400, { error: 'active required' });
        else r = masters.setActive(db, seat, kind, id, version, body.active, pin);
      } catch (e) {
        log('masters-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // Never the PIN or the typed values: the route, the seat, the kind and the outcome.
      if (r.ok && url !== '/masters/all' && kind) {
        const rowId = (r.value as { id: number }).id;
        log('master-saved', { url, seat, kind, id: rowId });
        events.publish([kind], [rowId]);
      } else if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) pinRefused(url, seat, r.code, r.detail);
      return sendResult(res, r);
    }

    // Reads for the Dashboard and the search box: no write, no event, and nothing logged (a search text may be a name).
    if (url.startsWith('/dashboard/') || url === '/search') {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      try {
        if (url === '/dashboard/summary') return sendResult(res, dashboard.summary(db, typeof body.date === 'string' ? body.date : null));
        if (url === '/dashboard/pending-by-station') return sendResult(res, dashboard.pendingByStation(db));
        if (url === '/dashboard/recent') return sendResult(res, dashboard.recentLrs(db));
        return sendResult(res, search(db, typeof body.text === 'string' ? body.text : ''));
      } catch (e) {
        log('dashboard-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
    }

    if (url.startsWith('/memos/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const date = typeof body.date === 'string' ? body.date : null;
      const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
      const pin = typeof body.systemPin === 'string' ? body.systemPin : '';
      const adminPin = typeof body.adminPin === 'string' ? body.adminPin : '';
      let r: KeeperResult<unknown>;
      try {
        if (url === '/memos/defaults') r = memos.defaults(db, date);
        else if (url === '/memos/by-date') r = memos.byDate(db, date);
        else if (url === '/memos/pending') r = memos.pending(db, asPendingFilters(body.filters), asCursor(body.cursor));
        else if (url === '/memos/totals') r = memos.totals(db, asIds(body.ids));
        else if (url === '/memos/list') r = memos.list(db, asSavedFilters(body.filters), asCursor(body.cursor));
        else if (url === '/memos/create') {
          const input = asMemoInput(body.input);
          if (!input) return send(res, 400, { error: 'input with a uid required' });
          r = memos.create(db, seat, input);
        } else if (!whole(body.id)) return send(res, 400, { error: 'id required' });
        else if (url === '/memos/get') r = memos.get(db, body.id);
        else if (url === '/memos/history') r = memos.history(db, body.id);
        else if (url === '/memos/remove-lrs') r = memos.removeLrs(db, seat, body.id, asLrIds(body.lrIds), pin);
        else if (url === '/memos/add-lrs') r = memos.addLrs(db, seat, body.id, asLrIds(body.lrIds), pin);
        else if (url === '/memos/move-lrs') {
          if (!whole(body.targetId)) return send(res, 400, { error: 'targetId required' });
          r = memos.moveLrs(db, seat, body.id, asLrIds(body.lrIds), body.targetId, pin);
        } else if (!whole(body.version)) return send(res, 400, { error: 'version required' });
        else if (url === '/memos/edit') {
          const input = asHeaderInput(body.input);
          if (!input) return send(res, 400, { error: 'input required' });
          r = memos.editHeader(db, seat, body.id, body.version, input, pin);
        } else if (url === '/memos/recalculate') r = memos.recalculate(db, seat, body.id, body.version, adminPin);
        else r = memos.cancel(db, seat, body.id, body.version, typeof body.reason === 'string' ? body.reason : '', adminPin);
      } catch (e) {
        log('memos-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // Reads leave no trace. A save logs the seat and the number, never the PIN or the typed values.
      if (r.ok && url === '/memos/create') {
        const done = r.value as MemoSaved;
        if (!done.again) {
          log('memo-saved', { seat, id: done.id, no: done.challanNo, lrs: done.lrCount });
          events.publish(['memos', 'lrs'], [done.id]);
        }
      } else if (r.ok && (url === '/memos/edit' || url === '/memos/recalculate')) {
        const done = r.value as MemoChanged;
        if (done.changed) {
          log(url === '/memos/edit' ? 'memo-edited' : 'memo-recalculated', { seat, id: done.memo.id, no: done.memo.challanNo });
          events.publish(['memos'], [done.memo.id]);
        }
      } else if (r.ok && (url === '/memos/remove-lrs' || url === '/memos/add-lrs' || url === '/memos/move-lrs' || url === '/memos/cancel')) {
        const done = r.value as MemoDetail;
        log(url === '/memos/cancel' ? 'memo-cancelled' : 'memo-lrs-changed', { seat, id: done.id, no: done.challanNo, what: url.slice(7) });
        events.publish(['memos', 'lrs'], url === '/memos/move-lrs' ? [done.id, Number(body.targetId)] : [done.id]);
      } else if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) {
        pinRefused(url, seat, r.code, r.detail);
      } else if (!r.ok && r.code === 'memo-conflict') {
        log('memo-conflict', { seat, taken: r.taken?.length ?? 0 });
      }
      return sendResult(res, r);
    }

    // Wasuli (3.4): the lists are reads (no trace); every change is a compare-and-set on the rows the screen saw.
    if (url.startsWith('/wasuli/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
      const pin = typeof body.systemPin === 'string' ? body.systemPin : '';
      const seen = asSeen(body.row);
      let r: KeeperResult<unknown>;
      try {
        if (url === '/wasuli/list') r = wasuli.list(db, asWasuliFilters(body.filters), asWasuliCursor(body.cursor));
        else if (url === '/wasuli/agent-stats') r = wasuli.agentStats(db, asPeriod(body.period));
        else if (url === '/wasuli/find') {
          if (!whole(body.no)) return send(res, 400, { error: 'no required' });
          r = wasuli.find(db, body.no, whole(body.year) ? body.year : undefined);
        } else if (url === '/wasuli/assign') {
          const rows = asSeenList(body.rows);
          if (!rows || !whole(body.agentId)) return send(res, 400, { error: 'rows and agentId required' });
          r = wasuli.assign(db, seat, rows, body.agentId);
        } else if (!seen) return send(res, 400, { error: 'row required' });
        else if (url === '/wasuli/reassign') {
          if (!whole(body.agentId)) return send(res, 400, { error: 'agentId required' });
          r = wasuli.reassign(db, seat, seen, body.agentId);
        } else if (url === '/wasuli/to-pool') r = wasuli.toPool(db, seat, seen);
        else if (url === '/wasuli/collect') r = wasuli.collect(db, seat, seen, asCollectInput(body.input));
        else if (url === '/wasuli/uncollect') r = wasuli.uncollect(db, seat, seen, pin);
        else r = wasuli.remark(db, seat, seen, typeof body.remark === 'string' ? body.remark : '', pin);
      } catch (e) {
        log('wasuli-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // Never the PIN, the remark or the amount: the route, the seat and how many rows.
      if (r.ok && !['/wasuli/list', '/wasuli/find', '/wasuli/agent-stats'].includes(url)) {
        const done = r.value as WasuliChanged;
        if (done.changed) {
          log('wasuli-changed', { seat, what: url.slice(8), rows: done.rows.length });
          events.publish(['wasuli'], done.rows.map((x) => x.id));
        }
      } else if (!r.ok && r.code === 'wasuli-stale') {
        log('wasuli-stale', { seat, what: url.slice(8), rows: r.wasuli?.length ?? 0 });
      } else if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) {
        pinRefused(url, seat, r.code, r.detail);
      }
      return sendResult(res, r);
    }

    // Firm Accounts (3.5): reads only — no event, and nothing logged (a firm's name and its amounts are not for the log).
    if (url.startsWith('/firms/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      let r: KeeperResult<unknown>;
      try {
        if (url === '/firms/accounts') r = firmAccounts.accounts(db, asAccountFilters(body.filters), asAccountCursor(body.cursor));
        else if (url === '/firms/months') {
          const year = asYear(body.year);
          const role = asRole(body.role);
          if (!year || !role || typeof body.firmId !== 'number' || !Number.isInteger(body.firmId)) return send(res, 400, { error: 'firmId, year and role required' });
          r = firmAccounts.months(db, body.firmId, year, role);
        } else {
          const query = asStatementQuery(body.query);
          if (!query) return send(res, 400, { error: 'query with a firm, two dates and a role required' });
          r = url === '/firms/statement' ? firmAccounts.statement(db, query, asStatementCursor(body.cursor)) : url === '/firms/top' ? firmAccounts.statementTop(db, query) : firmAccounts.kpis(db, query);
        }
      } catch (e) {
        log('firms-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      return sendResult(res, r);
    }

    // Reports (4.1): reads only — no event, and nothing logged (names and amounts are not for the log).
    if (url.startsWith('/reports/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      let r: KeeperResult<unknown>;
      try {
        if (url === '/reports/lrs') {
          const request = asLrsRequest(body);
          if (!request) return send(res, 400, { error: 'of (a station, or a firm / walk-in name on one side) and query (two dates) required' });
          r = reports.lrs(db, request, asReportLrCursor(body.cursor));
        } else {
          const query = asReportQuery(body.query);
          if (!query) return send(res, 400, { error: 'query with two dates required' });
          const cursor = asReportCursor(body.cursor);
          const side = asPartySide(body.side);
          if (url === '/reports/date-wise') r = reports.dateWise(db, query, cursor);
          else if (url === '/reports/station-wise') r = reports.stationWise(db, query, cursor);
          else if (url === '/reports/party-wise') {
            if (!side) return send(res, 400, { error: 'side (consignor or consignee) required' });
            r = reports.partyWise(db, side, query, cursor);
          } else if (url === '/reports/truck-wise') r = reports.truckWise(db, query, cursor);
          else if (url === '/reports/firm-wise') r = reports.firmWise(db, query, cursor);
          else r = reports.wasuli(db, query, cursor);
        }
      } catch (e) {
        log('reports-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      return sendResult(res, r);
    }

    // An update is about to be installed (4.2): the Admin PIN, and one audit row.
    if (url === '/settings/update-start') {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const version = (k: string): string | null => (typeof body[k] === 'string' && /^[0-9A-Za-z.+-]{1,20}$/.test(body[k] as string) ? (body[k] as string) : null);
      const from = version('from');
      const to = version('to');
      if (!from || !to) return send(res, 400, { error: 'from and to (version numbers) required' });
      let r: KeeperResult<unknown>;
      try {
        r = admin.updateStart(db, seat, from, to, typeof body.adminPin === 'string' ? body.adminPin : '');
      } catch (e) {
        log('update-start-failed', { seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      if (r.ok) {
        log('update-start', { seat, from, to });
        events.publish(['settings']);
      } else if (r.code === 'wrong-pin' || r.code === 'pin-locked') pinRefused(url, seat, r.code, r.detail);
      return sendResult(res, r);
    }

    // History (4.2): the audit log, read — no event, and nothing logged (names and amounts are not for the log).
    if (url === '/history/list') {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const filters = asHistoryFilters(body.filters);
      if (!filters) return send(res, 400, { error: 'filters with two dates required' });
      try {
        return sendResult(res, history.list(db, filters, asHistoryCursor(body.cursor)));
      } catch (e) {
        log('history-failed', { seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
    }

    // Printing (3.3): what a printout carries (reads, no trace), the audit row of a print that went through, the company lines.
    if (url.startsWith('/print/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      let r: KeeperResult<unknown>;
      try {
        if (url === '/print/company') r = ok(printing.company(db));
        else if (url === '/print/set-company') {
          const input = body.input !== null && typeof body.input === 'object' && !Array.isArray(body.input) ? (body.input as PrintCompany) : ({} as PrintCompany);
          r = printing.setCompany(db, seat, input, typeof body.adminPin === 'string' ? body.adminPin : '');
        } else if (url === '/print/done') {
          const done = asPrintDone(body);
          if (!done) return send(res, 400, { error: 'kind, id and how required (a firm statement also its period and role)' });
          r = printing.done(db, seat, done);
        } else if (url === '/print/firm-statement') {
          const query = asStatementQuery(body.query);
          if (!query) return send(res, 400, { error: 'query with a firm, two dates and a role required' });
          r = printing.firmStatement(db, query);
        } else if (url === '/print/report') {
          const kind = asReportKind(body.report);
          const query = asReportQuery(body.query);
          if (!kind || !query) return send(res, 400, { error: 'report (one of the seven) and query with two dates required' });
          r = printing.report(db, kind, query);
        } else if (typeof body.id !== 'number' || !Number.isInteger(body.id)) return send(res, 400, { error: 'id required' });
        else r = url === '/print/memo' ? printing.memo(db, body.id) : printing.lr(db, body.id);
      } catch (e) {
        log('print-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // Never the PIN or the company lines: the route, the seat and the outcome.
      if (r.ok && url === '/print/done') log('print-done', { seat, kind: body.kind, id: body.id, how: body.how });
      else if (r.ok && url === '/print/set-company') {
        log('company-saved', { seat });
        events.publish(['settings']);
      } else if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) pinRefused(url, seat, r.code, r.detail);
      return sendResult(res, r);
    }

    if (url.startsWith('/lrs/') || url.startsWith('/settings/')) {
      if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
      const date = typeof body.date === 'string' ? body.date : null;
      let r: KeeperResult<unknown>;
      try {
        const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
        const pin = typeof body.systemPin === 'string' ? body.systemPin : '';
        if (url === '/lrs/defaults') r = ok(lrs.defaults(db, date));
        else if (url === '/lrs/by-date') r = lrs.byDate(db, date);
        else if (url === '/settings/set-lr-defaults') r = lrs.setDefaults(db, seat, asDefaultsInput(body.input), typeof body.adminPin === 'string' ? body.adminPin : '');
        else if (url === '/lrs/find') {
          if (!whole(body.no)) return send(res, 400, { error: 'no required' });
          r = lrs.find(db, body.no);
        } else if (url === '/lrs/get' || url === '/lrs/history') {
          if (!whole(body.id)) return send(res, 400, { error: 'id required' });
          r = url === '/lrs/get' ? lrs.get(db, body.id) : lrs.history(db, body.id);
        } else if (url === '/lrs/update' || url === '/lrs/cancel' || url === '/lrs/restore') {
          if (!whole(body.id) || !whole(body.version)) return send(res, 400, { error: 'id and version required' });
          if (url === '/lrs/cancel') r = lrs.cancel(db, seat, body.id, body.version, typeof body.reason === 'string' ? body.reason : '', pin);
          else if (url === '/lrs/restore') r = lrs.restore(db, seat, body.id, body.version, pin);
          else {
            const input = asLrInput(body.input);
            if (!input) return send(res, 400, { error: 'input with a uid required' });
            r = lrs.update(db, seat, body.id, body.version, input, pin);
          }
        } else {
          const input = asLrInput(body.input);
          if (!input) return send(res, 400, { error: 'input with a uid required' });
          r = url === '/lrs/preview' ? lrs.preview(db, input) : lrs.create(db, seat, input);
        }
      } catch (e) {
        log('lrs-failed', { url, seat, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
      // An LR change also names the firms it added and the wasuli row it touched, so the views that show those refetch.
      const tablesOf = (firms: boolean, wasuli: boolean): ChangeTable[] => ['lrs', ...(firms ? (['firms'] as const) : []), ...(wasuli ? (['wasuli'] as const) : [])];
      // Never the PIN or the typed values: the route, the seat and the outcome.
      if (r.ok && url === '/lrs/create') {
        const done = r.value as LrSaved;
        if (!done.again) {
          log('lr-saved', { seat, id: done.row.id, no: done.row.lrNo });
          events.publish(tablesOf(done.firmsAdded, done.wasuli), [done.row.id]);
        }
      } else if (r.ok && url === '/lrs/update') {
        const done = r.value as LrUpdated;
        if (done.changed) {
          log('lr-updated', { seat, id: done.lr.id, no: done.lr.lrNo });
          events.publish(tablesOf(done.firmsAdded, done.wasuli), [done.lr.id]);
        }
      } else if (r.ok && (url === '/lrs/cancel' || url === '/lrs/restore')) {
        const done = r.value as LrDetail;
        log(url === '/lrs/cancel' ? 'lr-cancelled' : 'lr-restored', { seat, id: done.id, no: done.lrNo });
        events.publish(tablesOf(false, done.wasuliPaise > 0), [done.id]);
      } else if (r.ok && url === '/settings/set-lr-defaults') {
        events.publish(['settings']);
      } else if (!r.ok && (r.code === 'wrong-pin' || r.code === 'pin-locked')) {
        pinRefused(url, seat, r.code, r.detail);
      }
      return sendResult(res, r);
    }

    // /backups/export: a fresh verified backup in a folder the person chose (for the USB copy).
    const dir = str('dir');
    if (!dir || !path.isAbsolute(dir)) return send(res, 400, { error: 'absolute dir required' });
    if (state !== 'ready' || !db || stopping) return sendResult(res, refuse('no-database'));
    try {
      await backingUp; // the same temp name as a backup of the same minute: one at a time
      const made = await makeBackup(db, dir);
      log('backup-ok', { why: 'export', file: made.file, rows: made.rows, bytes: made.bytes });
      return sendResult(res, ok({ file: made.file }));
    } catch (e) {
      log('backup-failed', { why: 'export', dir, error: msg(e) });
      return sendResult(res, refuse('failed', msg(e)));
    }
  }

  const server = http.createServer((req, res) => {
    // Read the whole body first: a reply sent while the client is still writing can reset its connection.
    void readBody(req)
      .then((raw) => route(req, res, raw))
      .catch((e: unknown) => {
        log('route-error', { url: req.url, error: msg(e) });
        if (!res.headersSent) send(res, 500, { error: 'internal error' });
      });
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      log('second-keeper-exit', { port });
      process.exit(0); // another keeper owns the port; nothing to do
    }
    log('server-error', String(e.message));
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    log('start', { pid: process.pid, version: KEEPER_VERSION, dataRoot, port });
    start().catch((e: unknown) => {
      log('keeper-fatal', msg(e));
      try {
        if (db) closeDatabase(db); // e.g. the marker could not be written after a successful open
      } catch {
        /* exiting anyway; the WAL survives */
      }
      process.exit(1);
    });
  });

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // Last line of defence: log and keep serving (Node 16 would otherwise end the process on a rejection).
  process.on('uncaughtException', (e) => log('uncaught-exception', msg(e)));
  process.on('unhandledRejection', (e) => log('unhandled-rejection', msg(e)));
}

if (require.main === module) main();

// The keeper: the one process per Windows host that owns booking.db. Started detached by the first seat
// (electron/keeperBridge.ts) as `electron.exe server.js <dataRoot> <port>` with ELECTRON_RUN_AS_NODE=1.
// Listens on 127.0.0.1 only. Taking the port is the single-instance rule: it happens BEFORE the database is
// touched, so a second keeper started at the same moment exits without doing anything.
// The data root is checked by main before it spawns this (keeper/dataRoot.ts); the keeper trusts its argument.
import http from 'node:http';
import path from 'node:path';
import {
  APP_ID,
  KEEPER_VERSION,
  type BackupStatus,
  type GuardReason,
  type KeeperHealth,
  type KeeperResult,
  type ResultCode,
} from '../shared';
import { backupFiles, listBackups, makeBackup, migrateSafely, pruneBackups } from './backup';
import { businessRows, closeDatabase, hasTable, openChecked, raiseMarker, type Db } from './db';
import { blankReason, inspectBeforeOpen, readMarkerRows, writeMarker } from './guard';
import { makeLog } from './log';
import { MIGRATIONS, migrate } from './migrations';
import { DEFAULT_BACKUP_DIR, logPath, programDir } from './paths';
import { makeTokens, previewRestore, restoreFiles, verifyApply } from './restore';

const HOST = '127.0.0.1';
const MARKER_REFRESH_MS = 5 * 60 * 1000;
const BACKUP_EVERY_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
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
        try {
          const dropped = pruneBackups(backupDir);
          if (dropped.length) log('backup-pruned', { count: dropped.length });
        } catch (e) {
          log('backup-prune-failed', msg(e)); // a good backup is not undone by failing to tidy up
        }
      } catch (e) {
        backup.failing = msg(e);
        log('backup-failed', { why, dir: backupDir, error: msg(e) });
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
    const decision = inspectBeforeOpen(programDirPath, dataRoot, dbPath);
    if (decision.action === 'safe-mode') {
      state = 'safe-mode';
      reason = decision.reason;
      log('guard-trip', { dataRoot, dbPath, reason });
      return;
    }
    // quick_check runs here, before anything is migrated or written.
    const opened = openChecked(dbPath);
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
    // First backup of the day is taken before "ready", so the status line is right the first time it is read.
    const today = new Date().toDateString();
    if (!namesInBackupDir().some((b) => b.at.toDateString() === today)) await runBackup('start');
    becomeReady();
    log('database-open', { dbPath, action: decision.action, schemaVersion });
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
      if (db) {
        await backingUp; // never fails: runBackup logs its own errors
        await runBackup('stop'); // a failed backup must not keep the keeper from closing the database
        // The guard's baseline for the next start. A failure here must not skip the checkpoint below.
        try {
          writeMarker(programDirPath, dataRoot, dbPath, businessRows(db));
        } catch (e) {
          failed('marker-write-failed')(e);
        }
        try {
          closeDatabase(db);
        } catch (e) {
          failed('stop-failed')(e);
        }
        db = null;
      }
      log('stop', { why, code });
      return code;
    })();
    void stopping.then(finish);
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

  // The restore routes exist only in safe mode: restoring from normal mode comes with Settings behind the admin PIN.
  const safeModeOnly = (): KeeperResult<never> | null => (state === 'safe-mode' ? null : refuse('not-in-safe-mode'));

  async function route(req: http.IncomingMessage, res: http.ServerResponse, raw: string | null): Promise<void> {
    // A web page in a browser on this PC must not be able to drive the keeper (DNS rebinding included).
    if (req.headers.host !== `${HOST}:${port}`) return send(res, 403, { error: 'bad host' });
    const url = (req.url ?? '').split('?')[0];
    const method = req.method;
    if (url === '/health' && method === 'GET') {
      const health: KeeperHealth = { app: APP_ID, state, keeperVersion: KEEPER_VERSION, dataRoot, dbPath, startedAt };
      if (reason) health.reason = reason;
      if (schemaVersion !== undefined) health.schemaVersion = schemaVersion;
      if (backup.lastAt || backup.failing) health.backup = { ...backup };
      return send(res, 200, health);
    }

    // Everything else is a POST from our own client: JSON content type, so a cross-origin browser POST (which
    // would need a preflight we never answer) cannot reach it. Listing is a POST too: it opens every backup,
    // which a plain cross-origin GET from a web page on this PC must not be able to trigger.
    const known = ['/shutdown', '/backups/list', '/restore/preview', '/restore/apply', '/backups/export'];
    if (!known.includes(url)) return send(res, 404, { error: 'unknown route' });
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

    if (url === '/restore/preview') {
      const gate = safeModeOnly();
      const file = str('file');
      if (gate || !file) return gate ? sendResult(res, gate) : send(res, 400, { error: 'file required' });
      const r = previewRestore(dbPath, backupDir, file, tokens, LATEST_SCHEMA);
      return sendResult(res, r.ok ? ok(r.value) : refuse(r.code));
    }

    if (url === '/restore/apply') {
      const gate = safeModeOnly();
      const file = str('file');
      const token = str('confirmToken');
      if (gate || !file || !token) return gate ? sendResult(res, gate) : send(res, 400, { error: 'file and confirmToken required' });
      const verdict = verifyApply(dbPath, backupDir, file, token, tokens, LATEST_SCHEMA);
      if (!verdict.ok) return sendResult(res, refuse(verdict.code));
      // Synchronous from here to the end: no other request is answered between the old file going and the new
      // one being open. In safe mode this keeper holds no handle on the live file.
      // ponytail: a restored older schema is migrated without a fresh backup; the restored backup itself and
      // the set-aside copy are both still in the backup folder.
      try {
        const savedAs = restoreFiles(dbPath, backupDir, file);
        try {
          const opened = openChecked(dbPath);
          if ('damaged' in opened) throw new Error(`the restored file is damaged: ${opened.damaged}`);
          db = opened.db;
          schemaVersion = migrate(db);
          adoptBackupFolder(db);
          becomeReady();
          void runBackup('restore'); // the first backup of the restored database, not an hour from now
        } catch (e) {
          if (db) closeDatabase(db);
          db = null;
          state = 'safe-mode';
          reason = 'damaged';
          throw e;
        }
        log('restore-applied', { file, savedAs: savedAs ?? null, schemaVersion });
        return sendResult(res, ok({ schemaVersion }));
      } catch (e) {
        log('restore-failed', { file, error: msg(e) });
        return sendResult(res, refuse('failed', msg(e)));
      }
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

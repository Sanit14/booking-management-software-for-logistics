// The keeper: the one process per Windows host that owns booking.db. Started detached by the first seat
// (electron/keeperBridge.ts) as `electron.exe server.js <dataRoot> <port>` with ELECTRON_RUN_AS_NODE=1.
// Listens on 127.0.0.1 only. Taking the port is the single-instance rule: it happens BEFORE the database is
// touched, so a second keeper started at the same moment exits without doing anything.
// The data root is checked by main before it spawns this (keeper/dataRoot.ts); the keeper trusts its argument.
import http from 'node:http';
import path from 'node:path';
import { APP_ID, KEEPER_VERSION, type GuardReason, type KeeperHealth } from '../shared';
import { closeDatabase, openDatabase, type Db } from './db';
import { inspectBeforeOpen, writeMarker } from './guard';
import { makeLog } from './log';
import { logPath, programDir } from './paths';

const HOST = '127.0.0.1';

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
  // Opening the database is synchronous inside the listen callback, so no request is ever answered before
  // this is set; 'safe-mode' is just the conservative default.
  let state: 'ready' | 'safe-mode' = 'safe-mode';
  let reason: GuardReason | undefined;
  let db: Db | null = null;
  let stopping = false;

  // Idempotent. Failures are logged and turn the exit code to 1, never swallowed.
  function stop(why: string, finish?: (code: number) => void): void {
    if (stopping) return finish?.(0); // a second /shutdown while the first is replying: reply too
    stopping = true;
    let code = 0;
    try {
      if (db) closeDatabase(db);
    } catch (e) {
      code = 1;
      log('stop-failed', { why, error: String((e as Error)?.message ?? e) });
    }
    log('stop', { why, code });
    (finish ?? process.exit)(code);
  }

  function send(res: http.ServerResponse, status: number, body: unknown, after?: () => void): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    res.end(json, after);
  }

  const server = http.createServer((req, res) => {
    req.resume(); // never leave a request body unread: replying first can reset the client's connection
    try {
      // A web page in a browser on this PC must not be able to drive the keeper (DNS rebinding included).
      if (req.headers.host !== `${HOST}:${port}`) return send(res, 403, { error: 'bad host' });
      const url = (req.url ?? '').split('?')[0];
      if (url === '/health' && req.method === 'GET') {
        const health: KeeperHealth = { app: APP_ID, state, keeperVersion: KEEPER_VERSION, dataRoot, dbPath, startedAt };
        if (reason) health.reason = reason;
        return send(res, 200, health);
      }
      if (url === '/shutdown') {
        // JSON content type = only our own client; a cross-origin browser POST would need a preflight we never answer.
        const json = /^application\/json/i.test(String(req.headers['content-type'] ?? ''));
        if (req.method !== 'POST' || !json) return send(res, 405, { error: 'method not allowed' });
        return stop('shutdown-request', (code) => {
          // Exit once the reply is out, or when the client has already gone, or after a second at the latest:
          // a keeper that closed its database must not linger and still answer /health as ready.
          send(res, 200, { bye: true });
          res.on('close', () => process.exit(code));
          setTimeout(() => process.exit(code), 1000);
        });
      }
      return send(res, 404, { error: 'unknown route' });
    } catch (e) {
      log('route-error', { url: req.url, error: String((e as Error)?.message ?? e) });
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    }
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
    try {
      const decision = inspectBeforeOpen(programDirPath, dataRoot, dbPath);
      if (decision.action === 'safe-mode') {
        state = 'safe-mode';
        reason = decision.reason;
        log('guard-trip', { dataRoot, dbPath, reason });
        return;
      }
      db = openDatabase(dbPath);
      writeMarker(programDirPath, dataRoot, dbPath);
      state = 'ready';
      log('database-open', { dbPath, action: decision.action });
    } catch (e) {
      log('keeper-fatal', String((e as Error)?.message ?? e));
      try {
        if (db) closeDatabase(db); // e.g. the marker could not be written after a successful open
      } catch {
        /* exiting anyway; the WAL survives */
      }
      process.exit(1);
    }
  });

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // Last line of defence: log and keep serving (Node 16 would otherwise end the process on a rejection).
  process.on('uncaughtException', (e) => log('uncaught-exception', String(e?.message ?? e)));
  process.on('unhandledRejection', (e) => log('unhandled-rejection', String((e as Error)?.message ?? e)));
}

if (require.main === module) main();

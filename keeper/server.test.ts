// Integration: the keeper is started the way production starts it (Electron exe as plain Node), because the
// better-sqlite3 build only loads under Electron's Node, not the Node that runs these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { callJson, probe, shutdown } from './client';
import { markerPath } from './guard';
import type { KeeperHealth } from '../shared';

const electronExe: string = createRequire(__filename)('electron') as unknown as string;
const serverJs = path.join(__dirname, 'server.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

// A failed assertion must not leave keepers running.
const children: ChildProcess[] = [];
const run = async (body: () => Promise<void>): Promise<void> => {
  try {
    await body();
  } finally {
    children.splice(0).forEach((c) => c.kill());
  }
};

interface Running {
  child: ChildProcess;
  exited: Promise<number | null>;
}

function startKeeper(root: string, port: number, programData: string, backupDir: string): Running {
  const child = spawn(electronExe, [serverJs, root, String(port)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROGRAMDATA: programData, BM_BACKUP_DIR: backupDir },
    stdio: 'ignore',
    windowsHide: true,
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  children.push(child);
  return { child, exited };
}

async function waitUp(port: number): Promise<KeeperHealth> {
  for (let i = 0; i < 100; i++) {
    const p = await probe(port);
    if (p.kind === 'up' && p.health.state !== 'starting') return p.health;
    await sleep(150);
  }
  throw new Error('keeper did not come up');
}

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`not within ${ms} ms`)))]);

function request(port: number, method: string, headers: http.OutgoingHttpHeaders): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/shutdown', method, headers, agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end('{}');
  });
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-keeper-'));
  const root = path.join(dir, 'data');
  const programData = path.join(dir, 'pd');
  return { dir, root, programData, programDir: path.join(programData, 'BookingManager'), dbPath: path.join(root, 'booking.db'), backupDir: path.join(dir, 'backups') };
}

test('keeper: start, one keeper per port, shutdown leaves an intact database', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);

  const health = await waitUp(port);
  assert.equal(health.app, 'booking-manager');
  assert.equal(health.state, 'ready');
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.dataRoot, s.root);
  assert.equal(health.dbPath, s.dbPath);
  assert.ok(fs.statSync(s.dbPath).size > 0, 'a fresh WAL database is never 0 bytes');
  assert.ok(fs.existsSync(markerPath(s.programDir, s.root)), 'marker written after the first open');
  const log = fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8');
  assert.match(log, /\tstart\t/);
  assert.match(log, /\tdatabase-open\t/);

  // A second keeper on the same port exits quietly and does not take over.
  const second = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal(await within(second.exited, 10000), 0);
  assert.equal((await waitUp(port)).startedAt, health.startedAt);

  // Only our own client may stop it: wrong content type, wrong method, wrong Host are refused.
  assert.equal(await request(port, 'POST', { 'Content-Type': 'text/plain' }), 405);
  assert.equal(await request(port, 'GET', { 'Content-Type': 'application/json' }), 405);
  assert.equal(await request(port, 'POST', { 'Content-Type': 'application/json', Host: 'evil.test' }), 403);
  assert.equal((await probe(port)).kind, 'up');

  assert.equal(await shutdown(port), true);
  assert.equal(await within(first.exited, 10000), 0);
  assert.deepEqual((await probe(port)), { kind: 'down', refused: true });

  const bytes = fs.readFileSync(s.dbPath);
  assert.equal(bytes.subarray(0, 16).toString('latin1'), 'SQLite format 3\0');
  assert.equal(fs.existsSync(s.dbPath + '-wal'), false, 'WAL folded into the database on clean close');
  assert.match(fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8'), /\tstop\t/);
  // A clean stop leaves the guard its baseline: how many records the database held.
  assert.equal(JSON.parse(fs.readFileSync(markerPath(s.programDir, s.root), 'utf8')).businessRows, 0);
}));

test('keeper: marker says records existed but the database has none = safe mode, nothing is touched', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  await waitUp(port);
  assert.equal(await shutdown(port), true);
  await within(first.exited, 10000);

  // Pretend the database held 5 records when it was last closed, so the empty one now looks swapped or wiped.
  const marker = markerPath(s.programDir, s.root);
  fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(fs.readFileSync(marker, 'utf8')), businessRows: 5 }));
  const dbBefore = fs.readFileSync(s.dbPath);

  const again = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.state, 'safe-mode');
  assert.equal(health.reason, 'marker-with-no-rows');
  assert.equal(health.schemaVersion, undefined);
  assert.match(fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8'), /\tguard-trip\t/);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(again.exited, 10000), 0);
  assert.ok(fs.readFileSync(s.dbPath).equals(dbBefore), 'the database file is byte for byte as it was');
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).businessRows, 5, 'the marker keeps its baseline');
}));

test('keeper: marker + deleted database = safe mode, nothing is created', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  await waitUp(port);
  assert.equal(await shutdown(port), true);
  await within(first.exited, 10000);

  fs.rmSync(s.dbPath);
  const again = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.state, 'safe-mode');
  assert.equal(health.reason, 'marker-without-database');
  assert.equal(fs.existsSync(s.dbPath), false, 'the keeper must not create a new database');
  assert.match(fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8'), /\tguard-trip\t/);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(again.exited, 10000), 0);
  assert.equal(fs.existsSync(s.dbPath), false);
}));

// --- backups, damage check, restore ---------------------------------------------------------------------------

const slow = { timeoutMs: 30000 };
const post = (port: number, url: string, body: unknown) => callJson(port, 'POST', url, body, slow);
const logOf = (s: ReturnType<typeof sandbox>) => fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8');
const backupsIn = (dir: string) => fs.readdirSync(dir).filter((n) => /^booking-\d{8}-\d{4}\.db$/.test(n));
const beforeRestoreIn = (dir: string) => fs.readdirSync(dir).filter((n) => n.startsWith('booking-before-restore-'));
type Listing = { ok: true; value: { file: string; damaged: boolean }[] };

/** Start a keeper, wait until it is ready (its first backup is taken on the way), stop it cleanly. */
async function firstRun(s: ReturnType<typeof sandbox>, port: number): Promise<void> {
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}

test('keeper: the first backup of the day is made on start, shows in health and the log, and the folder holds only the .db', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.state, 'ready');
  assert.ok(health.backup?.lastAt, 'last backup time is in /health');
  assert.equal(health.backup?.failing, undefined);
  assert.ok(Date.now() - new Date(health.backup?.lastAt ?? 0).getTime() < 60000, 'within a minute of start');
  assert.equal(backupsIn(s.backupDir).length, 1);
  assert.deepEqual(fs.readdirSync(s.backupDir), backupsIn(s.backupDir), 'no temp, -wal or -shm files');
  assert.match(logOf(s), /\tbackup-ok\t.*"why":"start"/);

  const list = (await post(port, '/backups/list', {})).json as Listing;
  assert.equal(list.ok, true);
  assert.deepEqual(list.value.map((b) => b.damaged), [false]);

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  assert.match(logOf(s), /"why":"stop"/, 'a backup on clean stop');
}));

test('keeper: an unwritable backup folder does not stop the keeper; health says backups are failing', () => run(async () => {
  const s = sandbox();
  fs.mkdirSync(s.dir, { recursive: true });
  const blocker = path.join(s.dir, 'a-file');
  fs.writeFileSync(blocker, 'x');
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, path.join(blocker, 'backups'));
  const health = await waitUp(port);
  assert.equal(health.state, 'ready', 'bookings can still be taken');
  assert.ok(health.backup?.failing, 'the reason is reported');
  assert.equal(health.backup?.lastAt, undefined);
  assert.match(logOf(s), /\tbackup-failed\t/);
  assert.equal(await shutdown(port), true);
  assert.equal(await within(k.exited, 10000), 0, 'a failed backup is not a failed stop');
}));

test('keeper: deleted database = safe mode -> list, preview, restore -> ready again; a wrong token restores nothing', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  await firstRun(s, port);
  fs.rmSync(s.dbPath);

  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.state, 'safe-mode');
  assert.equal(health.reason, 'marker-without-database');
  assert.equal(fs.existsSync(s.dbPath), false);

  const list = (await post(port, '/backups/list', {})).json as Listing;
  assert.equal(list.ok, true);
  const file = list.value[0].file;
  assert.equal(list.value[0].damaged, false);

  const preview = (await post(port, '/restore/preview', { file })).json as { ok: true; value: { token: string; live: string; backup: { schemaVersion: number } } };
  assert.equal(preview.ok, true);
  assert.equal(preview.value.live, 'missing');
  assert.equal(preview.value.backup.schemaVersion, 1);

  const bad = await post(port, '/restore/apply', { file, confirmToken: 'not-the-token' });
  assert.equal(bad.status, 409);
  assert.deepEqual(bad.json, { ok: false, code: 'bad-token' });
  assert.equal(fs.existsSync(s.dbPath), false, 'nothing was restored');
  assert.equal((await waitUp(port)).state, 'safe-mode');

  const applied = await post(port, '/restore/apply', { file, confirmToken: preview.value.token });
  assert.deepEqual(applied.json, { ok: true, value: { schemaVersion: 1 } });
  const after = await waitUp(port);
  assert.equal(after.state, 'ready');
  assert.equal(after.schemaVersion, 1);
  assert.equal(after.reason, undefined);
  assert.ok(after.backup?.lastAt, 'the status line knows the backup it was restored from');
  assert.match(logOf(s), /\trestore-applied\t/);
  assert.deepEqual(beforeRestoreIn(s.backupDir), [], 'there was no live file to set aside');

  // The marker was updated: a clean stop and start again goes straight to ready.
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.equal(await shutdown(port), true);
}));

test('keeper: a database overwritten with random bytes = safe mode "damaged", left untouched, restore sets it aside and works', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  await firstRun(s, port);
  const garbage = crypto.randomBytes(40);
  fs.writeFileSync(s.dbPath, garbage);

  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.state, 'safe-mode');
  assert.equal(health.reason, 'damaged');
  assert.ok(fs.readFileSync(s.dbPath).equals(garbage), 'nothing was migrated or written');
  assert.match(logOf(s), /\tguard-trip\t.*damaged/);

  const file = ((await post(port, '/backups/list', {})).json as Listing).value[0].file;
  const preview = (await post(port, '/restore/preview', { file })).json as { ok: true; value: { token: string; live: string } };
  assert.equal(preview.value.live, 'damaged');
  const applied = await post(port, '/restore/apply', { file, confirmToken: preview.value.token });
  assert.equal(applied.status, 200);
  assert.equal((await waitUp(port)).state, 'ready');

  const saved = beforeRestoreIn(s.backupDir);
  assert.equal(saved.length, 1, 'the damaged file is kept, not deleted');
  assert.ok(fs.readFileSync(path.join(s.backupDir, saved[0])).equals(garbage));

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}));

test('keeper: restore is not available outside safe mode, and only to our own client', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const file = ((await post(port, '/backups/list', {})).json as Listing).value[0].file;

  for (const url of ['/restore/preview', '/restore/apply']) {
    const r = await post(port, url, { file, confirmToken: 'x' });
    assert.equal(r.status, 409, url);
    assert.deepEqual(r.json, { ok: false, code: 'not-in-safe-mode' });
  }
  // JSON content type and POST are required on every named write route, as on /shutdown.
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/restore/apply', method: 'POST', headers: { 'Content-Type': 'text/plain' }, agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(status, 405);
  assert.equal((await callJson(port, 'GET', '/backups/list')).status, 405, 'listing opens every backup: not a plain GET');
  assert.equal((await post(port, '/backups/export', { dir: 'relative\\folder' })).status, 400);

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}));

test('keeper: export writes a verified backup to the folder asked for, and refuses without a database', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const usb = path.join(s.dir, 'usb-stick');

  const r = (await post(port, '/backups/export', { dir: usb })).json as { ok: true; value: { file: string } };
  assert.equal(r.ok, true);
  assert.equal(path.dirname(r.value.file), usb);
  const bytes = fs.readFileSync(r.value.file);
  assert.equal(bytes.subarray(0, 16).toString('latin1'), 'SQLite format 3\0');
  assert.equal(bytes[18], 1, 'a self-contained file (rollback journal), so it needs no -wal beside it');
  assert.deepEqual(fs.readdirSync(usb), [path.basename(r.value.file)]);
  assert.match(logOf(s), /"why":"export"/);
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);

  // Safe mode has no database to copy.
  fs.rmSync(s.dbPath);
  const again = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'safe-mode');
  assert.deepEqual((await post(port, '/backups/export', { dir: usb })).json, { ok: false, code: 'no-database' });
  assert.equal(await shutdown(port), true);
  await within(again.exited, 10000);
}));

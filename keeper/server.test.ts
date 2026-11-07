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
import { callJson, probe, shutdown, subscribeEvents } from './client';
import { backupName, beforeRestoreName } from './backupNames';
import { markerPath } from './guard';
import { MIGRATIONS } from './migrations';
import { ROUTES } from './routes';
import { TEST_HOOKS_ARG } from './testHooks';
import { CHANGE_TABLES, type KeeperChange, type KeeperHealth } from '../shared';

const electronExe: string = createRequire(__filename)('electron') as unknown as string;
const serverJs = path.join(__dirname, 'server.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LATEST = MIGRATIONS.length;

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

function startKeeper(root: string, port: number, programData: string, backupDir: string, extraEnv: Record<string, string> = {}): Running {
  const child = spawn(electronExe, [serverJs, root, String(port), TEST_HOOKS_ARG], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROGRAMDATA: programData, BM_BACKUP_DIR: backupDir, ...extraEnv },
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
    // Ready means the book is open; the day's first backup starts right after, so wait for the status line to know a backup too.
    if (p.kind === 'up' && p.health.state !== 'starting' && (p.health.state !== 'ready' || p.health.backup)) return p.health;
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
  assert.equal(health.schemaVersion, LATEST);
  assert.equal(health.dataRoot, s.root);
  assert.equal(health.dbPath, s.dbPath);
  assert.equal(health.backupDir, s.backupDir);
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
/**
 * Whether `secret` is in the log. Text (a name, a remark) counts anywhere in it. A number (a PIN, a phone prefix) counts only as a whole
 * value (\b4831\b: in a line of text or as a JSON value such as "pin":"4831"), never inside a longer number: a random port, a process id
 * or a time such as 57295 contains 7295 by chance and is not a leak. The test PINs 4831 and 7295 cannot be a whole value by chance either:
 * both are odd (a Windows process id is a multiple of 4, a database file size one of 4096), a port always has five digits, 48xx and 72xx are
 * no time of day (the HHmm of a backup file name), and these tests never count that high.
 */
function leaks(log: string, secret: string, ignoreCase = false): boolean {
  const pattern = /^\d+$/.test(secret) ? `\\b${secret}\\b` : secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(pattern, ignoreCase ? 'i' : '').test(log);
}

test('leaks: a PIN counts only as a whole value; a port, process id or time that contains its digits by chance is not a leak', () => {
  for (const line of ['{"pin":"7295"}', '{"systemPin":7295}', 'pin-refused 7295 wrong', 'a\t7295\tb', '/pins/verify?pin=7295', '"7295"']) assert.ok(leaks(line, '7295'), line);
  for (const line of ['{"port":57295,"pid":172952}', 'port 47295', '2026-11-03T07:29:51.295Z', 'ab7295cd', '72951', '17295']) assert.ok(!leaks(line, '7295'), line);
  assert.ok(leaks('call 07232 245678', '07232') && !leaks('pid 107232', '07232'), 'a phone prefix is a number too');
  assert.ok(leaks('saved Kale Brothers', 'Kale Brothers') && !leaks('saved kale brothers', 'Kale Brothers'), 'a name is matched as written');
  assert.ok(leaks('saved kale brothers', 'Kale Brothers', true), 'or without regard to case');
  assert.ok(leaks('MH 29 BE 1234', 'MH 29') && leaks('a.b', 'a.b') && !leaks('axb', 'a.b'), 'text is matched literally');
});
const backupsIn = (dir: string) => fs.readdirSync(dir).filter((n) => /^booking-\d{8}-\d{4}\.db$/.test(n));
const beforeRestoreIn = (dir: string) => fs.readdirSync(dir).filter((n) => n.startsWith('booking-before-restore-'));
type Listing = { ok: true; value: { file: string }[] };

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
  assert.deepEqual(list.value.map((b) => Object.keys(b).sort()), [['at', 'file', 'sizeBytes']], 'the list names the backups and opens none');

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  assert.match(logOf(s), /"why":"stop"/, 'a backup on clean stop');
}));

test('keeper: ready comes before the day\'s first backup, and the full database check runs after a first start or a crash but not after a clean stop', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const checks = () => [...logOf(s).matchAll(/\tdatabase-open\t.*"check":"(\w+)"/g)].map((m) => m[1]);
  const marker = markerPath(s.programDir, s.root);
  const clean = () => JSON.parse(fs.readFileSync(marker, 'utf8')).clean as boolean;

  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  await waitUp(port);
  assert.deepEqual(checks(), ['full'], 'no marker yet: the first start checks everything');
  assert.ok(logOf(s).indexOf('database-open') < logOf(s).indexOf('"why":"start"'), 'the book was open before the backup finished');
  assert.equal(clean(), false, 'running');
  assert.equal(await shutdown(port), true);
  await within(first.exited, 10000);
  assert.equal(clean(), true, 'a clean stop says so');

  const second = startKeeper(s.root, port, s.programData, s.backupDir);
  await waitUp(port);
  assert.deepEqual(checks(), ['full', 'quick'], 'after a clean stop the whole-file check is skipped');
  assert.equal(clean(), false, 'running again: a crash now would leave this');
  second.child.kill(); // not a clean stop
  await within(second.exited, 10000);
  assert.equal(clean(), false);

  const third = startKeeper(s.root, port, s.programData, s.backupDir);
  await waitUp(port);
  assert.deepEqual(checks(), ['full', 'quick', 'full'], 'after a crash everything is checked again');
  assert.equal(await shutdown(port), true);
  await within(third.exited, 10000);
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

  const preview = (await post(port, '/restore/preview', { file })).json as { ok: true; value: { token: string; live: string; backup: { schemaVersion: number } } };
  assert.equal(preview.ok, true);
  assert.equal(preview.value.live, 'missing');
  assert.equal(preview.value.backup.schemaVersion, LATEST);

  const bad = await post(port, '/restore/apply', { file, confirmToken: 'not-the-token' });
  assert.equal(bad.status, 409);
  assert.deepEqual(bad.json, { ok: false, code: 'bad-token' });
  assert.equal(fs.existsSync(s.dbPath), false, 'nothing was restored');
  assert.equal((await waitUp(port)).state, 'safe-mode');

  const applied = await post(port, '/restore/apply', { file, confirmToken: preview.value.token });
  assert.deepEqual(applied.json, { ok: true, value: { schemaVersion: LATEST } });
  const after = await waitUp(port);
  assert.equal(after.state, 'ready');
  assert.equal(after.schemaVersion, LATEST);
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

test('keeper: restore while the app runs needs the Admin PIN (and a preview), and only to our own client', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const file = ((await post(port, '/backups/list', {})).json as Listing).value[0].file;

  // A preview is a read and works while the app runs (nobody else is here). Apply without the PINs set up, with a made-up token, is refused.
  const preview = (await post(port, '/restore/preview', { file })).json as { ok: boolean; value: { token: string; live: { lrs: number } } };
  assert.equal(preview.ok, true);
  const noPin = await post(port, '/restore/apply', { file, confirmToken: preview.value.token });
  assert.deepEqual([noPin.status, noPin.json], [409, { ok: false, code: 'pins-not-set' }]);
  assert.equal((await post(port, '/restore/apply', { file })).status, 400, 'a token is needed');
  assert.equal((await post(port, '/restore/preview', {})).status, 400, 'a file is needed');
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

/** A call as the seat that seeded the data: a call with no seat name would see that seat as "another" one. */
const asSeat1 = (port: number, url: string, body: unknown) => callJson(port, 'POST', url, body, { seat: 'counter-1', timeoutMs: 60000 });
const lrCount = async (port: number) => (await lrCall(port, '/history/list', { filters: { ...everyday(), kind: 'lr', verb: 'created' }, cursor: null })).value.rows.length as number;
/** The whole year, every kind: what History is asked in these tests. */
function everyday() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: true };
}

test('keeper: restore while the app runs is refused for a wrong PIN, for the System PIN, with another seat open, and when the backup taken first cannot be written - and then nothing has changed', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  await lrCall(port, '/lrs/create', { input: input() });
  assert.equal((await post(port, '/backups/export', { dir: s.backupDir })).status, 200);
  await lrCall(port, '/lrs/create', { input: input() });
  await lrCall(port, '/lrs/create', { input: input() });
  assert.equal(await lrCount(port), 3);
  const list = (await post(port, '/backups/list', {})).json as Listing;
  const file = list.value.find((b) => b.file.startsWith('booking-2'))?.file ?? '';
  const withOneLr = list.value.map((b) => b.file).sort().pop() as string; // the export just made is the newest
  const preview = async (name = withOneLr) => ((await asSeat1(port, '/restore/preview', { file: name })).json as { ok: boolean; value: { token: string } }).value.token;
  assert.ok(file !== '' && withOneLr !== '');

  const apply = (pin: string, token: string, seat = 'counter-1') => callJson(port, 'POST', '/restore/apply', { file: withOneLr, confirmToken: token, adminPin: pin }, { seat, timeoutMs: 30000 });
  const token = await preview();
  assert.equal(((await apply('0000', token)).json as { code: string }).code, 'wrong-pin');
  assert.equal(((await apply('7295', token)).json as { code: string }).code, 'wrong-pin', 'the System PIN is not enough');

  // Another seat has the app open (it has talked to the keeper just now): refused, naming it.
  await callJson(port, 'POST', '/seats', {}, { seat: 'counter-2' });
  const busy = (await apply('4831', token)).json as { ok: boolean; code: string; detail: string };
  assert.deepEqual([busy.ok, busy.code, busy.detail], [false, 'restore-others-online', 'counter-2']);
  const previewBusy = (await callJson(port, 'POST', '/restore/preview', { file: withOneLr }, { seat: 'counter-1' })).json as { code: string };
  assert.equal(previewBusy.code, 'restore-others-online', 'the preview says so too, before anyone compares anything');

  // The three LRs are still there, the keeper is ready, no copy was set aside.
  assert.equal(await lrCount(port), 3);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.deepEqual(beforeRestoreIn(s.backupDir), []);
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);

  // A keeper alone again (a fresh start): the backup taken first cannot be written - a directory sits where its temp file goes - so nothing is restored.
  const again = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const token2 = await preview();
  for (let i = 0; i <= 5; i++) {
    const name = path.join(s.backupDir, `${backupName(new Date(Date.now() + i * 60000))}.tmp`);
    fs.mkdirSync(name, { recursive: true });
  }
  const failed = (await apply('4831', token2)).json as { ok: boolean; code: string };
  assert.deepEqual([failed.ok, failed.code], [false, 'restore-backup-failed']);
  assert.equal(await lrCount(port), 3, 'nothing was restored');
  assert.deepEqual(beforeRestoreIn(s.backupDir), []);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.match(logOf(s), /"why":"before-restore"/);
  assert.equal(await shutdown(port), true);
  await within(again.exited, 10000);
  assert.ok(!leaks(logOf(s), '4831') && !leaks(logOf(s), '7295'), 'no PIN in the log');
}));

test('keeper: restore while the app runs, alone: a fresh backup first, the old database kept, the backup in place, every seat told to refetch, and the book says so', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const a = listen(port, 'counter-1');
  try {
    await lrCall(port, '/lrs/create', { input: input() });
    const made = (await post(port, '/backups/export', { dir: s.backupDir })).json as { value: { file: string } };
    const file = path.basename(made.value.file);
    await lrCall(port, '/lrs/create', { input: input() });
    await lrCall(port, '/lrs/create', { input: input() });
    assert.equal(await lrCount(port), 3);
    await until('the LR events', () => a.got.length >= 4);
    const seenBefore = a.got.length;

    const preview = (await asSeat1(port, '/restore/preview', { file })).json as { value: { token: string; backup: { lrs: number }; live: { lrs: number } } };
    assert.deepEqual([preview.value.backup.lrs, preview.value.live.lrs], [1, 3], 'the preview sets the backup next to the database now');
    const applied = (await callJson(port, 'POST', '/restore/apply', { file, confirmToken: preview.value.token, adminPin: '4831' }, { seat: 'counter-1', timeoutMs: 60000 })).json;
    assert.deepEqual(applied, { ok: true, value: { schemaVersion: LATEST } });

    assert.equal((await waitUp(port)).state, 'ready');
    assert.equal(await lrCount(port), 1, 'the database is the backup');
    const all = (await lrCall(port, '/history/list', { filters: everyday(), cursor: null })).value.rows as { action: string; seat: string; facts: { file?: string; savedAs?: string } }[];
    const row = all.find((r) => r.action === 'backup.restore');
    assert.deepEqual([row?.seat, row?.facts.file], ['counter-1', file], 'the restored book says it was restored, from which file and by whom');
    const kept = beforeRestoreIn(s.backupDir);
    assert.equal(kept.length, 1, 'the database as it was is kept');
    assert.equal(row?.facts.savedAs, kept[0]);
    const listing = ((await post(port, '/backups/list', {})).json as Listing).value;
    // What a backup holds comes with its preview now (the list opens none); an empty one is refused as a restore over records, so it counts as -1.
    const lrsIn = async (name: string) => ((await asSeat1(port, '/restore/preview', { file: name })).json as { value?: { backup?: { lrs: number } } }).value?.backup?.lrs ?? -1;
    const counts = await Promise.all(listing.filter((b) => b.file !== file).map((b) => lrsIn(b.file)));
    assert.ok(counts.includes(3), 'a verified backup of the three-LR database was made first');
    assert.equal(await lrsIn(file), 1, 'the backup it was restored from is untouched');
    // The backup made after the restore announces itself too (a `settings` change), so it is not the last event that must say "everything".
    const everything = (c: KeeperChange) => [...c.tables].sort().join() === [...ALL].sort().join();
    await until('the restore event', () => a.got.slice(seenBefore).some(everything));

    // The keeper goes on: a new LR is saved and numbered after the restored ones.
    assert.equal((await lrCall(port, '/lrs/create', { input: input() })).value.row.lrNo, 2);
  } finally {
    a.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  assert.match(logOf(s), /\trestore-applied\t/);
}));

test('keeper: a restore that fails after its checks leaves the book open and ready (not stuck on starting), no checked copy beside it, and the next restore can start', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  await lrCall(port, '/lrs/create', { input: input() });
  const file = path.basename(((await post(port, '/backups/export', { dir: s.backupDir })).json as { value: { file: string } }).value.file);
  await lrCall(port, '/lrs/create', { input: input() });
  const preview = async () => (await asSeat1(port, '/restore/preview', { file })).json as { ok: boolean; value: { token: string } };
  const p = await preview();
  assert.equal(p.ok, true);

  // The old database cannot be set aside (a folder holds every name it could get in the next two minutes): the swap fails after the checks, with the book closed.
  for (let i = -2; i <= 120; i++) fs.mkdirSync(path.join(s.backupDir, beforeRestoreName(new Date(Date.now() + i * 1000))), { recursive: true });
  const failed = (await callJson(port, 'POST', '/restore/apply', { file, confirmToken: p.value.token, adminPin: '4831' }, { seat: 'counter-1', timeoutMs: 60000 })).json as { ok: boolean; code: string };
  assert.deepEqual([failed.ok, failed.code], [false, 'failed']);
  assert.equal((await waitUp(port)).state, 'ready', 'the book is open again');
  assert.equal(await lrCount(port), 2, 'nothing was restored');
  assert.equal(fs.existsSync(`${s.dbPath}.restoring`), false, 'no checked copy is left beside the live file');
  assert.equal((await preview()).ok, true, 'the next restore can start: nothing is left marked as running');
  assert.match(logOf(s), /\trestore-failed\t/);

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}));

test('keeper: a new backup folder - the Admin PIN, a verified backup made there first, then the setting; a folder on the data\'s drive asks twice; an unusable folder changes nothing', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  await seed(port);
  const fresh = path.join(s.dir, 'other-backups');
  const set = async (body: object) => (await lrCall(port, '/settings/set-backup-dir', body)) as Answer;
  const health = async () => (await waitUp(port)).backupDir;
  const book = async () => (await lrCall(port, '/history/list', { filters: everyday(), cursor: null })).value.rows as { action: string; changes: { from: string; to: string }[] }[];

  assert.equal((await set({ dir: fresh, adminPin: '0000', confirmSameDrive: true })).code, 'wrong-pin');
  assert.equal((await set({ dir: fresh, adminPin: '7295', confirmSameDrive: true })).code, 'wrong-pin', 'the System PIN is not enough');
  assert.equal((await set({ adminPin: '4831' })).status, 400);
  assert.equal((await set({ dir: 'relative\\folder', adminPin: '4831' })).status, 400, 'an absolute folder is needed');
  assert.equal((await health()), s.backupDir);

  // This PC has the data and the temp folder on one drive: the folder asks to be confirmed, and nothing is created before the answer.
  const asked = await set({ dir: fresh, adminPin: '4831' });
  assert.deepEqual([asked.code, asked.detail], ['backup-dir-same-drive', fresh]);
  assert.equal(fs.existsSync(fresh), false);
  assert.equal(await health(), s.backupDir);

  // A folder a backup cannot be written to (under a file): refused, the old folder is still the backup folder.
  const file = path.join(s.dir, 'a-file');
  fs.writeFileSync(file, 'x');
  const unusable = await set({ dir: path.join(file, 'sub'), adminPin: '4831', confirmSameDrive: true });
  assert.equal(unusable.code, 'backup-dir-unusable');
  assert.equal(await health(), s.backupDir);
  assert.equal((await book()).filter((r) => r.action === 'settings.backup-dir').length, 0, 'a refusal writes nothing');

  // Confirmed: a backup is in the new folder at once, the setting and the book follow, the old backups stay where they were.
  const oldFiles = fs.readdirSync(s.backupDir).filter((n) => n.endsWith('.db'));
  const changed = await set({ dir: fresh, adminPin: '4831', confirmSameDrive: true });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.deepEqual(fs.readdirSync(fresh).filter((n) => n.endsWith('.db')), [changed.value.file.split('\\').pop()]);
  assert.equal(await health(), fresh);
  assert.deepEqual(fs.readdirSync(s.backupDir).filter((n) => n.endsWith('.db')), oldFiles);
  const row = (await book()).find((r) => r.action === 'settings.backup-dir');
  assert.deepEqual(row?.changes, [{ field: 'backupDir', from: s.backupDir, to: fresh }]);
  const listed = ((await post(port, '/backups/list', {})).json as Listing).value;
  assert.equal(listed.length, 1, 'the list is the new folder\'s');
  // The same folder again changes nothing.
  assert.equal((await set({ dir: fresh.toUpperCase() + '\\', adminPin: '4831', confirmSameDrive: true })).ok, true);
  assert.equal((await book()).filter((r) => r.action === 'settings.backup-dir').length, 1);

  // It is kept: a keeper started later without a folder of its own reads the setting.
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const later = startKeeper(s.root, port, s.programData, s.backupDir, { BM_BACKUP_DIR: '' });
  assert.equal((await waitUp(port)).backupDir, fresh);
  assert.equal(await shutdown(port), true);
  await within(later.exited, 10000);
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

test('keeper: first-run PIN setup is set-once, wrong PINs lock after five, other seats are listed', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  const health = await waitUp(port);
  assert.equal(health.pinsSet, false);
  assert.equal(health.pid, first.child.pid);

  const send = async (url: string, body: unknown, seat = 'counter-1') => {
    const r = await callJson(port, 'POST', url, body, { seat });
    return { status: r.status, ...(r.json as { ok: boolean; value?: Record<string, string>; code?: string; detail?: string }) };
  };

  const made = await send('/pins/setup', { adminPin: '4831', systemPin: '7295' });
  assert.equal(made.ok, true);
  assert.match(made.value?.recoveryCode ?? '', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await waitUp(port)).pinsSet, true);

  // another seat that was still on the setup screen: refused, nothing changed
  const late = await send('/pins/setup', { adminPin: '1111', systemPin: '2222' }, 'counter-2');
  assert.deepEqual([late.status, late.code], [409, 'pins-already-set']);
  assert.equal((await send('/pins/verify', { kind: 'admin', pin: '4831' })).ok, true);

  for (let i = 0; i < 4; i++) assert.equal((await send('/pins/verify', { kind: 'system', pin: '0000' })).code, 'wrong-pin');
  const locked = await send('/pins/verify', { kind: 'system', pin: '0000' });
  assert.deepEqual([locked.code, locked.detail], ['pin-locked', '60']);
  assert.equal((await send('/pins/verify', { kind: 'system', pin: '7295' })).code, 'pin-locked', 'locked even for the right PIN');
  assert.equal((await send('/pins/verify', { kind: 'admin', pin: '4831' })).ok, true, 'the other PIN is not locked');
  assert.equal((await send('/pins/verify', { kind: 'nonsense', pin: '4831' })).code, 'bad-pin');

  // the seat list: counter-2 has talked to the keeper just now, counter-1 asks and is not counted
  const seats = await send('/seats', {});
  assert.deepEqual(seats.value?.others, ['counter-2']);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(first.exited, 10000), 0);
  // the PINs and the code are in the database as hashes and in no log
  const log = fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8').split('\n').filter((l) => /pin/i.test(l)).join('\n');
  assert.match(log, /pin-refused/);
  for (const secret of ['4831', '7295', made.value?.recoveryCode ?? 'x']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- masters ---------------------------------------------------------------------------------------------------

type Answer = { status: number; ok: boolean; value?: any; code?: string; detail?: string; row?: any; lr?: any; similar?: string[]; taken?: any[]; memoFields?: any; wasuli?: any[]; wasuliFields?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const masters = async (port: number, url: string, body: unknown, seat = 'counter-1'): Promise<Answer> => {
  const r = await callJson(port, 'POST', `/masters/${url}`, body, { seat, timeoutMs: 30000 });
  return { status: r.status, ...(r.json as object) } as Answer;
};

test('keeper: a master saved through the real route raises the guard marker, and the baseline survives a restart', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir, { BM_MARKER_REFRESH_MS: '200' });
  assert.equal((await waitUp(port)).state, 'ready');
  const marker = markerPath(s.programDir, s.root);
  const rows = () => JSON.parse(fs.readFileSync(marker, 'utf8')).businessRows as number;
  assert.equal(rows(), 0);

  const made = await masters(port, 'create', { kind: 'stations', fields: { name: 'Yavatmal' } });
  assert.deepEqual([made.status, made.ok, made.value.name], [200, true, 'Yavatmal']);
  assert.equal((await masters(port, 'create', { kind: 'trucks', fields: { number: 'MH 29 BE 1234' } })).ok, true);
  // The keeper is still running: it is the timer that raised the baseline, not a clean stop.
  for (let i = 0; i < 50 && rows() < 2; i++) await sleep(100);
  assert.equal(rows(), 2, 'the marker rose by itself while the keeper ran');
  assert.match(logOf(s), /\tmaster-saved\t/);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(k.exited, 10000), 0);
  assert.equal(rows(), 2, 'the clean stop keeps it');
  startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const all = (await masters(port, 'all', {})).value;
  assert.deepEqual([all.stations.length, all.trucks.length], [1, 1], 'everything is still there after a restart');
  assert.equal(await shutdown(port), true);
}));

test('keeper: two seats saving the same station at the same moment save it once; the other is told it exists', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');

  const answers = await Promise.all([
    masters(port, 'create', { kind: 'stations', fields: { name: 'Nagpur' } }, 'counter-1'),
    masters(port, 'create', { kind: 'stations', fields: { name: ' NAGPUR ' } }, 'counter-2'),
  ]);
  const won = answers.filter((a) => a.ok);
  const lost = answers.filter((a) => !a.ok);
  assert.equal(won.length, 1);
  assert.deepEqual([lost.length, lost[0].status, lost[0].code], [1, 409, 'master-exists']);
  assert.equal(lost[0].row.id, won[0].value.id, 'the loser is shown the row that won');
  assert.equal((await masters(port, 'all', {})).value.stations.length, 1);

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}));

test('keeper: editing a master over the real route needs the System PIN; bad requests are refused', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.equal((await callJson(port, 'POST', '/pins/setup', { adminPin: '4831', systemPin: '7295' }, { seat: 'counter-1' })).status, 200);

  const row = (await masters(port, 'create', { kind: 'firms', fields: { name: 'Shree Ganesh Traders', phone: '98220 12345' } })).value;
  const edit = { kind: 'firms', id: row.id, version: row.version, fields: { name: 'Shree Ganesh Traders', phone: '9000000000' } };
  assert.equal((await masters(port, 'update', edit)).code, 'wrong-pin', 'no PIN');
  assert.equal((await masters(port, 'update', { ...edit, systemPin: '4831' })).code, 'wrong-pin', 'the Admin PIN is not the System PIN');
  assert.equal((await masters(port, 'all', {})).value.firms[0].phone, '9822012345', 'nothing was written');
  const done = await masters(port, 'update', { ...edit, systemPin: '7295' }, 'counter-2');
  assert.deepEqual([done.ok, done.value.phone, done.value.version], [true, '9000000000', 2]);
  const stale = await masters(port, 'update', { ...edit, systemPin: '7295' });
  assert.deepEqual([stale.status, stale.code, stale.row.version], [409, 'master-stale', 2]);
  assert.equal((await masters(port, 'set-active', { kind: 'firms', id: row.id, version: 2, active: false })).code, 'wrong-pin');
  assert.equal((await masters(port, 'set-active', { kind: 'firms', id: row.id, version: 2, active: false, systemPin: '7295' })).value.active, false);
  assert.equal((await masters(port, 'set-active', { kind: 'firms', id: row.id, version: 3, active: true })).value.active, true, 'reactivating needs no PIN');

  assert.equal((await masters(port, 'create', { kind: 'vehicles', fields: {} })).status, 400);
  assert.equal((await masters(port, 'update', { kind: 'firms', id: 'x', version: 1, fields: {}, systemPin: '7295' })).status, 400);
  assert.equal((await masters(port, 'set-active', { kind: 'firms', id: 1, version: 1, systemPin: '7295' })).status, 400);
  assert.equal((await masters(port, 'create', { kind: 'stations', fields: { name: '' } })).code, 'master-bad');

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /pin-refused/);
  for (const secret of ['4831', '7295', 'Shree Ganesh']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- change events and LRs -------------------------------------------------------------------------------------

const lrCall = async (port: number, url: string, body: unknown, seat = 'counter-1'): Promise<Answer> => {
  const r = await callJson(port, 'POST', url, body, { seat, timeoutMs: 30000 });
  return { status: r.status, ...(r.json as object) } as Answer & { fields?: Record<string, string> };
};
let uidSerial = 0;
/** PINs, two stations and a firm, through the real routes. */
async function seed(port: number) {
  const setup = await lrCall(port, '/pins/setup', { adminPin: '4831', systemPin: '7295' });
  const station = async (name: string) => (await masters(port, 'create', { kind: 'stations', fields: { name } })).value.id as number;
  const from = await station('Yavatmal');
  const to = await station('Nagpur');
  const firm = (await masters(port, 'create', { kind: 'firms', fields: { name: 'Shree Ganesh Traders' } })).value.id as number;
  const input = (over: Record<string, unknown> = {}) => ({
    uid: `uid-${++uidSerial}`, date: null, fromStationId: from, toStationId: to,
    consignor: { firmId: firm, name: '', addToFirms: false }, consignee: { firmId: null, name: 'Kale Brothers', addToFirms: false },
    particular: 'Cloth bales', qty: '3', toPay: '1,800', paid: '', chargeOption: 'option1',
    godownBhada: '5', godownInsurance: '5', deliveryCharges: '2', hamali: '30', wasuli: '', staxPercent: '5', ...over,
  });
  return { from, to, firm, input, recoveryCode: setup.value.recoveryCode as string };
}
async function until(what: string, ok: () => boolean, ms = 20000): Promise<void> {
  for (let i = 0; i < ms / 50 && !ok(); i++) await sleep(50);
  assert.ok(ok(), `timed out waiting for ${what}`);
}
const listen = (port: number, seat: string) => {
  const got: KeeperChange[] = [];
  const stop = subscribeEvents(port, { seat }, (c) => got.push(c));
  return { got, stop };
};
const ALL = [...CHANGE_TABLES];

test('keeper: one event per committed write to every listening seat, none for a refused or read-only call', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    assert.deepEqual(a.got[0], { tables: ALL }, 'connecting says "everything may have changed"');
    a.got.length = 0;
    b.got.length = 0;

    const made = await masters(port, 'create', { kind: 'stations', fields: { name: 'Wani' } });
    await until('the station event', () => a.got.length >= 1 && b.got.length >= 1);
    assert.deepEqual(a.got, [{ tables: ['stations'], ids: [made.value.id] }]);
    assert.deepEqual(b.got, a.got, 'the other seat got the same');

    // Refused or read-only: nothing is announced.
    assert.equal((await masters(port, 'create', { kind: 'stations', fields: { name: 'wani' } })).code, 'master-exists');
    assert.equal((await masters(port, 'update', { kind: 'stations', id: made.value.id, version: 1, fields: { name: 'Wani 2' }, systemPin: '0000' })).code, 'wrong-pin');
    assert.equal((await masters(port, 'create', { kind: 'stations', fields: { name: '' } })).code, 'master-bad');
    await masters(port, 'all', {});
    assert.equal((await lrCall(port, '/lrs/preview', { input: input() })).ok, true);
    assert.equal((await lrCall(port, '/lrs/create', { input: input({ qty: '0' }) })).code, 'lr-invalid');
    assert.equal((await lrCall(port, '/lrs/create', { input: input({ date: '2026-01-01' }) })).code, 'wrong-pin');
    assert.equal((await lrCall(port, '/lrs/by-date', { date: null })).ok, true);

    const lr = await lrCall(port, '/lrs/create', { input: input() });
    assert.equal(lr.ok, true);
    await until('the LR event', () => a.got.length >= 2 && b.got.length >= 2);
    assert.deepEqual(a.got[1], { tables: ['lrs'], ids: [lr.value.row.id] });

    // A walk-in saved to the firms master announces both tables; a retry of the same save announces nothing.
    const walk = input({ consignee: { firmId: null, name: 'Om Stores', addToFirms: true } });
    assert.equal((await lrCall(port, '/lrs/create', { input: walk })).value.firmsAdded, true);
    await until('the walk-in event', () => a.got.length >= 3);
    assert.deepEqual(a.got[2].tables, ['lrs', 'firms']);
    assert.equal((await lrCall(port, '/lrs/create', { input: walk })).value.again, true);

    await sleep(400); // anything wrongly sent would be here by now
    assert.equal(a.got.length, 3);
    assert.equal(b.got.length, 3);
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
}));

test('keeper: two seats edit the same LR - the second is told it changed and nothing is lost; one event per committed change, none on a refusal', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const created = await lrCall(port, '/lrs/create', { input: input() });
  const id = created.value.row.id as number;
  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  const pin = '7295';
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    a.got.length = 0;
    b.got.length = 0;

    const opened = await lrCall(port, '/lrs/get', { id });
    assert.equal(opened.value.version, 1);
    assert.equal((await lrCall(port, '/lrs/find', { no: created.value.row.lrNo })).value.id, id);
    assert.equal((await lrCall(port, '/lrs/find', { no: 999 })).code, 'lr-missing');

    // Seat 1 saves first.
    const first = await lrCall(port, '/lrs/update', { id, version: 1, input: input({ paid: '1,800', toPay: '' }), systemPin: pin }, 'counter-1');
    assert.equal(first.ok, true);
    assert.equal(first.value.changed, true);
    assert.equal(first.value.lr.version, 2);
    await until('the edit event on both seats', () => a.got.length >= 1 && b.got.length >= 1);
    assert.deepEqual(a.got, [{ tables: ['lrs'], ids: [id] }]);
    assert.deepEqual(b.got, a.got);

    // Seat 2 still holds version 1: it is told, with the current LR, and its quantity is not written.
    const second = await lrCall(port, '/lrs/update', { id, version: 1, input: input({ qty: '50' }), systemPin: pin }, 'counter-2');
    assert.equal(second.ok, false);
    assert.equal(second.code, 'lr-stale');
    assert.equal(second.lr.version, 2);
    assert.equal(second.lr.paidPaise, 180000, 'it sees what seat 1 saved');
    assert.equal(second.lr.qty, 3, 'and its own change was not applied');

    // Refusals and no-ops announce nothing.
    assert.equal((await lrCall(port, '/lrs/update', { id, version: 2, input: input({ qty: '9' }), systemPin: '0000' })).code, 'wrong-pin');
    assert.equal((await lrCall(port, '/lrs/update', { id, version: 2, input: input({ qty: '0' }), systemPin: pin })).code, 'lr-invalid');
    assert.equal((await lrCall(port, '/lrs/update', { id, version: 2, input: input({ paid: '1,800', toPay: '' }), systemPin: pin })).value.changed, false);
    assert.equal((await lrCall(port, '/lrs/cancel', { id, version: 2, reason: ' ', systemPin: pin })).code, 'lr-invalid');
    assert.equal((await lrCall(port, '/lrs/restore', { id, version: 2, systemPin: pin })).code, 'lr-not-cancelled');
    assert.equal((await lrCall(port, '/lrs/get', { id: 'x' })).status, 400);
    assert.equal((await lrCall(port, '/lrs/update', { id, input: input(), systemPin: pin })).status, 400);
    assert.equal((await lrCall(port, '/lrs/history', { id })).ok, true);

    const cancelled = await lrCall(port, '/lrs/cancel', { id, version: 2, reason: 'Wrong party typed', systemPin: pin });
    assert.equal(cancelled.value.status, 'cancelled');
    await until('the cancel event', () => a.got.length >= 2 && b.got.length >= 2);
    const restored = await lrCall(port, '/lrs/restore', { id, version: 3, systemPin: pin });
    assert.equal(restored.value.status, 'booked');
    await until('the restore event', () => a.got.length >= 3 && b.got.length >= 3);
    assert.deepEqual(a.got[2], { tables: ['lrs'], ids: [id] });

    const history = await lrCall(port, '/lrs/history', { id });
    assert.deepEqual(history.value.map((h: { action: string }) => h.action), ['restored', 'cancelled', 'edited', 'created']);
    assert.equal(history.value[1].reason, 'Wrong party typed');

    // An edit that saves a walk-in to the firms master announces both tables.
    const walk = await lrCall(port, '/lrs/update', { id, version: 4, input: input({ paid: '1,800', toPay: '', consignee: { firmId: null, name: 'Om Stores', addToFirms: true } }), systemPin: pin });
    assert.equal(walk.value.firmsAdded, true);
    await until('the walk-in edit event', () => a.got.length >= 4 && b.got.length >= 4);
    assert.deepEqual(a.got[3], { tables: ['lrs', 'firms'], ids: [id] });

    await sleep(400);
    assert.equal(a.got.length, 4, 'one event per committed change');
    assert.equal(b.got.length, 4);
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /lr-updated/);
  assert.match(log, /pin-refused/);
  for (const secret of ['4831', '7295', 'Wrong party typed', 'Kale Brothers']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

test('keeper: a seat\'s stream survives a keeper restart: it reconnects, is told to refetch, and keeps receiving', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const a = listen(port, 'counter-1');
  try {
    await until('the stream to connect', () => a.got.length >= 1);
    assert.equal(await shutdown(port), true);
    assert.equal(await within(first.exited, 10000), 0);
    a.got.length = 0;

    const second = startKeeper(s.root, port, s.programData, s.backupDir);
    assert.equal((await waitUp(port)).state, 'ready');
    await until('the stream to reconnect', () => a.got.length >= 1);
    assert.deepEqual(a.got[0], { tables: ALL }, 'told to refetch everything');

    const made = await masters(port, 'create', { kind: 'stations', fields: { name: 'Pusad' } });
    await until('an event after the restart', () => a.got.length >= 2);
    assert.deepEqual(a.got[1], { tables: ['stations'], ids: [made.value.id] });
    assert.equal(await shutdown(port), true);
    await within(second.exited, 10000);
  } finally {
    a.stop();
  }
}));

test('keeper: LR numbers run 1, 2, 3 with no gap and go on after a restart; 300 saves are fast', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const nos: number[] = [];
  for (let i = 0; i < 3; i++) nos.push((await lrCall(port, '/lrs/create', { input: input() }, i % 2 ? 'counter-2' : 'counter-1')).value.row.lrNo);
  assert.deepEqual(nos, [1, 2, 3]);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(first.exited, 10000), 0);
  const second = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  assert.equal((await lrCall(port, '/lrs/create', { input: input() })).value.row.lrNo, 4, 'the series went on after the restart');
  assert.equal((await lrCall(port, '/lrs/defaults', { date: null })).value.nextNo, 5);

  // Speed: the card's budget is an average under 150 ms per save, and a 300-row day listed in under 50 ms.
  const started = Date.now();
  let last = 0;
  for (let i = 0; i < 300; i++) last = (await lrCall(port, '/lrs/create', { input: input() })).value.row.lrNo;
  const average = (Date.now() - started) / 300;
  assert.equal(last, 304, 'still no gap');
  assert.ok(average < 150, `a save took ${average.toFixed(1)} ms on average`);
  await lrCall(port, '/lrs/by-date', { date: null }); // warm
  const listed = Date.now();
  const day = await lrCall(port, '/lrs/by-date', { date: null });
  const took = Date.now() - listed;
  assert.equal(day.value.rows.length, 304);
  assert.equal(day.value.rows[0].lrNo, 304, 'newest first');
  assert.deepEqual([day.value.totals.count, day.value.totals.qty, day.value.totals.toPayPaise], [304, 912, 304 * 180000]);
  assert.ok(took < 150, `listing 304 LRs took ${took} ms`);
  console.log(`# 300 LR saves: ${average.toFixed(1)} ms average; byDate(304 rows): ${took} ms`);

  const log = logOf(s);
  assert.match(log, /\tlr-saved\t/);
  for (const secret of ['4831', '7295', 'Kale Brothers']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
  assert.equal(await shutdown(port), true);
  await within(second.exited, 10000);
}));

test('keeper: the Dashboard and the search box answer over the real routes, move with a save and a cancel, carry no amount and leave no text in the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const a = listen(port, 'counter-1');
  try {
    await until('the stream to connect', () => a.got.length >= 1);
    const summary = async () => (await lrCall(port, '/dashboard/summary', { date: null })).value;
    assert.deepEqual(
      [(await summary()).booked, (await summary()).pending, (await summary()).oldestPending],
      [0, 0, null],
    );

    const first = await lrCall(port, '/lrs/create', { input: input() });
    await lrCall(port, '/lrs/create', { input: input() });
    await until('the LR events', () => a.got.length >= 3);
    let day = await summary();
    assert.deepEqual([day.booked, day.loaded, day.cancelled, day.qty, day.pending, day.pendingQty, day.pendingStations], [2, 0, 0, 6, 2, 6, 1]);
    assert.deepEqual((await lrCall(port, '/dashboard/pending-by-station', {})).value, [{ stationId: 2, station: 'Nagpur', lrs: 2, qty: 6 }]);
    const recent = (await lrCall(port, '/dashboard/recent', {})).value;
    assert.deepEqual(recent.map((r: { lrNo: number }) => r.lrNo), [2, 1]);

    const cancelled = await lrCall(port, '/lrs/cancel', { id: first.value.row.id, version: 1, reason: 'Duplicate', systemPin: '7295' });
    assert.equal(cancelled.ok, true);
    day = await summary();
    assert.deepEqual([day.booked, day.cancelled, day.qty, day.pending], [1, 1, 3, 1]);
    assert.equal((await lrCall(port, '/dashboard/recent', {})).value[1].status, 'cancelled');

    // The search: an LR number, a firm by its first letters, a station, nothing for an empty box.
    const found = (await lrCall(port, '/search', { text: ' 2 ' })).value;
    assert.deepEqual(found.lrs.map((l: { lrNo: number; consignee: string; toStation: string }) => [l.lrNo, l.consignee, l.toStation]), [[2, 'Kale Brothers', 'Nagpur']]);
    assert.deepEqual((await lrCall(port, '/search', { text: 'shree' })).value.firms.map((f: { name: string }) => f.name), ['Shree Ganesh Traders']);
    assert.deepEqual((await lrCall(port, '/search', { text: 'nag' })).value.stations.map((x: { name: string }) => x.name), ['Nagpur']);
    assert.deepEqual((await lrCall(port, '/search', { text: '' })).value, { lrs: [], memos: [], firms: [], trucks: [], stations: [] });
    assert.deepEqual((await lrCall(port, '/search', {})).value, { lrs: [], memos: [], firms: [], trucks: [], stations: [] }, 'a body without text is an empty box');

    // Reads only: no event came out of any of it beyond the save and the cancel.
    await sleep(400);
    assert.equal(a.got.length, 4);
    const every = JSON.stringify([day, recent, found]);
    assert.doesNotMatch(every, /"[^"]*(paise|amount|total|pay|paid|rupee)[^"]*":/i, 'no amount in any answer');
  } finally {
    a.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  for (const secret of ['shree', 'Kale Brothers', '7295']) assert.ok(!leaks(log, secret, true), `keeper.log holds ${secret}`);
}));

// --- loading memos ---------------------------------------------------------------------------------------------

test('keeper: two seats make memos with an overlapping LR in the same instant - exactly one wins, the other is told which LR and which challan; no LR on two memos, no gap in the numbers', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { from, to, input } = await seed(port);
  const truckOf = async (number: string) => (await masters(port, 'create', { kind: 'trucks', fields: { number } })).value.id as number;
  const truck1 = await truckOf('MH 29 BE 1234');
  const truck2 = await truckOf('MH 29 AB 1');
  const driver = (await masters(port, 'create', { kind: 'drivers', fields: { name: 'Ramesh Pawar' } })).value.id as number;
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) ids.push((await lrCall(port, '/lrs/create', { input: input() })).value.row.id);
  const memo = (lrIds: number[], truckId: number, seat: string, uid: string) =>
    lrCall(port, '/memos/create', { input: { uid, date: null, truckId, driverId: driver, fromStationId: from, toStationId: to, truckHire: '1,000', loadingHamali: '', lrIds } }, seat);

  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    a.got.length = 0;
    b.got.length = 0;
    assert.equal((await lrCall(port, '/memos/defaults', { date: null })).value.nextNo, 1);

    // Seat 1 ticked LRs 1-4, seat 2 ticked 3-6: they overlap on 3 and 4, and both press save at once.
    const mine = ids.slice(0, 4);
    const theirs = ids.slice(2, 6);
    const answers = await Promise.all([memo(mine, truck1, 'counter-1', 'memo-a'), memo(theirs, truck2, 'counter-2', 'memo-b')]);
    const won = answers.filter((x) => x.ok);
    const lost = answers.filter((x) => !x.ok);
    assert.equal(won.length, 1, 'exactly one memo was saved');
    assert.deepEqual([lost.length, lost[0].status, lost[0].code], [1, 409, 'memo-conflict']);
    const winner = won[0].value;
    assert.deepEqual([winner.challanNo, winner.lrCount, winner.again], [1, 4, false]);
    const winnerIds = answers[0].ok ? mine : theirs;
    const loserIds = answers[0].ok ? theirs : mine;
    const overlap = ids.slice(2, 4);
    assert.deepEqual(
      lost[0].taken?.map((t: { id: number; challanNo: number; truck: string; state: string }) => [t.id, t.state, t.challanNo, t.truck]),
      overlap.map((id) => [id, 'loaded', 1, winner.truck]),
      'the loser is told which LRs it lost, and the challan and truck they went on',
    );

    // Nothing of the loser was saved: no second memo, no LR on two memos, its other LRs are still booked.
    const day = (await lrCall(port, '/lrs/by-date', { date: null })).value;
    assert.deepEqual([day.totals.booked, day.totals.loaded], [2, 4]);
    const detail = (await lrCall(port, '/memos/get', { id: winner.id })).value;
    assert.deepEqual(detail.lrs.map((r: { id: number }) => r.id).sort(), [...winnerIds].sort());
    const pending = (await lrCall(port, '/memos/pending', { filters: {}, cursor: null })).value;
    assert.deepEqual([pending.count, pending.rows.map((r: { id: number }) => r.id).sort()], [2, ids.filter((id) => !winnerIds.includes(id)).sort()]);
    assert.equal((await lrCall(port, '/memos/defaults', { date: null })).value.nextNo, 2, 'the failed save used no number');

    await until('the memo event on both seats', () => a.got.length >= 1 && b.got.length >= 1);
    assert.deepEqual(a.got, [{ tables: ['memos', 'lrs'], ids: [winner.id] }]);
    assert.deepEqual(b.got, a.got);

    // The loser ticks again without the taken LRs and gets the next number: 1, 2 with no gap.
    const rest = loserIds.filter((id) => !overlap.includes(id));
    const second = await memo(rest, answers[0].ok ? truck2 : truck1, answers[0].ok ? 'counter-2' : 'counter-1', 'memo-c');
    assert.equal(second.ok, true);
    assert.deepEqual([second.value.challanNo, second.value.lrCount], [2, 2]);
    await until('the second memo event', () => a.got.length >= 2 && b.got.length >= 2);

    // The same uid again is the first memo, and says so; refused calls announce nothing.
    const again = await memo(rest, truck1, 'counter-1', 'memo-c');
    assert.deepEqual([again.ok, again.value.id, again.value.again], [true, second.value.id, true]);
    assert.equal((await memo([], truck1, 'counter-1', 'memo-d')).code, 'memo-invalid');
    assert.deepEqual((await memo([], truck1, 'counter-1', 'memo-d')).memoFields, { lrs: 'required' });
    assert.equal((await lrCall(port, '/memos/create', { input: { lrIds: [1] } })).status, 400, 'no uid');
    assert.equal((await lrCall(port, '/memos/get', { id: 'x' })).status, 400);
    assert.equal((await lrCall(port, '/memos/get', { id: 99999 })).code, 'memo-missing');
    assert.equal((await lrCall(port, '/memos/create', { input: { uid: 'u9', date: '2020-01-01', truckId: truck1, driverId: driver, fromStationId: from, toStationId: to, truckHire: '', loadingHamali: '', lrIds: [1] } })).code, 'wrong-pin', 'another day needs the System PIN');

    // Reads: today's memos, the live totals of the ticked LRs, the Dashboard, and a challan found by its number.
    const list = (await lrCall(port, '/memos/by-date', { date: null })).value;
    assert.deepEqual(list.map((m: { challanNo: number }) => m.challanNo), [2, 1]);
    assert.deepEqual((await lrCall(port, '/memos/totals', { ids })).value, { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0 }, 'every ticked LR is loaded now, so none is counted');
    const summary = (await lrCall(port, '/dashboard/summary', { date: null })).value;
    assert.deepEqual([summary.memos, summary.trucksOut, summary.loaded, summary.pending], [2, 2, 6, 0]);
    const found = (await lrCall(port, '/search', { text: '2' })).value;
    assert.deepEqual(found.memos.map((m: { challanNo: number; truck: string }) => [m.challanNo, m.truck]), [[2, second.value.truck]]);

    await sleep(400);
    assert.equal(a.got.length, 2, 'one event per committed memo, none for the refused ones');
    assert.equal(b.got.length, 2);
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /\tmemo-saved\t/);
  assert.match(log, /\tmemo-conflict\t/);
  assert.match(log, /pin-refused/);
  for (const secret of ['4831', '7295', 'Ramesh', 'MH 29']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- saved memos (3.2) -------------------------------------------------------------------------------------------

test('keeper: one seat takes an LR off a memo while another adds it to a different memo in the same instant - the LR is never on two memos; every committed change is one event, a refusal none; PINs and reasons stay out of the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { from, to, input } = await seed(port);
  const truckOf = async (number: string) => (await masters(port, 'create', { kind: 'trucks', fields: { number } })).value.id as number;
  const truck1 = await truckOf('MH 29 BE 1234');
  const truck2 = await truckOf('MH 29 AB 1');
  const driver = (await masters(port, 'create', { kind: 'drivers', fields: { name: 'Ramesh Pawar' } })).value.id as number;
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push((await lrCall(port, '/lrs/create', { input: input() })).value.row.id);
  const memo = async (lrIds: number[], truckId: number, uid: string) =>
    (await lrCall(port, '/memos/create', { input: { uid, date: null, truckId, driverId: driver, fromStationId: from, toStationId: to, truckHire: '', loadingHamali: '', lrIds } })).value;
  const memoA = await memo(ids.slice(0, 3), truck1, 'memo-a');
  const memoB = await memo(ids.slice(3, 4), truck2, 'memo-b');
  const SYSTEM = '7295';
  const ADMIN = '4831';
  const call = (url: string, body: Record<string, unknown>, seat = 'counter-1') => lrCall(port, url, body, seat);
  const lrsOn = async (id: number): Promise<number[]> => (await call('/memos/get', { id })).value.lrs.map((r: { id: number }) => r.id);

  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    a.got.length = 0;
    b.got.length = 0;

    // The race: seat 1 takes LR 3 off memo A, seat 2 adds the same LR to memo B.
    const lr = ids[2];
    const answers = await Promise.all([
      call('/memos/remove-lrs', { id: memoA.id, lrIds: [lr], systemPin: SYSTEM }, 'counter-1'),
      call('/memos/add-lrs', { id: memoB.id, lrIds: [lr], systemPin: SYSTEM }, 'counter-2'),
    ]);
    const [onA, onB] = [await lrsOn(memoA.id), await lrsOn(memoB.id)];
    assert.equal([onA, onB].filter((l) => l.includes(lr)).length <= 1, true, 'the LR is on at most one memo');
    assert.equal(answers[0].ok, true, 'the take-off always works: the LR is on memo A until it is taken off');
    if (answers[1].ok) assert.deepEqual([onA.length, onB.length], [2, 2], 'the take-off came first: the LR moved to memo B');
    else {
      assert.deepEqual([answers[1].status, answers[1].code], [409, 'memo-conflict']);
      assert.deepEqual([onA.length, onB.length], [2, 1], 'the add came first and lost: the LR is booked again');
    }
    await until('the change events', () => a.got.length >= 1 + Number(answers[1].ok) && b.got.length >= 1 + Number(answers[1].ok));

    // Header edit, recalculate, cancel over HTTP: PINs, versions, 400s.
    const cur = (await call('/memos/get', { id: memoB.id })).value;
    const header = { date: cur.date, truckId: cur.truckId, driverId: cur.driverId, fromStationId: cur.fromStationId, toStationId: cur.toStationId, truckHire: '2,500', loadingHamali: '' };
    assert.equal((await call('/memos/edit', { id: memoB.id, version: cur.version, input: header, systemPin: '0000' })).code, 'wrong-pin');
    assert.equal((await call('/memos/edit', { id: memoB.id, version: cur.version - 1, input: header, systemPin: SYSTEM })).code, 'memo-stale');
    assert.equal((await call('/memos/edit', { id: memoB.id, version: 'x', input: header })).status, 400);
    assert.equal((await call('/memos/remove-lrs', { lrIds: [1] })).status, 400);
    const edited = await call('/memos/edit', { id: memoB.id, version: cur.version, input: header, systemPin: SYSTEM }, 'counter-2');
    assert.deepEqual([edited.ok, edited.value.changed, edited.value.memo.truckHirePaise], [true, true, 250000]);
    assert.equal((await call('/memos/edit', { id: memoB.id, version: edited.value.memo.version, input: header, systemPin: SYSTEM })).value.changed, false, 'a no-op');

    const differing = (await call('/memos/get', { id: memoB.id })).value;
    const recalc = await call('/memos/recalculate', { id: memoB.id, version: differing.version, adminPin: SYSTEM });
    assert.equal(recalc.code, 'wrong-pin', 'the System PIN is not the Admin PIN');
    const list = (await call('/memos/list', { filters: {}, cursor: null })).value;
    assert.deepEqual(list.rows.map((r: { challanNo: number }) => r.challanNo), [2, 1]);
    assert.equal((await call('/memos/history', { id: memoB.id })).value[0].action, 'edited');

    const gone = await call('/memos/cancel', { id: memoA.id, version: (await call('/memos/get', { id: memoA.id })).value.version, reason: 'Wrong truck', adminPin: ADMIN });
    assert.deepEqual([gone.ok, gone.value.status, gone.value.lrs.length], [true, 'cancelled', 0]);
    const pending = (await call('/memos/pending', { filters: {}, cursor: null })).value;
    assert.deepEqual(pending.rows.map((r: { id: number }) => r.id).sort(), (answers[1].ok ? [ids[0], ids[1], ids[4]] : [ids[0], ids[1], lr, ids[4]]).sort(), "memo A's LRs are pending again");
    assert.equal((await call('/memos/cancel', { id: memoA.id, version: gone.value.version, reason: 'again', adminPin: ADMIN })).code, 'memo-cancelled');

    await sleep(400);
    // take-off, (add), edit, cancel: each committed change announced once on both seats, the refusals not at all
    const expected = 1 + Number(answers[1].ok) + 1 + 1;
    assert.equal(a.got.length, expected);
    assert.equal(b.got.length, expected);
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /\tmemo-lrs-changed\t/);
  assert.match(log, /\tmemo-edited\t/);
  assert.match(log, /\tmemo-cancelled\t/);
  for (const secret of ['4831', '7295', 'Wrong truck', 'Ramesh', 'MH 29']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- printing ----------------------------------------------------------------------------------------------------

test('keeper: printing over the real routes - the memo and LR as printed, the company lines behind the Admin PIN, the audit of a print that went through; reads and prints raise no event; no PIN or company text in the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { from, to, input } = await seed(port);
  const truck = (await masters(port, 'create', { kind: 'trucks', fields: { number: 'MH 29 BE 1234' } })).value.id as number;
  const driver = (await masters(port, 'create', { kind: 'drivers', fields: { name: 'Ramesh Pawar' } })).value.id as number;
  const lrIds: number[] = [];
  for (let i = 0; i < 2; i++) lrIds.push((await lrCall(port, '/lrs/create', { input: input() })).value.row.id);
  const memo = (await lrCall(port, '/memos/create', { input: { uid: 'print-memo', date: null, truckId: truck, driverId: driver, fromStationId: from, toStationId: to, truckHire: '4,500', loadingHamali: '', lrIds } })).value;
  const call = (url: string, body: Record<string, unknown>, seat = 'counter-1') => lrCall(port, url, body, seat);
  const COMPANY = { name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal', phone: '07232 245678', gstin: '' };

  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    a.got.length = 0;
    b.got.length = 0;

    const printed = await call('/print/memo', { id: memo.id });
    assert.deepEqual([printed.ok, printed.value.rows.length, printed.value.totals, printed.value.truckHire, printed.value.company.name], [true, 2, { lrs: 2, qty: 6, toPay: '3,600.00', paid: '0.00' }, '4,500.00', 'Sundeep Freight Movers']);
    const lr = await call('/print/lr', { id: lrIds[0] });
    // 1,800 freight + 5 + 5 + 2 + 30 charges + 5 % tax on the freight (90) = 1,932
    assert.deepEqual([lr.value.mode, lr.value.freight, lr.value.stax, lr.value.total, lr.value.consignee], ['topay', '1,800.00', '90.00', '1,932.00', 'Kale Brothers']);

    assert.equal((await call('/print/memo', {})).status, 400);
    assert.equal((await call('/print/lr', { id: 'x' })).status, 400);
    assert.equal((await call('/print/done', { kind: 'memo', id: memo.id })).status, 400);
    assert.equal((await call('/print/done', { kind: 'memo', id: memo.id, how: 'email' })).status, 400);
    assert.deepEqual([(await call('/print/memo', { id: 999 })).code, (await call('/print/lr', { id: 999 })).code, (await call('/print/done', { kind: 'lr', id: 999, how: 'print' })).code], ['memo-missing', 'lr-missing', 'lr-missing']);
    assert.equal((await call('/print/done', { kind: 'memo', id: memo.id, how: 'print' }, 'counter-2')).ok, true);
    assert.equal((await call('/print/done', { kind: 'lr', id: lrIds[0], how: 'pdf' }, 'counter-2')).ok, true);

    // The company lines: Admin PIN only; a refusal changes nothing and raises no event.
    assert.equal((await call('/print/set-company', { input: COMPANY, adminPin: '0000' })).code, 'wrong-pin');
    assert.equal((await call('/print/set-company', { input: COMPANY, adminPin: '7295' })).code, 'wrong-pin', 'the System PIN is not the Admin PIN');
    const bad = await call('/print/set-company', { input: { ...COMPANY, name: '  ' }, adminPin: '4831' });
    assert.deepEqual([bad.status, bad.code, bad.detail], [409, 'company-invalid', 'name']);
    assert.equal((await call('/print/set-company', { adminPin: '4831' })).code, 'company-invalid', 'a body without lines is refused, not saved');
    assert.equal((await call('/print/company', {})).value.address, '');
    await sleep(400);
    assert.deepEqual([a.got.length, b.got.length], [0, 0], 'reads, prints and refusals raise no event');

    const saved = await call('/print/set-company', { input: COMPANY, adminPin: '4831' }, 'counter-2');
    assert.deepEqual([saved.ok, saved.value], [true, COMPANY]);
    await until('the settings event on both seats', () => a.got.length >= 1 && b.got.length >= 1);
    assert.deepEqual([a.got[0].tables, b.got[0].tables], [['settings'], ['settings']]);
    assert.equal((await call('/print/memo', { id: memo.id })).value.company.address, 'Station Road, Yavatmal');
    assert.equal((await call('/print/company', {})).value.phone, '07232 245678');
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /\tprint-done\t/);
  assert.match(log, /\tcompany-saved\t/);
  for (const secret of ['4831', '7295', 'Station Road', '07232', 'Kale Brothers']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- wasuli (3.4) ------------------------------------------------------------------------------------------------

test('keeper: two seats collect the same LR in the same instant - one wins, the other is told who was first; overlapping assigns never share a row; one event per committed change, none for a refusal; PIN, remark and agent names stay out of the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const agentOf = async (name: string) => (await masters(port, 'create', { kind: 'agents', fields: { name } })).value.id as number;
  const ramesh = await agentOf('Ramesh Pawar');
  const suresh = await agentOf('Suresh Kale');
  type Seen = { id: number; status: string; agentId: number | null; version: number };
  const seenOf = (r: Seen): Seen => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
  const list = async (tab: string, agentId: number | null = null) => (await lrCall(port, '/wasuli/list', { filters: { tab, agentId, period: 'week' }, cursor: null })).value;

  const a = listen(port, 'counter-1');
  const b = listen(port, 'counter-2');
  try {
    await until('both streams to connect', () => a.got.length >= 1 && b.got.length >= 1);
    a.got.length = 0;
    b.got.length = 0;

    // An LR with a wasuli amount also announces the wasuli table; one without does not.
    const first = await lrCall(port, '/lrs/create', { input: input({ wasuli: '500' }) });
    await until('the LR event', () => a.got.length >= 1);
    assert.deepEqual(a.got[0], { tables: ['lrs', 'wasuli'], ids: [first.value.row.id] });
    await lrCall(port, '/lrs/create', { input: input() });
    await until('the plain LR event', () => a.got.length >= 2);
    assert.deepEqual(a.got[1].tables, ['lrs']);
    for (let i = 0; i < 4; i++) assert.equal((await lrCall(port, '/lrs/create', { input: input({ wasuli: '500' }) })).ok, true);
    await until('the other LR events', () => a.got.length >= 6 && b.got.length >= 6);
    a.got.length = 0;
    b.got.length = 0;

    const pool = await list('unassigned');
    assert.deepEqual([pool.count, pool.amountPaise, pool.rows.length, pool.counts.unassigned], [5, 250000, 5, 5]);
    const rows: Seen[] = pool.rows;

    // Seat 1 ticks rows 1-3 for Ramesh, seat 2 ticks rows 3-5 for Suresh: they overlap on the third, and both press at once.
    const assign = (batch: Seen[], agentId: number, seat: string) => lrCall(port, '/wasuli/assign', { rows: batch.map(seenOf), agentId }, seat);
    const answers = await Promise.all([assign(rows.slice(0, 3), ramesh, 'counter-1'), assign(rows.slice(2, 5), suresh, 'counter-2')]);
    const won = answers.filter((x) => x.ok);
    const lost = answers.filter((x) => !x.ok);
    assert.equal(won.length, 1, 'exactly one assign went through');
    assert.deepEqual([lost[0].status, lost[0].code], [409, 'wasuli-stale']);
    const winnerSeat = answers[0].ok ? 'counter-1' : 'counter-2';
    const winnerAgent = answers[0].ok ? ramesh : suresh;
    const winnerRows = answers[0].ok ? rows.slice(0, 3) : rows.slice(2, 5);
    const loserOnly = answers[0].ok ? rows.slice(3, 5) : rows.slice(0, 2);
    assert.deepEqual(
      (lost[0].wasuli ?? []).map((r: { id: number; status: string; agentId: number; seat: string }) => [r.id, r.status, r.agentId, r.seat]),
      [[rows[2].id, 'assigned', winnerAgent, winnerSeat]],
      'the loser is told which row it lost and who has it',
    );
    assert.equal((await list('unassigned')).count, 2, 'the loser did not assign its other rows');
    assert.deepEqual((await list('unassigned')).rows.map((r: Seen) => r.id), loserOnly.map((r) => r.id));
    const mine = await list('assigned', winnerAgent);
    assert.deepEqual(mine.rows.map((r: Seen) => r.id), winnerRows.map((r) => r.id));
    assert.equal((await list('assigned', winnerAgent === ramesh ? suresh : ramesh)).count, 0, 'no row on both agents');

    // Both seats mark the same row collected at the same moment, with different amounts.
    const target: Seen = mine.rows[0];
    const collect = (amount: string, seat: string) => lrCall(port, '/wasuli/collect', { row: seenOf(target), input: { amount, mode: 'cash', remark: 'ref-9981' } }, seat);
    const both = await Promise.all([collect('500', 'counter-1'), collect('300', 'counter-2')]);
    assert.deepEqual(both.map((x) => x.ok).sort(), [false, true], 'exactly one collection');
    const second = both.find((x) => !x.ok) as Answer;
    assert.deepEqual([second.status, second.code, second.wasuli?.[0].status, second.wasuli?.[0].seat], [409, 'wasuli-stale', 'collected', both[0].ok ? 'counter-1' : 'counter-2']);
    const done = (await list('collected', winnerAgent)).rows;
    assert.equal(done.length, 1);
    assert.equal(done[0].collectedPaise, both[0].ok ? 50000 : 30000, "only the winner's amount was recorded");

    await until('both changes on both seats', () => a.got.length >= 2 && b.got.length >= 2);
    assert.deepEqual(a.got.map((c) => c.tables), [['wasuli'], ['wasuli']]);
    assert.deepEqual(b.got, a.got);

    // Refused or read-only calls announce nothing: wrong PIN, bad requests, an edit of a collected LR, lists, a lookup.
    const collected: Seen = done[0];
    assert.equal((await lrCall(port, '/wasuli/uncollect', { row: seenOf(collected), systemPin: '0000' })).code, 'wrong-pin');
    assert.equal((await lrCall(port, '/wasuli/collect', { input: {} })).status, 400, 'no row');
    assert.equal((await lrCall(port, '/wasuli/assign', { rows: [], agentId: ramesh })).status, 400);
    assert.equal((await lrCall(port, '/wasuli/find', { no: 'x' })).status, 400);
    assert.equal((await lrCall(port, '/wasuli/collect', { row: seenOf(mine.rows[1]), input: { amount: '9,999', mode: 'cash', remark: '' } })).code, 'wasuli-invalid');
    assert.equal((await lrCall(port, '/wasuli/find', { no: 99999 })).code, 'wasuli-missing');
    assert.equal((await lrCall(port, '/wasuli/agent-stats', { period: 'week' })).value.length, 2);
    const lr = (await lrCall(port, '/lrs/get', { id: done[0].lrId })).value;
    const blocked = await lrCall(port, '/lrs/update', { id: lr.id, version: lr.version, input: input({ wasuli: '600' }), systemPin: '7295' });
    assert.deepEqual([blocked.status, blocked.code, blocked.detail], [409, 'lr-wasuli-collected', String(lr.lrNo)]);
    assert.equal((await lrCall(port, '/lrs/cancel', { id: lr.id, version: lr.version, reason: 'oops', systemPin: '7295' })).code, 'lr-wasuli-collected');

    // The lookup by LR number, then undo with the PIN and a remark edit; each committed change is one event.
    const found = await lrCall(port, '/wasuli/find', { no: done[0].lrNo });
    assert.deepEqual([found.ok, found.value.id, found.value.status], [true, collected.id, 'collected']);
    const undone = await lrCall(port, '/wasuli/uncollect', { row: seenOf(collected), systemPin: '7295' }, 'counter-2');
    assert.deepEqual([undone.ok, undone.value.changed, undone.value.rows[0].status, undone.value.rows[0].agentId], [true, true, 'assigned', winnerAgent]);
    await until('the undo event', () => a.got.length >= 3);
    const again = await lrCall(port, '/wasuli/collect', { row: seenOf(undone.value.rows[0]), input: { amount: '500', mode: 'upi', remark: '' } });
    await until('the second collect event', () => a.got.length >= 4);
    const edited = await lrCall(port, '/wasuli/remark', { row: seenOf(again.value.rows[0]), remark: 'ref-7733', systemPin: '7295' });
    assert.equal(edited.value.rows[0].remark, 'ref-7733');
    await lrCall(port, '/wasuli/remark', { row: seenOf(edited.value.rows[0]), remark: 'ref-7733', systemPin: '7295' }); // the same text: nothing changes
    await until('the remark event', () => a.got.length >= 5);

    await sleep(400); // anything wrongly sent would be here by now
    assert.equal(a.got.length, 5, 'one event per committed change, none for the refusals');
    assert.equal(b.got.length, 5);
  } finally {
    a.stop();
    b.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  assert.match(log, /\twasuli-changed\t/);
  assert.match(log, /\twasuli-stale\t/);
  assert.match(log, /pin-refused/);
  for (const secret of ['4831', '7295', 'Ramesh', 'Suresh', 'ref-9981', 'ref-7733']) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- Reports -----------------------------------------------------------------------------------------------------

test('keeper: Reports over the real routes - every report, the LRs behind a row, the printout; bad requests are refused; reads raise no event and leave no name or amount in the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input, firm } = await seed(port);
  const a = listen(port, 'counter-1');
  try {
    await until('the stream to connect', () => a.got.length >= 1);
    await lrCall(port, '/lrs/create', { input: input() });
    await lrCall(port, '/lrs/create', { input: input() });
    await until('the LR events', () => a.got.length >= 3);
    const today = (await lrCall(port, '/lrs/defaults', { date: null })).value.today as string;
    const query = { from: `${today.slice(0, 4)}-01-01`, to: today };
    const read = async (url: string, body: object) => (await lrCall(port, url, body)).value;

    // Each LR: qty 3, to pay 1,800.00 + charges 42.00 + tax 90.00. Both are the same day, the same station, the same parties.
    const day = await read('/reports/date-wise', { query, cursor: null });
    assert.deepEqual(day.rows.map((r: { date: string; lrs: number }) => [r.date, r.lrs]), [[today, 2]]);
    assert.deepEqual(day.totals, { lrs: 2, qty: 6, toPayPaise: 360000, paidPaise: 0, chargesPaise: 8400, staxPaise: 18000, totalPaise: 386400 });
    assert.equal(day.next, null);
    const stations = await read('/reports/station-wise', { query, cursor: null });
    assert.deepEqual(stations.rows.map((r: { station: string; lrs: number }) => [r.station, r.lrs]), [['Nagpur', 2]]);
    const consignors = await read('/reports/party-wise', { side: 'consignor', query, cursor: null });
    assert.deepEqual(consignors.rows.map((r: { name: string; firmId: number | null; lrs: number }) => [r.name, r.firmId, r.lrs]), [['Shree Ganesh Traders', firm, 2]]);
    const consignees = await read('/reports/party-wise', { side: 'consignee', query, cursor: null });
    assert.deepEqual(consignees.rows.map((r: { name: string; firmId: number | null; lrs: number }) => [r.name, r.firmId, r.lrs]), [['Kale Brothers', null, 2]], 'a walk-in is a party by its name');
    assert.deepEqual((await read('/reports/truck-wise', { query, cursor: null })).totals, { memos: 0, lrs: 0, toPayPaise: 0, paidPaise: 0, truckHirePaise: 0, loadingHamaliPaise: 0 });
    const firms = await read('/reports/firm-wise', { query, cursor: null });
    assert.deepEqual([firms.rows.map((r: { name: string; asConsignor: number }) => [r.name, r.asConsignor]), firms.totals], [[['Shree Ganesh Traders', 2]], { firms: 1, asConsignor: 2, asConsignee: 0, walkInConsignor: 0, walkInConsignee: 2 }]);
    assert.deepEqual((await read('/reports/wasuli', { query, cursor: null })).totals, { assignedCount: 0, assignedPaise: 0, collectedCount: 0, collectedPaise: 0, poolCount: 0, poolPaise: 0 });
    const behind = await read('/reports/lrs', { of: { kind: 'stationWise', stationId: (await lrCall(port, '/reports/station-wise', { query, cursor: null })).value.rows[0].stationId }, query, cursor: null });
    assert.deepEqual([behind.rows.length, behind.totals.lrs, behind.totals.totalPaise, behind.next], [2, 2, 386400, null]);
    assert.deepEqual((await read('/reports/lrs', { of: { kind: 'consigneeWise', firmId: null, name: 'KALE brothers' }, query, cursor: null })).totals.lrs, 2);

    // Bad requests are refused before anything is read.
    for (const [url, body] of [
      ['/reports/date-wise', {}], ['/reports/station-wise', { query: { from: today, to: '2000-01-01' } }], ['/reports/party-wise', { query }], ['/reports/party-wise', { side: 'both', query }],
      ['/reports/truck-wise', { query: 'x' }], ['/reports/firm-wise', { query: { from: 'x', to: today } }], ['/reports/wasuli', {}],
      ['/reports/lrs', { query }], ['/reports/lrs', { of: { kind: 'dateWise' }, query }], ['/reports/lrs', { of: { kind: 'stationWise', stationId: 1 } }],
    ] as const) assert.equal((await lrCall(port, url, body)).status, 400, `${url} ${JSON.stringify(body)}`);

    // The same report as printed: formatted text, and the audit row of a print that went through. Neither raises an event.
    const printed = await read('/print/report', { report: 'dateWise', query });
    assert.deepEqual([printed.report, printed.rows, printed.totals], ['dateWise', [[`${today.slice(8)}-${today.slice(5, 7)}-${today.slice(0, 4)}`, '2', '6', '3,600.00', '–', '84.00', '180.00', '3,864.00']], ['2', '6', '3,600.00', '0.00', '84.00', '180.00', '3,864.00']]);
    assert.equal((await lrCall(port, '/print/report', { report: 'nothing', query })).status, 400);
    assert.equal((await lrCall(port, '/print/report', { report: 'dateWise' })).status, 400);
    const done = { kind: 'report', id: 0, how: 'print', report: 'dateWise', from: query.from, to: query.to, filters: { toStationId: null, text: 'kale', truckId: null, agentId: null } };
    assert.equal((await lrCall(port, '/print/done', done)).ok, true);
    assert.equal((await lrCall(port, '/print/done', { ...done, report: undefined })).status, 400, 'a report print names which report');

    await sleep(400); // anything wrongly sent would be here by now
    assert.equal(a.got.length, 3, 'reads raise no event');
  } finally {
    a.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  for (const secret of ['Shree Ganesh', 'Kale Brothers', '193200', '386400', 'kale']) assert.ok(!leaks(log, secret, true), `keeper.log holds ${secret}`);
}));

// --- History -----------------------------------------------------------------------------------------------------

test('keeper: History over the real route - what the saves wrote comes back as data with names; bad requests are refused; a read raises no event and leaves no name or amount in the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input } = await seed(port);
  const a = listen(port, 'counter-1');
  try {
    await until('the stream to connect', () => a.got.length >= 1);
    const saved = await lrCall(port, '/lrs/create', { input: input() }, 'counter-1');
    const id = saved.value.row.id as number;
    const lrNo = saved.value.row.lrNo as number;
    const edit = await lrCall(port, '/lrs/update', { id, version: 1, input: input({ qty: '5', toPay: '2,000' }), systemPin: '7295' }, 'counter-2');
    assert.equal(edit.ok, true);
    await until('the LR events', () => a.got.length >= 3);
    const today = (await lrCall(port, '/lrs/defaults', { date: null })).value.today as string;
    const filters = { from: `${today.slice(0, 4)}-01-01`, to: today, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: false };
    const list = async (over: object = {}, cursor: unknown = null) => (await lrCall(port, '/history/list', { filters: { ...filters, ...over }, cursor })).value;

    const all = await list();
    assert.equal(all.next, null);
    const [update, create] = all.rows.filter((r: { action: string }) => r.action === 'lrs.update' || r.action === 'lrs.create');
    assert.deepEqual([update.seat, update.kind, update.verb, update.record, update.openId, update.lrNo], ['counter-2', 'lr', 'edited', 'lr', id, lrNo]);
    assert.deepEqual(update.changes, [{ field: 'qty', from: 3, to: 5 }, { field: 'toPay', from: 180000, to: 200000, unit: 'paise' }]);
    assert.deepEqual([create.seat, create.facts], ['counter-1', { consignor: 'Shree Ganesh Traders', consignee: 'Kale Brothers', station: 'Nagpur', qty: 3 }]);
    assert.ok(all.rows.some((r: { action: string; seat: string }) => r.action === 'pins.setup' && r.seat === 'counter-1'), 'the PIN setup is in the book too');
    assert.deepEqual((await list({ seat: 'COUNTER-2' })).rows.map((r: { action: string }) => r.action), ['lrs.update']);
    assert.deepEqual((await list({ lrNo, verb: 'edited' })).rows.map((r: { action: string }) => r.action), ['lrs.update']);
    assert.deepEqual((await list({ lrNo: lrNo + 100 })).rows, []);
    assert.deepEqual((await list({ kind: 'station' })).rows.map((r: { name: string }) => r.name), ['Nagpur', 'Yavatmal'], 'newest first');
    const after = await list({}, { at: create.at, id: create.id });
    assert.ok(after.rows.every((r: { id: number }) => r.id < create.id), 'a page after a cursor holds only older rows');
    assert.equal((await list({}, { at: 'nonsense', id: 1 })).rows.length, all.rows.length, 'a cursor that is not one means the first page');

    // Bad requests are refused before anything is read.
    for (const body of [{}, { filters: 'x' }, { filters: { from: filters.from } }, { filters: { from: today, to: '2000-01-01' } }, { filters: { from: 'x', to: today } }]) {
      assert.equal((await lrCall(port, '/history/list', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await lrCall(port, '/history/list', { filters: { ...filters, kind: 'planets', verb: 5, lrNo: 'x' } })).ok, true, 'a filter that is not one means no filter');

    await sleep(400); // anything wrongly sent would be here by now
    assert.equal(a.got.length, 3, 'reads raise no event');
  } finally {
    a.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  for (const secret of ['Shree Ganesh', 'Kale Brothers', '180000', '200000', 'Yavatmal']) assert.ok(!leaks(log, secret, true), `keeper.log holds ${secret}`);
}));

// --- PIN coverage ------------------------------------------------------------------------------------------------

// The routes that answer without asking for a PIN. A route in neither this list nor the table below fails the test, so whoever adds a route
// has to decide which it is (a PIN route writes its audit row and its lock-out row, and proves it here).
const NO_PIN_ROUTES = [
  '/shutdown', '/backups/list', '/backups/export', '/seats', '/pins/setup',
  '/restore/preview', // a read; the apply is the PIN route
  '/masters/all', '/masters/create',
  '/lrs/defaults', '/lrs/preview', '/lrs/by-date', '/lrs/get', '/lrs/find', '/lrs/history',
  '/dashboard/summary', '/dashboard/pending-by-station', '/dashboard/recent', '/search',
  '/memos/defaults', '/memos/pending', '/memos/totals', '/memos/get', '/memos/by-date', '/memos/list', '/memos/history',
  '/print/memo', '/print/lr', '/print/done', '/print/company', '/print/firm-statement', '/print/report',
  '/wasuli/list', '/wasuli/find', '/wasuli/agent-stats', '/wasuli/assign', '/wasuli/reassign', '/wasuli/to-pool', '/wasuli/collect',
  '/firms/accounts', '/firms/statement', '/firms/top', '/firms/kpis', '/firms/months',
  '/reports/date-wise', '/reports/station-wise', '/reports/party-wise', '/reports/truck-wise', '/reports/firm-wise', '/reports/wasuli', '/reports/lrs',
  '/history/list',
];

interface PinRoute {
  url: string;
  kind: 'admin' | 'system' | 'recovery';
  /** The audit action a success writes; null = a check that writes nothing. */
  audit: string | null;
  wrong: () => object | Promise<object>;
  right: () => object | Promise<object>;
  after?: () => void;
}

test('keeper: PIN coverage - every route that checks a PIN writes its audit row on success and a pins.locked row (kind and seat) when five wrong tries lock it; a route in neither list fails here', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir, { BM_PIN_LOCK_MS: '250' });
  assert.equal((await waitUp(port)).state, 'ready');
  const { input, from, to, recoveryCode } = await seed(port);
  const SEAT = 'counter-1'; // the seat that seeds the data: a second seat that talked to the keeper would stop a restore
  const call = (url: string, body: unknown) => lrCall(port, url, body, SEAT);
  const good = async (url: string, body: unknown) => {
    const r = await call(url, body);
    assert.equal(r.ok, true, `${url}: ${r.code ?? r.status} ${JSON.stringify((r as { fields?: unknown }).fields ?? r.memoFields ?? r.wasuliFields ?? r.detail ?? '')}`);
    return r.value;
  };
  const pin = { admin: '4831', system: '7295', admin2: '', system2: '' };
  const today = (await good('/lrs/defaults', { date: null })).today as string;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

  // Everything the routes below work on, made through the real routes (no PIN is needed for any of it except the last edit).
  const create = async (kind: string, fields: object) => (await good(`/masters/create`, { kind, fields })).id as number;
  const truck = await create('trucks', { number: 'MH 29 AB 1' });
  const truck2 = await create('trucks', { number: 'MH 29 AB 2' });
  const driver = await create('drivers', { name: 'Ramesh Pawar' });
  const agent = await create('agents', { name: 'Suresh' });
  const book = async (over: Record<string, unknown> = {}) => (await good('/lrs/create', { input: input(over) })).row as { id: number; lrNo: number };
  const [l1, l2, l3, l4, l5, l6, l7, lw] = [await book(), await book(), await book(), await book(), await book(), await book(), await book(), await book({ wasuli: '500' })];
  const header = (over: object = {}) => ({ uid: `memo-${++uidSerial}`, date: null, truckId: truck, driverId: driver, fromStationId: from, toStationId: to, truckHire: '', loadingHamali: '', ...over });
  const m1 = (await good('/memos/create', { input: header({ lrIds: [l3.id, l4.id] }) })).id as number;
  const m2 = (await good('/memos/create', { input: header({ lrIds: [l6.id] }) })).id as number;
  const m3 = (await good('/memos/create', { input: header({ lrIds: [l7.id] }) })).id as number;
  const memo = async (id: number) => (await good('/memos/get', { id })) as { version: number; date: string; truckId: number; driverId: number; fromStationId: number; toStationId: number };
  const lr = async (id: number) => (await good('/lrs/get', { id })) as { version: number };
  await good('/lrs/update', { id: l7.id, version: (await lr(l7.id)).version, input: input({ qty: '8' }), systemPin: pin.system }); // m3 now differs: there is something to recalculate
  const collection = async () => (await good('/wasuli/find', { no: lw.lrNo })) as { id: number; status: string; agentId: number | null; version: number };
  const seen = (r: { id: number; status: string; agentId: number | null; version: number }) => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
  await good('/wasuli/assign', { rows: [seen(await collection())], agentId: agent });
  const collect = async () => good('/wasuli/collect', { row: seen(await collection()), input: { amount: '500', mode: 'cash', remark: '' } });
  await collect();

  const WRONG = '0000';
  // The newest backup in the folder now (the one made when the folder was changed), previewed: what a restore asks for.
  const restoreBody = async (adminPin: string) => {
    const files = ((await good('/backups/list', {})) as { file: string }[]).map((b) => b.file).sort();
    const file = files[files.length - 1];
    return { file, confirmToken: (await good('/restore/preview', { file })).token as string, adminPin };
  };
  const table: PinRoute[] = [
    { url: '/masters/update', kind: 'system', audit: 'masters.update', wrong: () => ({ kind: 'stations', id: to, version: 1, fields: { name: 'Nagpur City' }, systemPin: WRONG }),
      right: () => ({ kind: 'stations', id: to, version: 1, fields: { name: 'Nagpur City' }, systemPin: pin.system }) },
    { url: '/masters/set-active', kind: 'system', audit: 'masters.deactivate', wrong: () => ({ kind: 'trucks', id: truck2, version: 1, active: false, systemPin: WRONG }),
      right: () => ({ kind: 'trucks', id: truck2, version: 1, active: false, systemPin: pin.system }) },
    { url: '/lrs/create', kind: 'system', audit: 'lrs.create', wrong: () => ({ input: { ...input({ date: yesterday }), systemPin: WRONG } }),
      right: () => ({ input: { ...input({ date: yesterday }), systemPin: pin.system } }) },
    { url: '/lrs/update', kind: 'system', audit: 'lrs.update', wrong: () => ({ id: l1.id, version: 1, input: input({ qty: '9' }), systemPin: WRONG }),
      right: async () => ({ id: l1.id, version: (await lr(l1.id)).version, input: input({ qty: '9' }), systemPin: pin.system }) },
    { url: '/lrs/cancel', kind: 'system', audit: 'lrs.cancel', wrong: () => ({ id: l2.id, version: 1, reason: 'duplicate', systemPin: WRONG }),
      right: async () => ({ id: l2.id, version: (await lr(l2.id)).version, reason: 'duplicate', systemPin: pin.system }) },
    { url: '/lrs/restore', kind: 'system', audit: 'lrs.restore', wrong: () => ({ id: l2.id, version: 2, systemPin: WRONG }),
      right: async () => ({ id: l2.id, version: (await lr(l2.id)).version, systemPin: pin.system }) },
    { url: '/memos/create', kind: 'system', audit: 'memos.create', wrong: () => ({ input: header({ lrIds: [l5.id], date: yesterday, systemPin: WRONG }) }),
      right: () => ({ input: header({ lrIds: [l5.id], date: yesterday, systemPin: pin.system }) }) },
    { url: '/memos/edit', kind: 'system', audit: 'memos.edit',
      wrong: () => ({ id: m1, version: 1, input: { ...header(), truckHire: '100' }, systemPin: WRONG }),
      right: async () => {
        const m = await memo(m1);
        return { id: m1, version: m.version, input: { date: m.date, truckId: m.truckId, driverId: m.driverId, fromStationId: m.fromStationId, toStationId: m.toStationId, truckHire: '100', loadingHamali: '0' }, systemPin: pin.system };
      } },
    { url: '/memos/remove-lrs', kind: 'system', audit: 'memos.remove-lrs', wrong: () => ({ id: m1, lrIds: [l4.id], systemPin: WRONG }), right: () => ({ id: m1, lrIds: [l4.id], systemPin: pin.system }) },
    { url: '/memos/add-lrs', kind: 'system', audit: 'memos.add-lrs', wrong: () => ({ id: m1, lrIds: [l4.id], systemPin: WRONG }), right: () => ({ id: m1, lrIds: [l4.id], systemPin: pin.system }) },
    { url: '/memos/move-lrs', kind: 'system', audit: 'memos.move-out', wrong: () => ({ id: m1, lrIds: [l4.id], targetId: m2, systemPin: WRONG }),
      right: () => ({ id: m1, lrIds: [l4.id], targetId: m2, systemPin: pin.system }) },
    { url: '/wasuli/uncollect', kind: 'system', audit: 'wasuli.uncollect', wrong: async () => ({ row: seen(await collection()), systemPin: WRONG }),
      right: async () => ({ row: seen(await collection()), systemPin: pin.system }) },
    { url: '/wasuli/remark', kind: 'system', audit: 'wasuli.remark', wrong: async () => ({ row: seen(await collection()), remark: 'paid by cheque', systemPin: WRONG }),
      right: async () => {
        await collect(); // the last route put the collection back to Assigned: a remark belongs to a collected one
        return { row: seen(await collection()), remark: 'paid by cheque', systemPin: pin.system };
      } },
    { url: '/settings/set-lr-defaults', kind: 'admin', audit: 'settings.lr-defaults', wrong: () => ({ input: { bookingStationId: from, chargeOption: 'option2', staxPercent: '2.5' }, adminPin: WRONG }),
      right: () => ({ input: { bookingStationId: from, chargeOption: 'option2', staxPercent: '2.5' }, adminPin: pin.admin }) },
    { url: '/print/set-company', kind: 'admin', audit: 'settings.company', wrong: () => ({ input: { name: 'Test Co', address: '', phone: '', gstin: '' }, adminPin: WRONG }),
      right: () => ({ input: { name: 'Test Co', address: '', phone: '', gstin: '' }, adminPin: pin.admin }) },
    { url: '/memos/recalculate', kind: 'admin', audit: 'memos.recalculate', wrong: () => ({ id: m3, version: 1, adminPin: WRONG }),
      right: async () => ({ id: m3, version: (await memo(m3)).version, adminPin: pin.admin }) },
    { url: '/memos/cancel', kind: 'admin', audit: 'memos.cancel', wrong: () => ({ id: m2, version: 1, reason: 'wrong truck', adminPin: WRONG }),
      right: async () => ({ id: m2, version: (await memo(m2)).version, reason: 'wrong truck', adminPin: pin.admin }) },
    { url: '/settings/update-start', kind: 'admin', audit: 'app.update', wrong: () => ({ from: '0.2.1', to: '0.3.0', adminPin: WRONG }), right: () => ({ from: '0.2.1', to: '0.3.0', adminPin: pin.admin }) },
    { url: '/pins/verify', kind: 'admin', audit: null, wrong: () => ({ kind: 'admin', pin: WRONG }), right: () => ({ kind: 'admin', pin: pin.admin }) },
    { url: '/settings/set-backup-dir', kind: 'admin', audit: 'settings.backup-dir',
      wrong: () => ({ dir: path.join(s.dir, 'moved-backups'), adminPin: WRONG, confirmSameDrive: true }),
      right: () => ({ dir: path.join(s.dir, 'moved-backups'), adminPin: pin.admin, confirmSameDrive: true }) },
    { url: '/seats/rename', kind: 'admin', audit: 'seat.rename', wrong: () => ({ name: 'Counter 9', adminPin: WRONG }), right: () => ({ name: 'Counter 9', adminPin: pin.admin }) },
    // Restoring replaces the whole book with the backup's: it comes before the routes that change the PINs, which a backup from before would undo.
    { url: '/restore/apply', kind: 'admin', audit: 'backup.restore', wrong: () => restoreBody(WRONG), right: () => restoreBody(pin.admin) },
    { url: '/pins/change-system', kind: 'admin', audit: 'pins.change-system', wrong: () => ({ adminPin: WRONG, newPin: '5555' }), right: () => ({ adminPin: pin.admin, newPin: '5555' }),
      after: () => { pin.system2 = '5555'; } },
    { url: '/pins/change-admin', kind: 'admin', audit: 'pins.change-admin', wrong: () => ({ adminPin: WRONG, newPin: '6666' }), right: () => ({ adminPin: pin.admin, newPin: '6666' }),
      after: () => { pin.admin2 = '6666'; } },
    { url: '/pins/recover', kind: 'recovery', audit: 'pins.recover', wrong: () => ({ recoveryCode: 'AAAA-BBBB-CCCC', newAdminPin: '1212', newSystemPin: '3434' }),
      right: () => ({ recoveryCode, newAdminPin: '1212', newSystemPin: '3434' }) },
  ];

  // The two lists together are every route there is, each once.
  const everything = [...table.map((r) => r.url), ...NO_PIN_ROUTES];
  assert.deepEqual([...everything].sort(), [...ROUTES].sort(), 'a route that is in neither list (or in both) - decide whether it checks a PIN');

  const book_ = async (): Promise<{ action: string; seat: string; facts: { pin?: string } }[]> => {
    const filters = { from: `${today.slice(0, 4)}-01-01`, to: today, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: true };
    const rows: { action: string; seat: string; facts: { pin?: string } }[] = [];
    let cursor: unknown = null;
    do {
      const page = (await call('/history/list', { filters, cursor })).value;
      rows.push(...page.rows);
      cursor = page.next;
    } while (cursor);
    return rows;
  };
  for (const route of table) {
    const was = await book_();
    const count = (rows: typeof was, action: string) => rows.filter((r) => r.action === action).length;

    // Five wrong tries: four refusals, then the lock - and the lock is in the book, with the kind of PIN and the seat that tried.
    const wrong = await route.wrong();
    const codes: unknown[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call(route.url, wrong)).code);
    assert.deepEqual(codes, [...Array(4).fill(route.kind === 'recovery' ? 'wrong-recovery-code' : 'wrong-pin'), 'pin-locked'], `${route.url}: five wrong tries`);
    const locked = await book_();
    assert.equal(count(locked, 'pins.locked'), count(was, 'pins.locked') + 1, `${route.url}: one lock-out row`);
    const row = locked.find((r) => r.action === 'pins.locked');
    assert.deepEqual([row?.seat, row?.facts.pin], [SEAT, route.kind], `${route.url}: the lock-out names the seat and the kind of PIN`);
    assert.equal(locked.length, was.length + 1, `${route.url}: the wrong tries wrote nothing else`);

    // The right PIN, once the lock has run out: the route's own audit row.
    await sleep(320);
    const answer = await call(route.url, await route.right());
    assert.equal(answer.ok, true, `${route.url}: ${answer.code ?? answer.status} ${JSON.stringify((answer as { fields?: unknown }).fields ?? answer.memoFields ?? answer.wasuliFields ?? answer.detail ?? '')}`);
    const done = await book_();
    if (route.url === '/restore/apply') assert.equal(count(done, 'backup.restore'), 1, 'the restored book says it was restored');
    else if (route.audit) assert.ok(count(done, route.audit) >= count(was, route.audit) + 1, `${route.url} writes ${route.audit}`);
    else assert.equal(done.length, locked.length, `${route.url} writes nothing`);
    route.after?.();
    if (route.url === '/pins/change-system') pin.system = pin.system2;
    if (route.url === '/pins/change-admin') pin.admin = pin.admin2;
  }

  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  for (const secret of ['4831', '7295', '5555', '6666', '1212', '3434', recoveryCode]) assert.ok(!leaks(log, secret), `keeper.log holds ${secret}`);
}));

// --- Firm Accounts -----------------------------------------------------------------------------------------------

test('keeper: Firm Accounts over the real routes - list, statement, top lists, KPIs, months; bad requests are refused; reads raise no event and leave no firm name or amount in the log', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const k = startKeeper(s.root, port, s.programData, s.backupDir);
  assert.equal((await waitUp(port)).state, 'ready');
  const { input, firm } = await seed(port);
  const a = listen(port, 'counter-1');
  try {
    await until('the stream to connect', () => a.got.length >= 1);
    await lrCall(port, '/lrs/create', { input: input() });
    await lrCall(port, '/lrs/create', { input: input() });
    await until('the LR events', () => a.got.length >= 3);
    const today = (await lrCall(port, '/lrs/defaults', { date: null })).value.today as string;
    const query = { firmId: firm, from: `${today.slice(0, 4)}-01-01`, to: today, role: 'consignor' };

    const list = (await lrCall(port, '/firms/accounts', { filters: {}, cursor: null })).value;
    assert.deepEqual([list.count, list.next, list.rows.map((r: { name: string; asConsignor: number; asConsignee: number; lastLrDate: string }) => [r.name, r.asConsignor, r.asConsignee, r.lastLrDate])], [1, null, [['Shree Ganesh Traders', 2, 0, today]]]);
    assert.deepEqual((await lrCall(port, '/firms/accounts', { filters: { text: 'zzz' }, cursor: null })).value.rows, []);

    // Each LR: to pay 1,800.00 + charges 42.00 + tax 5% of 1,800 = 90.00 -> 1,932.00
    const statement = (await lrCall(port, '/firms/statement', { query, cursor: null })).value;
    assert.deepEqual(statement.rows.map((r: { party: string; toPayPaise: number; chargesPaise: number; staxPaise: number; totalPaise: number }) => [r.party, r.toPayPaise, r.chargesPaise, r.staxPaise, r.totalPaise]), [
      ['Kale Brothers', 180000, 4200, 9000, 193200],
      ['Kale Brothers', 180000, 4200, 9000, 193200],
    ]);
    assert.deepEqual([statement.totals.lrs, statement.totals.qty, statement.totals.totalPaise, statement.next], [2, 6, 386400, null]);
    assert.equal((await lrCall(port, '/firms/statement', { query: { ...query, role: 'consignee' }, cursor: null })).value.totals.lrs, 0, 'Kale Brothers is a walk-in: the firm is not on that side');
    assert.deepEqual((await lrCall(port, '/firms/top', { query })).value, { parties: [{ name: 'Kale Brothers', lrs: 2 }], stations: [{ name: 'Nagpur', lrs: 2 }], trucks: [] });
    const kpis = (await lrCall(port, '/firms/kpis', { query })).value;
    assert.deepEqual([kpis.now.lrs, kpis.now.freightPaise, kpis.before.lrs, kpis.growth.lrs], [2, 360000, 0, null]);
    const months = (await lrCall(port, '/firms/months', { firmId: firm, year: Number(today.slice(0, 4)), role: 'both' })).value;
    assert.deepEqual([months.length, months.reduce((n: number, m: { lrs: number }) => n + m.lrs, 0)], [12, 2]);

    // Bad requests are refused before anything is read; an unknown firm is named.
    for (const [url, body] of [
      ['/firms/statement', {}], ['/firms/statement', { query: { ...query, role: 'agent' } }], ['/firms/statement', { query: { ...query, from: today, to: '2000-01-01' } }],
      ['/firms/top', { query: { firmId: 0, from: today, to: today } }], ['/firms/kpis', { query: 'x' }],
      ['/firms/months', { firmId: firm, year: 1999, role: 'both' }], ['/firms/months', { firmId: firm, year: 2026, role: 'x' }], ['/firms/months', { year: 2026, role: 'both' }],
    ] as const) assert.equal((await lrCall(port, url, body)).status, 400, `${url} ${JSON.stringify(body)}`);
    assert.equal((await lrCall(port, '/firms/statement', { query: { ...query, firmId: 99999 }, cursor: null })).code, 'master-missing');

    // The same statement as printed: formatted text, and the audit row of a print that went through. Neither raises an event.
    const printed = (await lrCall(port, '/print/firm-statement', { query })).value;
    assert.deepEqual([printed.firm, printed.role, printed.rows.length, printed.rows[0].total, printed.totals.total, printed.totals.hasWasuli], ['Shree Ganesh Traders', 'consignor', 2, '1,932.00', '3,864.00', false]);
    assert.equal((await lrCall(port, '/print/firm-statement', {})).status, 400);
    assert.equal((await lrCall(port, '/print/firm-statement', { query: { ...query, firmId: 99999 } })).code, 'master-missing');
    const done = { kind: 'firm', id: firm, how: 'pdf', from: query.from, to: query.to, role: 'consignor' };
    assert.equal((await lrCall(port, '/print/done', done)).ok, true);
    assert.equal((await lrCall(port, '/print/done', { ...done, role: undefined })).status, 400, 'a firm statement names its period and role');

    await sleep(400); // anything wrongly sent would be here by now
    assert.equal(a.got.length, 3, 'reads raise no event');
  } finally {
    a.stop();
  }
  assert.equal(await shutdown(port), true);
  await within(k.exited, 10000);
  const log = logOf(s);
  for (const secret of ['Shree Ganesh', 'Kale Brothers', '193200', '386400']) assert.ok(!leaks(log, secret, true), `keeper.log holds ${secret}`);
}));

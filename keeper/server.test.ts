// Integration: the keeper is started the way production starts it (Electron exe as plain Node), because the
// better-sqlite3 build only loads under Electron's Node, not the Node that runs these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { probe, shutdown } from './client';
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

function startKeeper(root: string, port: number, programData: string): Running {
  const child = spawn(electronExe, [serverJs, root, String(port)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROGRAMDATA: programData },
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
    if (p.kind === 'up') return p.health;
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
  return { dir, root, programData, programDir: path.join(programData, 'BookingManager'), dbPath: path.join(root, 'booking.db') };
}

test('keeper: start, one keeper per port, shutdown leaves an intact database', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData);

  const health = await waitUp(port);
  assert.equal(health.app, 'booking-manager');
  assert.equal(health.state, 'ready');
  assert.equal(health.dataRoot, s.root);
  assert.equal(health.dbPath, s.dbPath);
  assert.ok(fs.statSync(s.dbPath).size > 0, 'a fresh WAL database is never 0 bytes');
  assert.ok(fs.existsSync(markerPath(s.programDir, s.root)), 'marker written after the first open');
  const log = fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8');
  assert.match(log, /\tstart\t/);
  assert.match(log, /\tdatabase-open\t/);

  // A second keeper on the same port exits quietly and does not take over.
  const second = startKeeper(s.root, port, s.programData);
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
}));

test('keeper: marker + deleted database = safe mode, nothing is created', () => run(async () => {
  const s = sandbox();
  const port = await freePort();
  const first = startKeeper(s.root, port, s.programData);
  await waitUp(port);
  assert.equal(await shutdown(port), true);
  await within(first.exited, 10000);

  fs.rmSync(s.dbPath);
  const again = startKeeper(s.root, port, s.programData);
  const health = await waitUp(port);
  assert.equal(health.state, 'safe-mode');
  assert.equal(health.reason, 'marker-without-database');
  assert.equal(fs.existsSync(s.dbPath), false, 'the keeper must not create a new database');
  assert.match(fs.readFileSync(path.join(s.programDir, 'logs', 'keeper.log'), 'utf8'), /\tguard-trip\t/);

  assert.equal(await shutdown(port), true);
  assert.equal(await within(again.exited, 10000), 0);
  assert.equal(fs.existsSync(s.dbPath), false);
}));

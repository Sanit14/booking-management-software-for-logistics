// Main-process side of the keeper chain: find the keeper (or start it), check it is ours and current, answer
// the screen's keeper.health(). There is no fallback database: if the keeper cannot be reached the screen
// gets an error code and nothing else happens.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ipcMain } from 'electron';
import { KEEPER_PORT, KEEPER_VERSION, type KeeperErrorCode, type KeeperStatus, type RootRefusal } from '../shared';
import { probe, shutdown } from '../keeper/client';
import { checkDataRoot, resolveDataRoot } from '../keeper/dataRoot';
import { makeLog } from '../keeper/log';
import { logPath, pointerPath, programDir } from '../keeper/paths';

const START_WAIT_MS = 10000;
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
  if (p.kind === 'up' && p.health.keeperVersion < KEEPER_VERSION) {
    // Left over from an older build: replace it (it checkpoints and closes the database first). Look again
    // first: another seat may just have replaced it, and its new keeper must not be shut down.
    const again = await probe(KEEPER_PORT, opts);
    if (again.kind === 'up' && again.health.keeperVersion < KEEPER_VERSION) {
      await shutdown(KEEPER_PORT, opts);
      for (let i = 0; i < 40 && (await probe(KEEPER_PORT, opts)).kind === 'up'; i++) await sleep(150);
    }
    p = await probe(KEEPER_PORT, opts);
    if (p.kind === 'up' && p.health.keeperVersion < KEEPER_VERSION) {
      throw new LauncherError('keeper-unreachable', 'the old keeper did not stop');
    }
  }

  const spawned: { exitCode?: number } = {};
  if (p.kind === 'down' && p.refused) {
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
  while (p.kind !== 'up') {
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

export function initKeeperBridge(userDataDir: string): void {
  const seat = loadSeat(userDataDir);
  const log = makeLog(logPath(programDir()));
  let inflight: Promise<KeeperStatus> | null = null;

  // Concurrent callers share one attempt. Each call re-probes, so a keeper that died is started again.
  const status = (): Promise<KeeperStatus> => {
    inflight ??= resolveStatus(seat)
      .catch((e): KeeperStatus => {
        const err = e instanceof LauncherError ? e : new LauncherError('keeper-unreachable', String((e as Error)?.message ?? e));
        log('launcher-error', { seat, code: err.code, detail: err.detail });
        return { kind: 'error', code: err.code, detail: err.detail, ...(err.refusal ? { refusal: err.refusal } : {}) };
      })
      .finally(() => (inflight = null));
    return inflight;
  };

  // The one route the screen can reach. Add routes here by name; there is no generic forwarder.
  ipcMain.handle('keeper:health', status);
  void status(); // warm up before the screen asks
}

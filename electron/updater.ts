// In-app updates, in the main process of the seat where the buttons are pressed. This is the ONLY code that
// talks to the internet, and only when a button is pressed: nothing here runs at start-up or on a timer. The
// app windows cannot reach the internet themselves (the CSP is unchanged).
//
//   Check → Download (SHA-512 from latest.yml by electron-updater, then the signature in latest.sig) → Install:
//     a. the Admin PIN, checked by the keeper (never trusted from the screen)
//     b. nobody else may have the app open: the keeper's seat list AND a scan of every Windows session
//     c. a verified backup now
//     d. the keeper stops cleanly; wait until its process has really exited
//     e. quitAndInstall (Windows asks for permission, the installer runs, the app starts again)
// Any failure stops the update with a clear message and changes nothing. Every step goes to updater.log.
import { app, BrowserWindow, ipcMain, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KEEPER_PORT, type KeeperHealth, type UpdateInstallResult, type UpdateState } from '../shared';
import { shutdown } from '../keeper/client';
import { makeLog } from '../keeper/log';
import { programDir } from '../keeper/paths';
import { strings } from '../src/strings';
import type { KeeperBridge } from './keeperBridge';
import { listProcesses, otherInstanceRoots } from './processScan';
import { SignatureError, verifyPayload, type Release, type SignatureDoc, type SignatureProblem } from './releaseSignature';
import { UPDATE_PUBLIC_KEY } from './updatePublicKey';

const p = strings.update.problem;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);

/** A message that is already fit to show the person. Anything else is logged in full and shown short. */
class UpdateError extends Error {}

const SIGNATURE_TEXT: Record<SignatureProblem, string> = {
  'not-set-up': p.signatureNotSetUp,
  mismatch: p.signatureMismatch,
  'bad-signature': p.signatureBad,
};

function friendly(e: unknown): string {
  if (e instanceof UpdateError) return e.message;
  if (e instanceof SignatureError) return SIGNATURE_TEXT[e.problem];
  const m = String((e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|EAI_AGAIN/i.test(m)) return p.network;
  if (/404|Cannot find channel/i.test(m)) return p.nothingPublished;
  if (/sha512|checksum/i.test(m)) return p.checksum;
  return p.generic(firstLine(e));
}

// The folder the update feed points at: the `publish.url` electron-builder put in app-update.yml.
function feedBase(): string {
  const m = /^url:\s*(\S+)/m.exec(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
  if (!m) throw new UpdateError(p.signatureDownload);
  return m[1].endsWith('/') ? m[1] : `${m[1]}/`;
}

// Fetched with Electron's own network stack (the one electron-updater uses): it follows redirects and the system
// proxy, and reuses the connection the download just opened. The first connection on a slow network can take a
// while, so the limit is generous.
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//i.test(url)) return reject(new UpdateError(p.signatureInsecure));
    const req = net.request({ url, redirect: 'follow' });
    const timer = setTimeout(() => {
      req.abort();
      reject(new UpdateError(p.signatureDownload));
    }, 60000);
    const end = (settle: () => void) => {
      clearTimeout(timer);
      settle();
    };
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        res.on('data', () => undefined);
        return end(() => reject(new UpdateError(p.signatureMissing)));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (size > 65536) {
          req.abort();
          end(() => reject(new UpdateError(p.signatureUnreadable)));
        }
      });
      res.on('end', () => end(() => resolve(Buffer.concat(chunks).toString('utf8'))));
      res.on('error', () => end(() => reject(new UpdateError(p.signatureDownload))));
    });
    req.on('error', () => end(() => reject(new UpdateError(p.signatureDownload))));
    req.end();
  });
}

function sha512File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('base64')))
      .on('error', reject);
  });
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // another Windows user's process: still there
  }
};

export function initUpdater(keeper: KeeperBridge): void {
  const log = makeLog(path.join(programDir(), 'logs', 'updater.log'));
  const say = (event: string, detail?: unknown) => log(event, { seat: keeper.seat, ...(detail === undefined ? {} : { detail }) });

  let state: UpdateState = { status: 'idle' };
  let busy = false;
  let release: (Release & { sizeBytes: number }) | null = null; // what the signature covers
  let downloadedFile = '';

  const set = (next: UpdateState): UpdateState => {
    state = next;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', state);
    return state;
  };
  const fail = (e: unknown): UpdateState => set({ status: 'error', message: friendly(e) });

  async function check(): Promise<UpdateState> {
    if (busy) return state;
    if (!app.isPackaged) return set({ status: 'error', message: p.dev });
    busy = true;
    set({ status: 'checking' });
    say('check-start', { current: app.getVersion() });
    try {
      const r = await autoUpdater.checkForUpdates();
      if (!r || !r.isUpdateAvailable) {
        say('check-uptodate', r?.updateInfo.version);
        return set({ status: 'uptodate' });
      }
      const info = r.updateInfo;
      const exe = info.files.find((f) => /\.exe$/i.test(f.url)) ?? info.files[0];
      const sha512 = exe?.sha512 ?? info.sha512;
      if (!sha512) throw new Error('latest.yml has no installer checksum');
      release = { version: info.version, sha512, sizeBytes: exe?.size ?? 0 };
      say('check-available', release);
      return set({ status: 'available', version: release.version, sizeBytes: release.sizeBytes });
    } catch (e) {
      say('check-failed', firstLine(e));
      return fail(e);
    } finally {
      busy = false;
    }
  }

  async function download(): Promise<UpdateState> {
    if (busy || state.status !== 'available' || !release) return state;
    busy = true;
    const { version } = release;
    set({ status: 'downloading', version, percent: 0, verifying: false });
    say('download-start', version);
    try {
      const files = await autoUpdater.downloadUpdate(); // electron-updater compares the file's SHA-512 with latest.yml
      downloadedFile = files[0];
      say('download-ok', downloadedFile);
      set({ status: 'downloading', version, percent: 100, verifying: true });
      let doc: SignatureDoc | null;
      try {
        doc = JSON.parse(await fetchText(new URL('latest.sig', feedBase()).toString())) as SignatureDoc | null;
      } catch (e) {
        throw e instanceof UpdateError ? e : new UpdateError(p.signatureUnreadable);
      }
      verifyPayload(release, doc, UPDATE_PUBLIC_KEY);
      say('signature-ok', version);
      return set({ status: 'downloaded', version });
    } catch (e) {
      say('download-failed', firstLine(e));
      if (downloadedFile) fs.rmSync(downloadedFile, { force: true }); // an update that did not verify is not kept
      downloadedFile = '';
      return fail(e);
    } finally {
      busy = false;
    }
  }

  // The installer sits in a folder any user of this PC can write to: check it is still the file that was
  // verified, right before it is run.
  async function assertInstallerUnchanged(): Promise<void> {
    if (!downloadedFile || !release) throw new UpdateError(p.nothingReady);
    if (!fs.existsSync(downloadedFile)) throw new UpdateError(p.fileMissing);
    if ((await sha512File(downloadedFile)) !== release.sha512) {
      fs.rmSync(downloadedFile, { force: true });
      downloadedFile = '';
      throw new UpdateError(p.fileChanged);
    }
  }

  // Refuses while another seat has the app open: the keeper's list of seats seen in the last 45 s, then Windows'
  // own list of processes in every session (catches a hung app, and two seats sharing one Windows user name).
  async function assertNobodyElse(): Promise<KeeperHealth> {
    const seats = await keeper.call<{ others: string[] }>('POST', '/seats');
    if (!seats.ok) throw new UpdateError(p.noKeeper);
    if (seats.value.others.length) throw new UpdateError(p.otherSeats(seats.value.others.join(', ')));
    const st = await keeper.status();
    if (st.kind !== 'connected') throw new UpdateError(p.noKeeper);
    let rows;
    try {
      rows = await listProcesses(path.basename(process.execPath));
    } catch (e) {
      say('process-scan-failed', firstLine(e));
      throw new UpdateError(p.scanFailed);
    }
    const others = otherInstanceRoots(rows, process.pid, st.health.pid);
    if (others.length) throw new UpdateError(p.otherSessions([...new Set(others.map((o) => o.session))].join(', ')));
    return st.health;
  }

  async function stopKeeper(pid: number): Promise<void> {
    await shutdown(KEEPER_PORT, { seat: keeper.seat, timeoutMs: 10000 }); // writes its backup and checkpoint, then exits
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (!pidAlive(pid)) return say('keeper-exited', pid);
      await sleep(250);
    }
    throw new UpdateError(p.keeperStuck);
  }

  async function install(pin: string): Promise<UpdateInstallResult> {
    const refused = (message: string): UpdateInstallResult => ({ ok: false, wrongPin: false, message });
    if (busy) return refused(p.busy);
    if (state.status !== 'downloaded' || !release) return refused(p.nothingReady);
    busy = true; // before the first await: two overlapping install calls must not both get through
    const gate = await keeper.call('POST', '/pins/verify', { kind: 'admin', pin });
    if (!gate.ok) {
      busy = false;
      say('install-pin-refused', gate.code);
      return { ok: false, wrongPin: gate.code === 'wrong-pin', message: strings.result(gate.code, gate.detail) };
    }

    const { version } = release;
    let step = 0;
    let keeperStopped = false;
    const mark = (i: number) => {
      step = i;
      set({ status: 'installing', version, step: i });
    };
    try {
      say('install-start', { from: app.getVersion(), to: version });
      mark(0);
      await assertInstallerUnchanged();
      const health = await assertNobodyElse();
      mark(1);
      const backup = await keeper.call<{ file: string }>('POST', '/backups/export', { dir: health.backupDir });
      if (!backup.ok) throw new UpdateError(p.backupFailed(strings.result(backup.code, backup.detail)));
      say('backup-ok', backup.value.file);
      mark(2);
      keeper.pauseWatchdog(); // otherwise the 15 s ping would start a new keeper while the installer waits
      keeperStopped = true;
      await stopKeeper(health.pid);
      mark(3);
      say('quit-and-install');
      await sleep(1200); // let the screen show the last step before the app closes
      // The installer runs elevated from a folder other users can write to: look at it once more, as late as possible.
      await assertInstallerUnchanged();
      // Silent installer, app started again afterwards. The installer asks Windows for permission; if that is
      // refused nothing is installed and the app has to be opened again.
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    } catch (e) {
      say('install-aborted', { step: strings.update.steps[step], error: firstLine(e) });
      if (keeperStopped) keeper.resumeWatchdog(); // brings the keeper back
      busy = false;
      const message = friendly(e);
      // The installer is gone or was changed: "Install" can never work now, so offer "Download" again instead.
      if (!downloadedFile || !fs.existsSync(downloadedFile)) set({ status: 'available', version, sizeBytes: release?.sizeBytes ?? 0 });
      else set({ status: 'downloaded', version, notice: message });
      return refused(message);
    }
  }

  let loaded = true;
  try {
    autoUpdater.autoDownload = false; // only when the button is pressed
    autoUpdater.autoInstallOnAppQuit = false; // never install by surprise
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.disableDifferentialDownload = true; // GitHub redirects make range requests unreliable; the file is ~70 MB
    // publisherName is deliberately NOT set: the .exe is not code-signed, so there is no publisher to compare. The
    // SHA-512 from latest.yml is checked on every download, and latest.sig (releaseSignature.ts) on top of that.
    autoUpdater.logger = {
      info: (m: unknown) => say('eu-info', m),
      warn: (m: unknown) => say('eu-warn', m),
      error: (m: unknown) => say('eu-error', firstLine(m)),
    };
    autoUpdater.on('download-progress', (pr) => {
      const percent = Math.round(pr.percent || 0);
      if (state.status === 'downloading' && !state.verifying && percent !== state.percent && percent < 100) set({ ...state, percent });
    });
    autoUpdater.on('error', (e) => {
      // An error after the installer was launched (e.g. it could not be started): bring the keeper back.
      if (state.status !== 'installing') return;
      say('install-error', firstLine(e));
      keeper.resumeWatchdog();
      busy = false;
      set({ status: 'downloaded', version: state.version, notice: p.installerFailed });
    });
  } catch (e) {
    loaded = false;
    say('updater-load-failed', firstLine(e));
  }

  // The component could not be loaded: every button says so instead of failing silently.
  const guard = <T>(fn: () => Promise<T>, otherwise: () => T) => (loaded ? fn() : Promise.resolve(otherwise()));
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => guard(check, () => set({ status: 'error', message: p.unavailable })));
  ipcMain.handle('update:download', () => guard(download, () => state));
  ipcMain.handle('update:install', (_e, pin: unknown) =>
    guard<UpdateInstallResult>(() => install(typeof pin === 'string' ? pin : ''), () => ({ ok: false, wrongPin: false, message: p.unavailable })),
  );
  say('updater-ready', { version: app.getVersion(), packaged: app.isPackaged });
}

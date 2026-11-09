// Times the long lists in the real app window (session 4.4, audit O6): a day of 400 LRs in LR Entry, 500 firms in Masters. See electron/uiTiming.ts.
//
//   npm run build            (the screen: dist\)           npm run build:node   (dist-electron\)
//   npm run measure:ui [-- --label mypc]                   writes docs\bench\<date>-<label>-ui.md
//
// Close Booking Manager first: the window talks to the keeper on its fixed port 47715, and this script refuses to run if anything answers there. The book
// is private (C:\bm-measure-ui, its own ProgramData and backup folder under %TEMP%) and is deleted afterwards. Not part of `npm run check`.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = require('electron');

const args = process.argv.slice(2);
const label = (args.includes('--label') ? args[args.indexOf('--label') + 1] : os.hostname()).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const root = path.join(__dirname, '..');
const app = path.join(root, 'dist-electron', 'electron', 'uiTiming.js');
const dataRoot = 'C:\\bm-measure-ui'; // outside every user profile (the launcher refuses a book there)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-measure-'));

const portInUse = () =>
  new Promise((resolve) => {
    const s = net.connect(47715, '127.0.0.1');
    s.on('connect', () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
  });
/** Whatever way the app ended, the keeper it started (detached) must not stay: stop it, but only if it is on OUR book (the owner may have opened the real app meanwhile). */
const stopOurKeeper = () =>
  new Promise((resolve) => {
    const call = (method, url, done) => {
      const req = http.request({ host: '127.0.0.1', port: 47715, path: url, method, headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => done(body));
      });
      req.on('error', () => resolve());
      req.on('timeout', () => req.destroy());
      req.end(method === 'POST' ? '{}' : undefined);
    };
    call('GET', '/health', (body) => {
      let ours = false;
      try {
        ours = String(JSON.parse(body).dataRoot).toLowerCase() === dataRoot.toLowerCase();
      } catch {
        /* not a keeper */
      }
      if (!ours) return resolve();
      call('POST', '/shutdown', async () => {
        for (let i = 0; i < 100 && (await portInUse()); i++) await new Promise((r) => setTimeout(r, 300)); // its last backup takes a moment
        resolve();
      });
    });
  });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  for (const [what, file] of [['npm run build:node', app], ['npm run build', path.join(root, 'dist', 'index.html')]]) {
    if (!fs.existsSync(file)) {
      console.error(`${file} is missing: run ${what} first.`);
      process.exit(2);
    }
  }
  if (await portInUse()) {
    console.error('Something answers on port 47715 (Booking Manager or its database service is open): close it first, then run this again.');
    process.exit(2);
  }
  fs.rmSync(dataRoot, { recursive: true, force: true });
  const env = {
    ...process.env,
    PROGRAMDATA: path.join(scratch, 'pd'),
    BM_DATA_ROOT: dataRoot,
    BM_BACKUP_DIR: path.join(scratch, 'backups'),
  };
  delete env.ELECTRON_RUN_AS_NODE; // this is an app: with it set Electron would start as plain Node and have no window
  let out = '';
  const child = spawn(electron, [app], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
    setTimeout(() => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']), 11 * 60 * 1000).unref(); // the app ends itself after 10; this is the last resort
  });
  await stopOurKeeper();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
  const m = /UI-TIMING-BEGIN\n([\s\S]*?)\nUI-TIMING-END/.exec(out);
  if (code !== 0 || !m) {
    console.error(out);
    console.error(`the timing run failed (exit ${code})`);
    process.exit(1);
  }
  const file = path.join(root, 'docs', 'bench', `${iso(new Date())}-${label}-ui.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Long lists in the real window — ${label}, ${iso(new Date())}\n\nA day of 400 LRs in LR Entry and 500 firms in Masters. \`npm run measure:ui\` (electron/uiTiming.ts).\n\n${m[1]}\n`);
  console.log(m[1]);
  console.log(`\nwritten: ${path.relative(root, file)}`);
})();

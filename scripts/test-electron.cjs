// Runs the compiled *.electrontest.js files as real Electron apps (not as Node: they open a hidden window and print it to PDF).
// A file prints its own TAP-like report and exits non-zero if any check fails. Part of `npm run check`, after the database tests.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..', 'dist-electron');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.electrontest.js')) files.push(p);
  }
})(root);

/**
 * The page `dialog.electrontest.js` drives: the real Dialog and PinDialog (src/ui/dialogHarness.tsx) bundled for Chromium 108, in a folder with an index.html.
 * It is built here because Vite (ESM, Node 20) cannot run inside Electron 22; the test only loads the folder named by BM_DIALOG_HARNESS.
 */
async function buildDialogPage() {
  const { build } = await import('vite');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dialog-page-'));
  await build({
    configFile: false,
    root: path.join(__dirname, '..'),
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'chrome108',
      lib: { entry: 'src/ui/dialogHarness.tsx', formats: ['iife'], name: 'DialogHarness', fileName: () => 'harness.js' },
    },
  });
  const css = fs.readdirSync(out).filter((f) => f.endsWith('.css')).map((f) => `<link rel="stylesheet" href="${f}">`).join('');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${css}</head><body><div id="root"></div><script src="harness.js"></script></body></html>`);
  return out;
}

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // these are apps: with this set Electron would start as plain Node and have no windows
  let passed = 0;
  let failed = 0;
  if (files.some((f) => f.endsWith('dialog.electrontest.js'))) {
    try {
      env.BM_DIALOG_HARNESS = await buildDialogPage();
    } catch (e) {
      failed++;
      console.log(`FAILED the dialog test page did not build: ${e && e.message ? e.message : e}`);
    }
  }
  for (const file of files.sort()) {
    const run = spawnSync(electron, [file], { env, encoding: 'utf8', timeout: 240000 });
    const out = (run.stdout || '') + (run.stderr || '');
    const pass = Number((/^# pass (\d+)/m.exec(out) || [])[1] || 0);
    const fail = Number((/^# fail (\d+)/m.exec(out) || [])[1] || 0);
    // No summary line (a crash, a timeout) is a failure too.
    const ok = run.status === 0 && fail === 0 && /^# tests \d+/m.test(out);
    passed += pass;
    failed += ok ? 0 : Math.max(fail, 1);
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${path.relative(root, file)} (${pass} passed)`);
    if (!ok) console.log(out);
  }
  if (files.length === 0) {
    console.log('FAILED no *.electrontest.js found: build first');
    process.exit(1);
  }
  if (env.BM_DIALOG_HARNESS) fs.rmSync(env.BM_DIALOG_HARNESS, { recursive: true, force: true }); // the page built above
  console.log(`electron tests: ${passed} passed, ${failed} failed, ${files.length} files`);
  process.exit(failed === 0 ? 0 : 1);
})();

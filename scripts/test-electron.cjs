// Runs the compiled *.electrontest.js files as real Electron apps (not as Node: they open a hidden window and print it to PDF).
// A file prints its own TAP-like report and exits non-zero if any check fails. Part of `npm run check`, after the database tests.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
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

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // these are apps: with this set Electron would start as plain Node and have no windows
let passed = 0;
let failed = 0;
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
console.log(`electron tests: ${passed} passed, ${failed} failed, ${files.length} files`);
process.exit(failed === 0 ? 0 : 1);

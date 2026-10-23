// Runs every compiled *.dbtest.js (dist-electron) under Electron's own Node (ELECTRON_RUN_AS_NODE=1).
// The rebuilt better-sqlite3 only loads there, not in the Node 20 that `node --test` runs, so database tests
// are named *.dbtest.ts (which `node --test` does not pick up) and each file is run directly, like the keeper is.
// A file prints its own TAP report and exits non-zero if any of its tests fail.
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
    else if (entry.name.endsWith('.dbtest.js')) files.push(p);
  }
})(root);

let passed = 0;
let failed = 0;
for (const file of files.sort()) {
  const run = spawnSync(electron, [file], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 120000,
  });
  const out = (run.stdout || '') + (run.stderr || '');
  const pass = Number((/^# pass (\d+)/m.exec(out) || [])[1] || 0);
  const fail = Number((/^# fail (\d+)/m.exec(out) || [])[1] || 0);
  // A crash before any test ran (missing module, syntax error) has no TAP summary: that is a failure too.
  const ok = run.status === 0 && fail === 0 && /^# tests \d+/m.test(out);
  passed += pass;
  failed += ok ? 0 : Math.max(fail, 1);
  console.log(`${ok ? 'ok    ' : 'FAILED'} ${path.relative(root, file)} (${pass} passed)`);
  if (!ok) console.log(out);
}
console.log(`database tests: ${passed} passed, ${failed} failed, ${files.length} files`);
process.exit(failed === 0 ? 0 : 1);

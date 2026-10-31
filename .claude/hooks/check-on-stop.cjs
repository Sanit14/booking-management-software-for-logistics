// Stop hook: Claude may not end a turn while `npm run check` fails.
// Exit 2 = block the stop and show the failure to Claude. Gives up after 5 failed rounds per session.
// ponytail: counter in a temp file; good enough for one developer.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_ROUNDS = 5;
const root = path.resolve(__dirname, '..', '..');
const counterFile = path.join(__dirname, '.stop-rounds.json');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
const session = input.session_id || 'unknown';

// Nothing to check before the project has a package.json with a check script.
let pkg = null;
try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* none yet */ }
if (!pkg || !pkg.scripts || !pkg.scripts.check) process.exit(0);

let state = { session, rounds: 0 };
try {
  const saved = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
  if (saved.session === session) state = saved;
} catch { /* first round */ }

const run = spawnSync('npm', ['run', 'check'], { cwd: root, shell: true, encoding: 'utf8' });
if (run.status === 0) {
  try { fs.unlinkSync(counterFile); } catch { /* already gone */ }
  process.exit(0);
}

state.rounds += 1;
fs.writeFileSync(counterFile, JSON.stringify(state));
if (state.rounds >= MAX_ROUNDS) {
  process.stderr.write(`npm run check still failing after ${MAX_ROUNDS} rounds. Stop fixing; report the root cause to the owner.\n`);
  process.exit(0);
}

const all = (run.stdout || '') + (run.stderr || '');
const lines = all.split('\n');
// A TAP report lists every test, so a failing one can sit far above the last 60 lines: name the failures first and keep the whole output.
const failed = lines.filter((l) => /^\s*not ok /.test(l));
const logFile = path.join(require('os').tmpdir(), 'bm-last-check.log');
try { fs.writeFileSync(logFile, all); } catch { /* the tail below is still shown */ }
const out = (failed.length ? `Failing tests:\n${failed.join('\n')}\n\n` : '') + lines.slice(-60).join('\n');
process.stderr.write(`npm run check failed (round ${state.rounds}/${MAX_ROUNDS}). Fix the root cause, then finish. Full output: ${logFile}\n\n${out}\n`);
process.exit(2);

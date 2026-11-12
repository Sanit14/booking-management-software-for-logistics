// Times the Build Plan's speed budgets against a seeded database through the REAL keeper over HTTP (session 4.3).
//
//   node scripts/bench.cjs C:\bmload                        (dev PC; build first: npm run build:node)
//   node scripts/bench.cjs C:\bmload --label ncomputing     (names the report file docs\bench\<date>-<label>.md)
//   options: --runs 20  --app <dist-electron folder>  --out <folder>  --end YYYY-MM-DD  --keep
//
// Plain Node (built-ins only), so it also runs on a seat with the app installed, no repo needed:
//   $env:ELECTRON_RUN_AS_NODE=1
//   & "C:\Program Files\Booking Manager\Booking Manager.exe" bench.cjs C:\bmload --label ncomputing `
//       --app "C:\Program Files\Booking Manager\resources\app.asar\dist-electron"
//
// The seeded folder is COPIED to a temp folder first (the bench saves LRs and memos, and ends by restoring a backup), the keeper runs on a
// random port with its own ProgramData and backup folder, and nothing touches C:\BookingManagerData or the installed app's keeper.
// Not part of `npm run check`: the numbers belong to a PC, so it is run on purpose. Exit code 1 when a budget FAILS.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const valueFlags = ['--runs', '--app', '--out', '--end', '--label'];
const source = args.find((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.includes(args[i - 1])));
if (!source) {
  console.error('usage: bench.cjs <seeded data folder> [--label name] [--runs n] [--app <dist-electron>] [--out folder] [--end YYYY-MM-DD] [--keep]');
  process.exit(1);
}
const RUNS = Number(opt('--runs', 20));
const APP = path.resolve(opt('--app', path.join(__dirname, '..', 'dist-electron')));
const ADMIN_PIN = '1111'; // the seeder's Admin PIN
const label = (opt('--label', os.hostname()) || 'pc').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const endDay = opt('--end') ? new Date(`${opt('--end')}T10:30:00`) : new Date();
const to = iso(endDay);
const yearFrom = iso(new Date(endDay.getFullYear() - 1, endDay.getMonth(), endDay.getDate() + 1));
const weekFrom = iso(new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 6));

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; // { name, budget, ms[] }
const extras = []; // { name, value }

let port = 0;
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    const headers = { 'X-BM-Seat': 'BENCH' };
    if (method === 'POST') Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
    const req = http.request({ host: '127.0.0.1', port, path: route, method, agent: false, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`${route}: ${res.statusCode} ${text.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}
const call = (route, body) => request('POST', route, body);
async function ok(route, body) {
  const r = await call(route, body);
  if (!r.ok) throw new Error(`${route}: ${r.code} ${JSON.stringify(r.fields ?? r.memoFields ?? r.detail ?? '')}`);
  return r.value;
}
async function timed(name, budget, fn, runs = RUNS) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn(i);
    ms.push(performance.now() - t);
  }
  rows.push({ name, budget, ms });
  console.log(`${name}: median ${fmt(median(ms))} ms, worst ${fmt(Math.max(...ms))} ms (budget ${budget})`);
}
const dirSize = (dir) => fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);

async function main() {
  const src = path.resolve(source);
  if (!fs.existsSync(path.join(src, 'booking.db'))) throw new Error(`${src} has no booking.db`);
  if (src.toLowerCase() === 'c:\\bookingmanagerdata') throw new Error('refusing the real data root');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-bench-'));
  const dataDir = path.join(tmp, 'data');
  const backupDir = path.join(tmp, 'backups');
  fs.mkdirSync(dataDir);
  const t0 = performance.now();
  fs.copyFileSync(path.join(src, 'booking.db'), path.join(dataDir, 'booking.db'));
  const copyMs = performance.now() - t0;
  const dbBytes = fs.statSync(path.join(dataDir, 'booking.db')).size;
  console.log(`copied ${(dbBytes / 1048576).toFixed(0)} MB in ${(copyMs / 1000).toFixed(1)} s to ${tmp}`);

  const exe = process.versions.electron ? process.execPath : require('electron'); // the keeper runs under Electron's Node (better-sqlite3 is built for it)
  port = await freePort();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROGRAMDATA: path.join(tmp, 'pd'), BM_BACKUP_DIR: backupDir };
  let child;
  let exited;
  // Starts the keeper; resolves with the ms until it reports ready, and (second number) until its first backup of the day is done.
  async function boot() {
    // --test-hooks: the BM_* variable above (the bench's own backup folder) counts only with it. The OLD keepers (before 4.4) ignore the argument.
    child = spawn(exe, [path.join(APP, 'keeper', 'server.js'), dataDir, String(port), '--test-hooks'], { env, stdio: 'ignore', windowsHide: true });
    exited = new Promise((r) => child.on('exit', r));
    const t = performance.now();
    let readyMs = 0;
    for (;;) {
      if (performance.now() - t > 600000) throw new Error('the keeper did not finish starting in 10 minutes');
      try {
        const h = await request('GET', '/health');
        if (h.state === 'safe-mode') throw new Error(`keeper in safe mode: ${h.reason}`);
        if (h.state === 'ready' && !readyMs) readyMs = performance.now() - t;
        if (h.state === 'ready' && h.backup && (h.backup.failing || Date.now() - new Date(h.backup.lastAt).getTime() < 3600000)) return { readyMs, backupMs: performance.now() - t };
      } catch (e) {
        if (String(e.message).includes('safe mode')) throw e;
      }
      await sleep(25);
    }
  }
  try {
    // ---- start: the first start of a file the keeper has not seen checks all of it; the one after a clean stop does not ----
    const first = await boot();
    extras.push({ name: 'First start of a file this keeper has not seen (full check)', value: `ready after ${(first.readyMs / 1000).toFixed(1)} s, first backup of the day done after ${(first.backupMs / 1000).toFixed(1)} s` });
    const tStop1 = performance.now();
    await call('/shutdown', {});
    await exited;
    extras.push({ name: 'Clean stop after the first start (final backup + checkpoint)', value: `${((performance.now() - tStop1) / 1000).toFixed(1)} s` });
    fs.rmSync(backupDir, { recursive: true, force: true }); // the next start is the first of a new day again
    const second = await boot();
    rows.push({ name: 'App start, cold: keeper process start to ready (after a clean stop)', budget: 10000, ms: [second.readyMs] });
    extras.push({ name: 'Same start: first backup of the day finished', value: `${(second.backupMs / 1000).toFixed(1)} s after the start (the book is usable before)` });
    console.log(`keeper ready in ${(second.readyMs / 1000).toFixed(1)} s`);

    // ---- what the other rows need ----
    const masters = await ok('/masters/all');
    const yavatmal = masters.stations.find((s) => s.name === 'Yavatmal') ?? masters.stations[0];
    const towns = masters.stations.filter((s) => s.id !== yavatmal.id);
    const firms = masters.firms;
    let serial = 0;
    const lrInput = () => {
      const k = ++serial;
      return {
        uid: `bench-${Date.now()}-${k}`, date: null, fromStationId: yavatmal.id, toStationId: towns[k % towns.length].id,
        consignor: { firmId: firms[k % firms.length].id, name: '', addToFirms: false }, consignee: { firmId: firms[(k * 7 + 3) % firms.length].id, name: '', addToFirms: false },
        particular: 'Cloth bales', qty: String(1 + (k % 9)), toPay: String(500 + (k % 50) * 10), paid: '', hamali: String((1 + (k % 9)) * 10), wasuli: '',
      };
    };

    // ---- app start, keeper running: what the first screen asks for ----
    await timed('App start, keeper running: health + the first screen\'s reads', 5000, async () => {
      await request('GET', '/health');
      await Promise.all([ok('/masters/all'), ok('/lrs/defaults', { date: null }), ok('/lrs/by-date', { date: null }), ok('/dashboard/summary', {}), ok('/dashboard/pending-by-station'), ok('/dashboard/recent')]);
    }, 5);

    // ---- type-ahead ----
    await timed('Type-ahead: the pick-list data (all masters)', 50, () => ok('/masters/all'));
    try {
      const { buildRows } = require(path.join(APP, 'src', 'logic', 'typeAhead.js'));
      const options = firms.map((f) => ({ id: String(f.id), label: f.name }));
      const typed = ['s', 'sha', 'shree', 'agro', 'zzz'];
      await timed('Type-ahead: rank every firm for what is typed (the screen\'s own function)', 50, (i) => buildRows(options, typed[i % typed.length], 8, true));
    } catch {
      extras.push({ name: 'Type-ahead ranking', value: 'skipped (the screen\'s compiled logic is not in the app folder)' });
    }

    // ---- save an LR ----
    await timed('Save LR', 150, () => ok('/lrs/create', { input: lrInput() }));

    // ---- Dashboard ----
    await timed('Dashboard open (summary + pending by station + recent)', 300, () => Promise.all([ok('/dashboard/summary', {}), ok('/dashboard/pending-by-station'), ok('/dashboard/recent')]));

    // ---- a 100-LR memo ----
    const batches = [];
    let cursor = null;
    while (batches.length < RUNS) {
      const page = await ok('/memos/pending', { filters: {}, cursor });
      if (page.rows.length < 100) throw new Error('fewer than 100 booked LRs per page: the database has too few pending LRs for this run count');
      batches.push(page.rows.map((r) => r.id));
      cursor = page.next;
      if (!cursor) break;
    }
    const truck = masters.trucks[0];
    const driver = masters.drivers[0];
    await timed('Create memo with 100 LRs', 300, (i) =>
      ok('/memos/create', { input: { uid: `bench-memo-${Date.now()}-${i}`, date: null, truckId: truck.id, driverId: driver.id, fromStationId: yavatmal.id, toStationId: towns[i % towns.length].id, truckHire: '9000', loadingHamali: '300', lrIds: batches[i % batches.length] } }),
    batches.length);

    // ---- reports, one year ----
    const query = { from: yearFrom, to };
    const aStation = towns[0];
    for (const [name, route, extra] of [
      ['Report: date-wise', '/reports/date-wise', {}], ['Report: station-wise', '/reports/station-wise', {}],
      ['Report: consignor-wise', '/reports/party-wise', { side: 'consignor' }], ['Report: consignee-wise', '/reports/party-wise', { side: 'consignee' }],
      ['Report: truck-wise', '/reports/truck-wise', {}], ['Report: firm-wise', '/reports/firm-wise', {}], ['Report: wasuli', '/reports/wasuli', {}],
    ]) await timed(`${name}, first page, one year`, 1000, () => ok(route, { query, ...extra }));
    await timed('Report: the LRs behind a station row, first page, one year', 1000, () => ok('/reports/lrs', { of: { kind: 'stationWise', stationId: aStation.id }, query }));

    // ---- the biggest firm's statement ----
    let big = null;
    for (let cur = null, pages = 0; pages < 20; pages++) {
      const page = await ok('/reports/firm-wise', { query, cursor: cur });
      for (const r of page.rows) if (!big || r.asConsignor + r.asConsignee > big.asConsignor + big.asConsignee) big = r;
      cur = page.next;
      if (!cur) break;
    }
    if (!big) throw new Error('no firm has an LR in the last year');
    extras.push({ name: 'Biggest firm in the year', value: `${big.name}: ${big.asConsignor} LRs as consignor, ${big.asConsignee} as consignee` });
    const sq = { firmId: big.firmId, from: yearFrom, to, role: 'both' };
    await timed('Firm statement, one year, biggest firm (first page and totals)', 1000, () => ok('/firms/statement', { query: sq, cursor: null }));
    await timed('Firm account open, one year, biggest firm (statement + top lists + KPIs + chart together)', 1000, () =>
      Promise.all([ok('/firms/statement', { query: sq, cursor: null }), ok('/firms/top', { query: sq }), ok('/firms/kpis', { query: sq }), ok('/firms/months', { firmId: big.firmId, year: endDay.getFullYear(), role: 'both' })]),
    5);

    // ---- History, Ctrl+K ----
    await timed('History, default filter (last 7 days)', 300, () => ok('/history/list', { filters: { from: weekFrom, to }, cursor: null }));
    const texts = ['1234', 'sha', 'traders', 'MH 29 BE 10', '98765'];
    for (const text of texts) await timed(`Ctrl+K search "${text}"`, 100, () => ok('/search', { text }));

    // ---- a backup of the full file while saves go on (what the hourly backup does) ----
    let done = false;
    const exportDir = path.join(tmp, 'export');
    const tBackup = performance.now();
    const backup = call('/backups/export', { dir: exportDir }).then((r) => {
      done = true;
      return r;
    });
    const during = [];
    while (!done) {
      const t = performance.now();
      await ok('/lrs/create', { input: lrInput() });
      during.push(performance.now() - t);
    }
    const backupResult = await backup;
    const backupMs = performance.now() - tBackup;
    if (!backupResult.ok) throw new Error(`backup failed: ${backupResult.code} ${backupResult.detail ?? ''}`);
    rows.push({ name: 'Saves while the full file is backed up (every save during the backup)', budget: 1000, ms: during.length ? during : [0] });
    extras.push({ name: 'Backup of the full file (export, verified)', value: `${(backupMs / 1000).toFixed(1)} s; ${during.length} saves went through meanwhile` });

    // ---- Settings -> Restore a backup...: while it lists, previews and restores, another client keeps saving LRs and pinging /health ----
    // Every request must be ANSWERED within 1 s (a save in the short swap window may be answered "no database": answered is what counts, the
    // keeper's thread must never be held). The saver and the pinger use this seat's own name, so they are not "another seat" for the restore.
    async function whileBusy(what, fn) {
      let done = false;
      const saves = [];
      const pings = [];
      const saver = (async () => {
        while (!done) {
          const t = performance.now();
          await call('/lrs/create', { input: lrInput() });
          saves.push(performance.now() - t);
        }
      })();
      const pinger = (async () => {
        while (!done) {
          const t = performance.now();
          await request('GET', '/health');
          pings.push(performance.now() - t);
          await sleep(100);
        }
      })();
      const t0 = performance.now();
      let result;
      try {
        result = await fn();
      } finally {
        done = true;
        await Promise.all([saver, pinger]);
      }
      rows.push({ name: `Saves while ${what}`, budget: 1000, ms: saves.length ? saves : [0] });
      rows.push({ name: `Health pings while ${what}`, budget: 1000, ms: pings.length ? pings : [0] });
      return { result, ms: performance.now() - t0 };
    }
    const kept = fs.readdirSync(backupDir).filter((f) => /^booking-\d{8}-\d{4}\.db$/.test(f)).length;
    const listed = await whileBusy('the backups are listed', () => ok('/backups/list', {}));
    extras.push({ name: `Listing the backups (${kept} here; names, times and sizes only, nothing is opened)`, value: `${listed.ms.toFixed(0)} ms` });

    // ---- WAL ----
    const wal = path.join(dataDir, 'booking.db-wal');
    extras.push({ name: 'WAL file after this run\'s saves', value: fs.existsSync(wal) ? `${(fs.statSync(wal).size / 1048576).toFixed(1)} MB` : 'none' });

    // ---- restore, timed (last: it replaces the bench copy) ----
    const names = fs.readdirSync(backupDir).filter((f) => /^booking-\d{8}-\d{4}\.db$/.test(f)).sort();
    if (names.length === 0) {
      extras.push({ name: 'Restore of the full file', value: 'not run (no backup in the backup folder)' });
    } else {
      const previewed = await whileBusy('a backup is previewed', () => ok('/restore/preview', { file: names[0] }));
      const applied = await whileBusy('a restore runs (check, fresh backup, swap)', () =>
        call('/restore/apply', { file: names[0], confirmToken: previewed.result.token, adminPin: ADMIN_PIN }),
      );
      extras.push({
        name: 'Restore of the full file (compare, then check + fresh backup + swap)',
        value: applied.result.ok ? `${((previewed.ms + applied.ms) / 1000).toFixed(1)} s (the compare alone ${(previewed.ms / 1000).toFixed(1)} s)` : `refused: ${applied.result.code}`,
      });
    }

    // ---- clean stop ----
    const tStop = performance.now();
    await call('/shutdown', {});
    await exited;
    extras.push({ name: 'Clean stop (final backup + checkpoint)', value: `${((performance.now() - tStop) / 1000).toFixed(1)} s` });
    extras.push({ name: 'Copy of the seeded file into the bench folder', value: `${(copyMs / 1000).toFixed(1)} s for ${(dbBytes / 1048576).toFixed(0)} MB` });
    extras.push({ name: 'Disk used by the bench folder at the end', value: `${((dirSize(dataDir) + dirSize(backupDir)) / 1048576).toFixed(0)} MB` });
  } finally {
    if (child.exitCode === null) child.kill();
    if (!args.includes('--keep')) fs.rmSync(tmp, { recursive: true, force: true });
    else console.log(`kept ${tmp}`);
  }
  return src;
}

function report(src) {
  const verdict = (r) => {
    const worst = Math.max(...r.ms);
    return worst <= r.budget ? 'PASS' : median(r.ms) <= r.budget ? 'PASS (median; worst over)' : 'FAIL';
  };
  const table = rows.map((r) => `| ${r.name} | ${r.budget >= 1000 ? `${r.budget / 1000} s` : `${r.budget} ms`} | ${r.ms.length} | ${fmt(median(r.ms))} ms | ${fmt(Math.max(...r.ms))} ms | ${verdict(r)} |`);
  const cpus = os.cpus();
  let seedText = '';
  try {
    seedText = fs.readFileSync(path.join(src, 'seed-summary.txt'), 'utf8');
  } catch {
    /* no summary beside the file */
  }
  const text = [
    `# Bench ${iso(new Date())} - ${label}`,
    '',
    `Machine: ${os.hostname()} - ${cpus[0]?.model.trim()} x ${cpus.length} - ${(os.totalmem() / 1073741824).toFixed(1)} GB RAM - ${os.type()} ${os.release()} - Node ${process.versions.node}${process.versions.electron ? `, Electron ${process.versions.electron}` : ''}`,
    `Database: ${src} (copied to a temp folder for the run). Period for the reports and the statement: ${yearFrom} to ${to}.`,
    '',
    'PASS = every run within the budget. PASS (median; worst over) = the typical run is within it, one run was not. FAIL = the typical run is over.',
    'The first run of a row is included (nothing is thrown away). The OS file cache is warm after the copy: "cold" here means a cold keeper process, not a rebooted PC.',
    'The Electron window\'s own start (about 1-2 s) is not in the start rows: it is timed by hand in the real window.',
    '',
    '| Action | Budget | Runs | Median | Worst | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...table,
    '',
    ...extras.map((e) => `- ${e.name}: ${e.value}`),
    '',
    ...(seedText ? ['## Seeded database', '', '```', seedText.trim(), '```', ''] : []),
  ].join('\n');
  const docs = path.join(__dirname, '..', 'docs');
  const outDir = path.resolve(opt('--out', fs.existsSync(docs) ? path.join(docs, 'bench') : process.cwd()));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${iso(new Date())}-${label}.md`);
  fs.writeFileSync(file, text);
  console.log(`\n${table.join('\n')}\n\nwritten: ${file}`);
  return rows.some((r) => verdict(r) === 'FAIL');
}

main()
  .then((src) => process.exit(report(src) ? 1 : 0))
  .catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  });

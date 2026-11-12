// Dev tool (never packaged): builds a throwaway Booking Manager database that looks like years of real use, for the
// load test of session 4.3. It goes through the keeper's OWN code (the same create / update / cancel / assign / collect
// functions, one transaction each), so constraints, numbering, audit rows and frozen memo totals are real.
//
//   npm run build:node                       (the seeder loads the compiled keeper from dist-electron)
//   npm run seed:load -- C:\bmload           (3 years ending today, ~300 LRs a working day; takes minutes)
//   options: --end 2026-11-06  --days 1096  --per-day 300  --app <dist-electron folder>  --no-vacuum
//
// On a seat with the app installed (no repo): set ELECTRON_RUN_AS_NODE=1 and run the installed exe on this file with
//   --app "C:\Program Files\Booking Manager\resources\app.asar\dist-electron"
//
// What it does not do: write SQL for business rows. The only SQL here reads ids back, and moves the audit rows' `at`
// to the simulated day (the keeper stamps real time; History reads by `at`, so without this a 3-year book would look
// like one afternoon). audit_log refuses UPDATE by trigger, so the two triggers are taken off for the run and put back
// exactly as stored. A seeded database has the PINs Admin 1111 / System 2222 — throwaway data only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SEATS = ['PC01', 'PC02', 'PC03', 'PC04', 'PC05'];
const TOWNS = ['Nagpur', 'Amravati', 'Wardha', 'Akola', 'Washim', 'Pusad', 'Wani', 'Chandrapur', 'Warora', 'Hinganghat', 'Arvi', 'Ralegaon', 'Kelapur', 'Pandharkawada', 'Umarkhed', 'Digras', 'Darwha', 'Ner', 'Babhulgaon', 'Mahagaon', 'Nanded', 'Hingoli', 'Parbhani', 'Jalna', 'Aurangabad', 'Nashik', 'Pune', 'Mumbai', 'Thane', 'Bhiwandi', 'Indore', 'Raipur', 'Hyderabad', 'Adilabad', 'Kinwat', 'Bhandara', 'Gondia', 'Buldhana', 'Khamgaon'];
const FIRM_A = ['Shree', 'Sai', 'Om', 'Jai', 'Ganesh', 'Laxmi', 'Balaji', 'Mahalaxmi', 'Kisan', 'Patil', 'Deshmukh', 'Rathi', 'Agrawal', 'Gupta', 'Jain', 'Kale', 'Pawar', 'Shinde', 'Rane', 'Joshi'];
const FIRM_B = ['Agro', 'Steel', 'Cloth', 'Hardware', 'Paper', 'Grain', 'Cement', 'Plastic', 'Electricals', 'Sanitary', 'Furniture', 'Timber', 'Pipes', 'Paints', 'Tyres', 'Foods', 'Spices', 'Fertilizers', 'Tools', 'Stationers'];
const FIRM_C = ['Traders', 'Enterprises', 'Agencies', 'Brothers', 'Stores'];
const FIRST = ['Ramesh', 'Suresh', 'Mahesh', 'Ganesh', 'Dinesh', 'Rajesh', 'Anil', 'Sunil', 'Vijay', 'Ajay'];
const LAST = ['Pawar', 'Rathod', 'Chavan'];
const GOODS = ['Cloth bales', 'Steel pipes', 'Cement bags', 'Grain sacks', 'Hardware cartons', 'Paper reels', 'Plastic drums', 'Electrical goods', 'Furniture', 'Timber', 'Paint tins', 'Tyres'];
const DIWALI = ['2023-11-12', '2024-11-01', '2025-10-21', '2026-11-08'];
const AGENTS = ['Ramesh Agent', 'Suresh Agent', 'Mahesh Agent', 'Dinesh Agent', 'Rajesh Agent', 'Anil Agent', 'Sunil Agent', 'Vijay Agent'];
const REAL_ROOT = 'c:\\bookingmanagerdata';

/** mulberry32: the same seed gives the same numbers on every machine. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what}: ${r.code} ${JSON.stringify(r.fields ?? r.memoFields ?? r.wasuliFields ?? r.taken ?? r.detail ?? '')}`);
  return r.value;
};

/** Builds the database under `o.root`. Returns the summary text. */
function seed(o) {
  const root = path.resolve(o.root);
  if (root.toLowerCase() === REAL_ROOT) throw new Error('refusing the real data root');
  if (fs.existsSync(path.join(root, 'booking.db'))) throw new Error(`${root} already holds a booking.db; use an empty folder`);
  const app = o.app || path.join(__dirname, '..', 'dist-electron');
  const load = (f) => require(path.join(app, f));
  const { openDatabase } = load('keeper/db.js');
  const { migrate } = load('keeper/migrations.js');
  const { makeMasters } = load('keeper/masters.js');
  const { makeLrs } = load('keeper/lrs.js');
  const { makeMemos } = load('keeper/memos.js');
  const { makeWasuli } = load('keeper/wasuli.js');
  const { makePins } = load('keeper/pins.js');
  const log = o.log || (() => {});
  const started = Date.now();

  const days = o.days ?? 1096;
  const perDay = o.perDay ?? 300;
  const end = o.end ? new Date(`${o.end}T10:30:00`) : new Date();
  const dayAt = (i) => new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1) + i, 10, 30);
  let clock = dayAt(0);
  const now = () => clock;
  const rand = rng(43);
  const int = (n) => Math.floor(rand() * n);
  const pick = (a) => a[int(a.length)];
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const zipf = (n, s) => {
    const cum = [];
    let sum = 0;
    for (let i = 1; i <= n; i++) cum.push((sum += 1 / Math.pow(i, s)));
    return () => {
      const x = rand() * sum;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
  };

  fs.mkdirSync(root, { recursive: true });
  const db = openDatabase(path.join(root, 'booking.db'));
  migrate(db);
  db.pragma('synchronous = OFF'); // this connection only: the bench measures the real keeper, which runs at synchronous=FULL (keeper/db.ts)
  const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").all();
  const dropTriggers = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").all().forEach((t) => db.exec(`DROP TRIGGER ${t.name}`));
  dropTriggers();

  const counts = { lrs: 0, cancelled: 0, edited: 0, memos: 0, memoEdits: 0, memosCancelled: 0, assigned: 0, collected: 0, refused: 0, why: {} };
  let built = false;
  try {
    // The keeper's own PIN code sets the PINs once; every later PIN check is a stub (scrypt costs ~170 ms a check).
    must(makePins().setup(db, 'SEED', '1111', '2222'), 'pins');
    const pins = { verify: () => ({ ok: true, value: true }) };
    const masters = makeMasters(pins);
    const lrs = makeLrs(pins, masters, now);
    const memos = makeMemos(pins, now);
    const wasuli = makeWasuli(pins, now);

    let auditBase = 0;
    // The rows written since the last call belong to `date`: spread over 04:00-13:00 UTC (about 09:30-18:30 local).
    const backdate = (date) => {
      const max = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m;
      const n = max - auditBase;
      if (n > 0) db.prepare("UPDATE audit_log SET at = @day || 'T' || time(14400 + ((id - @base - 1) * 32400) / @n, 'unixepoch') || '.000Z' WHERE id > @base").run({ day: date, base: auditBase, n });
      auditBase = max;
    };

    // ---- masters ----
    const make = (kind, fields) => must(masters.create(db, 'SEED', kind, fields, true), `${kind} ${JSON.stringify(fields)}`).id;
    const stationIds = ['Yavatmal', ...TOWNS].map((name) => make('stations', { name }));
    const from = stationIds[0];
    const towns = stationIds.slice(1);
    const firmIds = [];
    for (let i = 0; i < 400; i++) firmIds.push(make('firms', { name: `${FIRM_A[i % 20]} ${FIRM_B[Math.floor(i / 20)]} ${FIRM_C[i % 5]}`, stationId: pick(stationIds) }));
    const truckIds = Array.from({ length: 60 }, (_, i) => make('trucks', { number: `MH 29 BE ${1000 + i * 7}` }));
    const driverIds = Array.from({ length: 30 }, (_, i) => make('drivers', { name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10)]}`, phone: `98${String(10000000 + i * 1234567).slice(0, 8)}` }));
    const agentIds = AGENTS.map((name) => make('agents', { name }));
    must(lrs.setDefaults(db, 'SEED', { bookingStationId: from }, '1111'), 'defaults');
    backdate(iso(new Date(dayAt(0).getTime() - 86400000)));

    const walkIns = Array.from({ length: 300 }, (_, i) => `${FIRST[i % 10]} ${FIRM_B[(i * 7) % 20]} & Sons ${100 + i}`);
    const pickFirm = zipf(400, 0.7); // firm 0 is by far the biggest
    const pickTown = zipf(39, 0.8);

    // ---- the days ----
    const later = new Map(); // day index -> things to do that day
    const after = (d, fn) => later.set(d, [...(later.get(d) ?? []), fn]);
    const inputs = new Map(); // lr id -> the LrInput it was saved with (kept a week, for the later edits)
    const pending = new Map(); // To station -> booked LRs waiting for a truck, oldest first
    const wasuliPool = [];
    let n = 0;
    const attempt = (r) => {
      if (!r.ok) {
        const why = r.code + ' ' + JSON.stringify(r.fields ?? r.memoFields ?? r.wasuliFields ?? '');
        counts.refused++;
        counts.why[why] = 1 + (counts.why[why] ?? 0);
      }
      return r.ok;
    };
    const seenOf = (lrId) => db.prepare('SELECT id, status, agent_id AS agentId, version FROM wasuli WHERE lr_id = ?').get(lrId);
    const versionOf = (table, id) => db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id).version;
    const party = () => (rand() < 0.15 ? { firmId: null, name: pick(walkIns), addToFirms: false } : { firmId: firmIds[pickFirm()], name: '', addToFirms: false });

    for (let d = 0; d < days; d++) {
      clock = dayAt(d);
      const date = iso(clock);
      for (const fn of later.get(d) ?? []) fn();
      later.delete(d);

      // how many LRs today
      const diwali = DIWALI.some((x) => Math.abs((new Date(`${x}T10:30:00`) - clock) / 86400000) <= 3);
      const weight = (clock.getDay() === 0 ? 0.25 : 1) * (diwali ? 1.6 : 1);
      const todays = [];
      const total = Math.max(1, Math.round(perDay * weight * (1 + 0.27 * gauss())));
      for (let k = 0; k < total; k++) {
        const qty = 1 + Math.floor(rand() * rand() * 20);
        const freight = String(100 + Math.round(rand() * rand() * 19900));
        const input = {
          uid: `seed-lr-${++n}`, date: null, fromStationId: from, toStationId: towns[pickTown()],
          consignor: party(), consignee: party(), particular: pick(GOODS), qty: String(qty),
          toPay: rand() < 0.7 ? freight : '', paid: '',
          hamali: rand() < 0.6 ? String(qty * 10) : '', // typed on the LR, as the clerks do
          wasuli: rand() < 0.3 ? String(300 + int(2700)) : '',
        };
        if (input.toPay === '') input.paid = freight;
        const saved = must(lrs.create(db, pick(SEATS), input), `lr ${n}`);
        counts.lrs++;
        todays.push({ id: saved.row.id, input, to: input.toStationId, loadable: rand() >= 0.08, cancelled: false });
        inputs.set(saved.row.id, input);
      }
      // 2 % are cancelled, 3 % edited, all before any truck is loaded
      for (const lr of todays) {
        const roll = rand();
        if (roll < 0.02) {
          if (attempt(lrs.cancel(db, pick(SEATS), lr.id, versionOf('lrs', lr.id), 'Entered twice', ''))) {
            lr.cancelled = true;
            counts.cancelled++;
          }
        } else if (roll < 0.05) {
          const input = { ...lr.input, qty: String(Number(lr.input.qty) + 1), ...(lr.input.toPay ? { toPay: String(Number(lr.input.toPay) + 50) } : { paid: String(Number(lr.input.paid) + 50) }) };
          if (attempt(lrs.update(db, pick(SEATS), lr.id, versionOf('lrs', lr.id), input, ''))) {
            lr.input = input;
            inputs.set(lr.id, input);
            counts.edited++;
          }
        }
      }
      for (const lr of todays) {
        if (lr.cancelled) continue;
        if (lr.loadable) {
          if (!pending.has(lr.to)) pending.set(lr.to, []);
          pending.get(lr.to).push({ id: lr.id, to: lr.to, day: d });
        }
      }

      // wasuli: what was booked on an earlier day goes to an agent; most of it comes back within ten days
      const ready = wasuliPool.splice(0);
      for (const t of todays) if (t.input.wasuli !== '' && !t.cancelled) wasuliPool.push(t.id);
      while (ready.length) {
        const batch = ready.splice(0, 25).map(seenOf).filter((s) => s && s.status === 'unassigned');
        if (batch.length === 0) continue;
        const agent = pick(agentIds);
        if (!attempt(wasuli.assign(db, pick(SEATS), batch, agent))) continue;
        counts.assigned += batch.length;
        for (const s of batch) {
          if (rand() >= 0.8) continue;
          after(Math.min(days - 1, d + 1 + int(10)), () => {
            const cur = db.prepare('SELECT id, status, agent_id AS agentId, version, amount_paise AS amount FROM wasuli WHERE id = ?').get(s.id);
            if (!cur || cur.status !== 'assigned') return;
            const paise = rand() < 0.2 ? Math.max(100, Math.round(cur.amount / 2 / 100) * 100) : cur.amount;
            if (attempt(wasuli.collect(db, pick(SEATS), cur, { amount: (paise / 100).toFixed(2), mode: pick(['cash', 'cash', 'upi', 'card']), remark: '' }))) counts.collected++;
          });
        }
      }

      // memos: a truck leaves when 10 LRs wait for a place, or the oldest has waited two days
      for (const [station, list] of pending) {
        while (list.length >= 10 || (list.length > 0 && d - list[0].day >= 2)) {
          const chunk = list.splice(0, list.length < 10 ? list.length : Math.min(list.length, 10 + int(51)));
          const memo = must(
            memos.create(db, pick(SEATS), {
              uid: `seed-memo-${counts.memos + 1}`, date: null, truckId: pick(truckIds), driverId: pick(driverIds), fromStationId: from, toStationId: station,
              truckHire: String(3000 + int(27000)), loadingHamali: String(100 + int(700)), lrIds: chunk.map((c) => c.id),
            }),
            `memo ${counts.memos + 1}`,
          );
          counts.memos++;
          const roll = rand();
          if (roll < 0.01) {
            // one of its LRs is edited a few days later: the memo now differs from its LRs
            after(Math.min(days - 1, d + 1 + int(5)), () => {
              const target = chunk[0].id;
              const input = inputs.get(target);
              if (!input) return;
              const edited = { ...input, qty: String(Number(input.qty) + 1) };
              if (attempt(lrs.update(db, pick(SEATS), target, versionOf('lrs', target), edited, ''))) {
                inputs.set(target, edited);
                counts.memoEdits++;
              }
            });
          } else if (roll < 0.015) {
            // the truck did not go: its LRs wait again
            after(Math.min(days - 1, d + 1 + int(3)), () => {
              if (attempt(memos.cancel(db, pick(SEATS), memo.id, versionOf('memos', memo.id), 'Truck did not go', ''))) {
                counts.memosCancelled++;
                for (const c of chunk) {
                  if (!pending.has(c.to)) pending.set(c.to, []);
                  pending.get(c.to).push({ ...c, day: Math.min(days - 1, d + 1) });
                }
              }
            });
          }
        }
      }

      backdate(date);
      if (d % 30 === 29 || d === days - 1) {
        // inputs are needed for a week only: drop the oldest ids (ids grow with time)
        const keep = counts.lrs - perDay * 8;
        for (const id of inputs.keys()) if (id <= keep) inputs.delete(id);
        else break;
        log(`day ${d + 1}/${days} (${date}): ${counts.lrs} LRs, ${counts.memos} memos, ${((Date.now() - started) / 60000).toFixed(1)} min`);
      }
    }
    // the cancelled memos' LRs and the last collections after the final day are simply left as they are
    backdate(iso(clock));
    built = true;
  } finally {
    dropTriggers();
    for (const t of triggers) db.exec(t.sql);
    if (!built) db.close(); // a failed run leaves no open file behind
  }

  // ---- database health ----
  db.pragma('wal_checkpoint(TRUNCATE)');
  const one = (sql) => db.prepare(sql).get();
  const by = (table) => Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`).all().map((r) => [r.status, r.n]));
  const triggersBack = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").get().n;
  const t0 = Date.now();
  const integrity = db.pragma('integrity_check', { simple: true });
  const integrityMs = Date.now() - t0;
  const summary = {
    root, days, perDay, end: iso(end),
    lrs: by('lrs'), memos: by('memos'), wasuli: by('wasuli'),
    firms: one('SELECT COUNT(*) AS n FROM firms').n, stations: one('SELECT COUNT(*) AS n FROM stations').n, trucks: one('SELECT COUNT(*) AS n FROM trucks').n,
    drivers: one('SELECT COUNT(*) AS n FROM drivers').n, agents: one('SELECT COUNT(*) AS n FROM agents').n,
    auditRows: one('SELECT COUNT(*) AS n FROM audit_log').n, auditTriggers: triggersBack,
    firstDate: one('SELECT MIN(lr_date) AS d FROM lrs').d, lastDate: one('SELECT MAX(lr_date) AS d FROM lrs').d,
    biggestFirm: one('SELECT consignor_id AS id, COUNT(*) AS n FROM lrs WHERE consignor_id IS NOT NULL GROUP BY consignor_id ORDER BY n DESC LIMIT 1'),
    made: counts, integrity, integrityMs,
  };
  db.close();
  summary.fileMB = Math.round(fs.statSync(path.join(root, 'booking.db')).size / 1048576);
  if (o.vacuum !== false) {
    const copy = path.join(root, 'vacuum-test.db');
    fs.copyFileSync(path.join(root, 'booking.db'), copy);
    const v = openDatabase(copy);
    const t1 = Date.now();
    v.exec('VACUUM');
    summary.vacuumSeconds = Math.round((Date.now() - t1) / 100) / 10;
    v.close();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(copy + s, { force: true });
  }
  summary.minutes = Math.round((Date.now() - started) / 6000) / 10;
  const text = Object.entries(summary).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'seed-summary.txt'), text);
  return { summary, text };
}

module.exports = { seed };

if (require.main === module) {
  if (!process.versions.electron) {
    // better-sqlite3 is built for Electron's Node: run this file again under Electron-as-node.
    const r = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    process.exit(r.status ?? 1);
  }
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--end', '--days', '--per-day', '--app'].includes(args[i - 1])));
  if (!root) {
    console.error('usage: seed-load.cjs <empty folder> [--end YYYY-MM-DD] [--days n] [--per-day n] [--app <dist-electron>] [--no-vacuum]');
    process.exit(1);
  }
  try {
    const out = seed({ root, end: opt('--end'), days: opt('--days') ? Number(opt('--days')) : undefined, perDay: opt('--per-day') ? Number(opt('--per-day')) : undefined, app: opt('--app'), vacuum: !args.includes('--no-vacuum'), log: console.log });
    console.log('\n' + out.text);
  } catch (e) {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  }
}

// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeeperResult } from '../shared';
import { DASHBOARD_SQL, makeDashboard } from './dashboard';
import type { Db } from './db';
import { freshDb, insert, insertLr, insertMemo, insertStation, insertTruck } from './testing';

const TODAY = '2026-10-30';
const dash = makeDashboard(() => new Date(2026, 9, 30, 12, 0, 0));
const value = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : r.code);
  return r.value;
};

interface Spec {
  date?: string;
  status?: 'booked' | 'loaded' | 'cancelled';
  qty?: number;
  to?: number;
  no?: number;
  consignee?: string;
}
let memoNo = 5000;
/** One LR; a loaded one needs a memo, so it gets its own. */
function lr(db: Db, s: Spec = {}): number {
  const date = s.date ?? TODAY;
  const status = s.status ?? 'booked';
  const over: Record<string, unknown> = { lr_date: date, lr_year: Number(date.slice(0, 4)), status, qty: s.qty ?? 1 };
  if (s.to !== undefined) over.to_station_id = s.to;
  if (s.no !== undefined) over.lr_no = s.no;
  if (s.consignee !== undefined) over.consignee_name = s.consignee;
  if (status === 'loaded') over.memo_id = insertMemo(db, { memo_date: date, challan_no: ++memoNo });
  return insertLr(db, over);
}

function seedDay(db: Db) {
  const a = insertStation(db, 'Amravati');
  const b = insertStation(db, 'Nagpur');
  // today: 3 booked (qty 1+2+3), 2 loaded (4+5), 1 cancelled (100)
  lr(db, { qty: 1, to: a });
  lr(db, { qty: 2, to: a });
  lr(db, { qty: 3, to: b });
  lr(db, { qty: 4, status: 'loaded', to: b });
  lr(db, { qty: 5, status: 'loaded', to: b });
  lr(db, { qty: 100, status: 'cancelled', to: b });
  // an older day: 2 more booked (7+8), one loaded and one cancelled that are not pending
  lr(db, { date: '2026-10-20', qty: 7, to: a });
  lr(db, { date: '2026-10-22', qty: 8, to: b });
  lr(db, { date: '2026-10-21', qty: 50, status: 'loaded', to: a });
  lr(db, { date: '2026-10-21', qty: 60, status: 'cancelled', to: a });
  return { a, b };
}

test('summary: the day\'s LRs by status, cancelled kept out of the quantity, pending counted across days', () => {
  const db = freshDb();
  seedDay(db);
  const s = value(dash.summary(db, null));
  assert.deepEqual(s, {
    date: TODAY,
    booked: 3,
    loaded: 2,
    cancelled: 1,
    qty: 15, // 1+2+3+4+5; the cancelled 100 is out
    pending: 5, // 3 today + 2 older
    pendingQty: 21, // 1+2+3+7+8
    oldestPending: '2026-10-20',
    pendingStations: 2,
    memos: 2, // the two memos made for today's loaded LRs
    trucksOut: 2,
  });
});

test('summary: an empty database is all zeros and no oldest date', () => {
  const s = value(dash.summary(freshDb(), null));
  assert.deepEqual(s, { date: TODAY, booked: 0, loaded: 0, cancelled: 0, qty: 0, pending: 0, pendingQty: 0, oldestPending: null, pendingStations: 0, memos: 0, trucksOut: 0 });
});

test('summary: another day, and a bad date means today', () => {
  const db = freshDb();
  seedDay(db);
  const other = value(dash.summary(db, '2026-10-21'));
  assert.equal(other.date, '2026-10-21');
  assert.equal(other.loaded, 1);
  assert.equal(other.cancelled, 1);
  assert.equal(other.booked, 0);
  assert.equal(other.qty, 50);
  assert.equal(other.pending, 5); // pending is never tied to the day
  assert.equal(value(dash.summary(db, 'not a date')).date, TODAY);
});

test('summary: memos and trucks out count saved memos of the day, a truck once, cancelled memos not', () => {
  const db = freshDb();
  const truck = insertTruck(db, 'MH 29 AA 1');
  insertMemo(db, { memo_date: TODAY, truck_id: truck });
  insertMemo(db, { memo_date: TODAY, truck_id: truck });
  insertMemo(db, { memo_date: TODAY, status: 'cancelled' });
  insertMemo(db, { memo_date: '2026-10-29' });
  const s = value(dash.summary(db, null));
  assert.equal(s.memos, 2);
  assert.equal(s.trucksOut, 1);
});

test('pending by station: most LRs first, then name; only booked LRs; the quantity is summed', () => {
  const db = freshDb();
  const wani = insertStation(db, 'Wani');
  const akola = insertStation(db, 'Akola');
  const pune = insertStation(db, 'Pune');
  lr(db, { to: wani, qty: 2 });
  lr(db, { to: wani, qty: 3, date: '2026-10-01' });
  lr(db, { to: akola, qty: 4 });
  lr(db, { to: pune, qty: 6 });
  lr(db, { to: pune, qty: 100, status: 'cancelled' });
  lr(db, { to: pune, qty: 100, status: 'loaded' });
  assert.deepEqual(value(dash.pendingByStation(db)), [
    { stationId: wani, station: 'Wani', lrs: 2, qty: 5 },
    { stationId: akola, station: 'Akola', lrs: 1, qty: 4 }, // ties by name: Akola before Pune
    { stationId: pune, station: 'Pune', lrs: 1, qty: 6 },
  ]);
});

test('pending by station stops at 20 stations', () => {
  const db = freshDb();
  for (let i = 1; i <= 25; i++) lr(db, { to: insertStation(db, `Station ${String(i).padStart(2, '0')}`) });
  const rows = value(dash.pendingByStation(db));
  assert.equal(rows.length, 20);
  assert.equal(rows[0].station, 'Station 01');
});

test('recent LRs: the newest 8 of today by number, cancelled ones shown with their status', () => {
  const db = freshDb();
  for (let n = 1; n <= 10; n++) lr(db, { no: n, consignee: `Firm ${n}` });
  lr(db, { no: 11, consignee: 'Old', date: '2026-10-29' });
  lr(db, { no: 12, consignee: 'Cancelled', status: 'cancelled' });
  const rows = value(dash.recentLrs(db));
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((r) => r.lrNo),
    [12, 10, 9, 8, 7, 6, 5, 4],
  );
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[1].consignee, 'Firm 10');
  assert.ok(rows[1].toStation);
});

test('no answer carries an amount', () => {
  const db = freshDb();
  seedDay(db);
  insert(db, 'firms', { name: 'x', name_key: 'x', seat: 't' });
  const all = JSON.stringify([dash.summary(db, null), dash.pendingByStation(db), dash.recentLrs(db)]);
  assert.doesNotMatch(all, /"[^"]*(paise|amount|total|pay|paid|rupee)[^"]*":/i);
});

test('every dashboard statement is answered from an index, never a scan of lrs or memos', () => {
  const db = freshDb();
  for (const [name, sql] of Object.entries(DASHBOARD_SQL)) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(sql.includes('@d') ? { d: TODAY } : []) as { detail: string }[]).map((r) => r.detail);
    for (const line of plan) {
      assert.doesNotMatch(line, /^SCAN (?!CONSTANT)/, `${name}: ${line}`);
    }
    assert.ok(plan.some((l) => /^SEARCH .* USING (COVERING )?INDEX/.test(l)), `${name}: ${plan.join(' | ')}`);
  }
});

test('speed: the summary over 20 000 LRs answers in under 50 ms', () => {
  const db = freshDb();
  const stations = Array.from({ length: 30 }, (_, i) => insertStation(db, `Town ${i}`));
  const put = db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, status, seat)
     VALUES (?, 2026, ?, ?, 'A', 'B', ?, ?, 'Cloth', 3, ?, 't')`,
  );
  db.transaction(() => {
    for (let i = 1; i <= 20000; i++) {
      const day = 1 + (i % 60); // 60 days, 333 LRs a day
      const date = day <= 30 ? `2026-10-${String(day).padStart(2, '0')}` : `2026-09-${String(day - 30).padStart(2, '0')}`;
      put.run(`u${i}`, i, date, stations[0], stations[i % 30], i % 7 === 0 ? 'cancelled' : 'booked');
    }
  })();
  dash.summary(db, null); // prepare once
  const t0 = performance.now();
  const s = value(dash.summary(db, null));
  const took = performance.now() - t0;
  assert.ok(s.pending > 10000);
  assert.ok(took < 50, `summary took ${took.toFixed(1)} ms`);
  const t1 = performance.now();
  value(dash.pendingByStation(db));
  value(dash.recentLrs(db));
  assert.ok(performance.now() - t1 < 100);
  console.log(`# summary over 20000 LRs: ${took.toFixed(1)} ms`);
});

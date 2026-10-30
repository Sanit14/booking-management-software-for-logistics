// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeeperResult, SearchAnswer } from '../shared';
import type { Db } from './db';
import { nameKey } from './names';
import { truckKey } from './masterRules';
import { SEARCH_SQL, search } from './search';
import { freshDb, insert, insertLr, insertStation } from './testing';

const NOW = () => new Date(2026, 9, 30, 12, 0, 0);
const find = (db: Db, text: string): SearchAnswer => {
  const r: KeeperResult<SearchAnswer> = search(db, text, NOW);
  assert.ok(r.ok);
  return r.value;
};
const firm = (db: Db, name: string, over: Record<string, unknown> = {}) => insert(db, 'firms', { name, name_key: nameKey(name), seat: 't', ...over });
const truck = (db: Db, number: string, over: Record<string, unknown> = {}) => insert(db, 'trucks', { number, number_key: truckKey(number), seat: 't', ...over });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

const EMPTY: SearchAnswer = { lrs: [], firms: [], trucks: [], stations: [] };

test('no text, or only spaces, finds nothing', () => {
  const db = freshDb();
  firm(db, 'Kale');
  assert.deepEqual(find(db, ''), EMPTY);
  assert.deepEqual(find(db, '   '), EMPTY);
});

test('an LR number: this year first, then last year; any other year is not found', () => {
  const db = freshDb();
  const to = insertStation(db, 'Nagpur');
  insertLr(db, { lr_year: 2025, lr_date: '2025-12-30', lr_no: 1234, to_station_id: to, consignee_name: 'Last Year Co', status: 'cancelled' });
  insertLr(db, { lr_year: 2026, lr_date: '2026-10-30', lr_no: 1234, to_station_id: to, consignee_name: 'This Year Co' });
  insertLr(db, { lr_year: 2024, lr_date: '2024-05-05', lr_no: 1234, to_station_id: to });
  insertLr(db, { lr_year: 2026, lr_date: '2026-10-30', lr_no: 12345 });
  const lrs = find(db, ' 1234 ').lrs;
  assert.deepEqual(
    lrs.map((l) => [l.lrYear, l.lrNo, l.consignee, l.toStation, l.status, l.date]),
    [
      [2026, 1234, 'This Year Co', 'Nagpur', 'booked', '2026-10-30'],
      [2025, 1234, 'Last Year Co', 'Nagpur', 'cancelled', '2025-12-30'],
    ],
  );
  assert.deepEqual(find(db, '99999').lrs, []);
  assert.deepEqual(find(db, 'abc').lrs, []);
  assert.deepEqual(find(db, '12345678901234567890').lrs, []); // too long to be an LR number
});

test('firms: a name that starts like the text comes before one that only contains it; spacing and case do not matter', () => {
  const db = freshDb();
  firm(db, 'Patil Kale Traders');
  firm(db, 'Kale Brothers');
  firm(db, 'Ankale Co');
  firm(db, 'Unrelated');
  assert.deepEqual(names(find(db, 'kale').firms), ['Kale Brothers', 'Ankale Co', 'Patil Kale Traders']);
  assert.deepEqual(names(find(db, '  KALE   bro ').firms), ['Kale Brothers']);
});

test('firms: prefix and contains together stop at 5, prefix first', () => {
  const db = freshDb();
  for (const n of ['Kale 1', 'Kale 2', 'Kale 3', 'Zkale', 'Akale', 'Mkale']) firm(db, n);
  assert.deepEqual(names(find(db, 'kale').firms), ['Kale 1', 'Kale 2', 'Kale 3', 'Akale', 'Mkale']);
});

test('firms: at most 5, % and _ are plain letters, the station is named, an inactive firm is flagged', () => {
  const db = freshDb();
  const wani = insertStation(db, 'Wani');
  for (let i = 1; i <= 8; i++) firm(db, `Shree ${i}`);
  firm(db, '100% Cotton', { station_id: wani });
  firm(db, 'Shree Old', { active: 0 });
  const shree = find(db, 'shree').firms;
  assert.equal(shree.length, 5);
  assert.equal(shree[0].station, null);
  assert.deepEqual(names(find(db, '%').firms), ['100% Cotton']);
  assert.deepEqual(find(db, '%').firms[0].station, 'Wani');
  assert.deepEqual(names(find(db, '_').firms), []);
  const old = find(db, 'shree old').firms;
  assert.deepEqual(old.map((f) => [f.name, f.active]), [['Shree Old', false]]);
});

test('trucks: any part of the number, however it was typed', () => {
  const db = freshDb();
  truck(db, 'MH 29 BE 1234');
  truck(db, 'MH 32 AJ 8812');
  truck(db, 'MH 29 T 5503', { active: 0 });
  assert.deepEqual(find(db, '1234').trucks.map((t) => t.number), ['MH 29 BE 1234']);
  assert.deepEqual(find(db, 'mh-29 ').trucks.map((t) => t.number), ['MH 29 BE 1234', 'MH 29 T 5503']);
  assert.equal(find(db, 'mh-29 ').trucks[1].active, false);
  assert.deepEqual(find(db, '- .').trucks, []); // nothing left of it once spaces, dots and dashes go
  assert.deepEqual(find(db, 'zzz').trucks, []);
});

test('stations: by their first letters only', () => {
  const db = freshDb();
  insertStation(db, 'Nagpur');
  insertStation(db, 'Nanded');
  insertStation(db, 'Wani');
  assert.deepEqual(names(find(db, 'na').stations), ['Nagpur', 'Nanded']);
  assert.deepEqual(names(find(db, 'gpur').stations), []);
  assert.deepEqual(names(find(db, 'WA').stations), ['Wani']);
});

test('each kind answers on its own: a number can be an LR and a truck at once', () => {
  const db = freshDb();
  insertLr(db, { lr_no: 1234 });
  truck(db, 'MH 29 BE 1234');
  const a = find(db, '1234');
  assert.equal(a.lrs.length, 1);
  assert.equal(a.trucks.length, 1);
  assert.equal(a.firms.length + a.stations.length, 0);
});

test('no answer carries an amount', () => {
  const db = freshDb();
  insertLr(db, { lr_no: 7, topay_paise: 150000 });
  assert.doesNotMatch(JSON.stringify(find(db, '7')), /"[^"]*(paise|amount|total|pay|paid|rupee)[^"]*":/i);
});

test('every lookup is an index search; only the firm and truck "contains" read their small master table; none touches lrs by scan', () => {
  const db = freshDb();
  const all: Record<string, unknown> = { k: 'a', hi: 'a\u{10FFFF}', n: 5 };
  // Only the parameters a statement names (better-sqlite3 refuses extra ones in some forms).
  const given = (sql: string) => (sql.includes('l.lr_year = ?') ? [2026, 1] : Object.fromEntries(Object.entries(all).filter(([k]) => sql.includes(`@${k}`))));
  const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(given(sql)) as { detail: string }[]).map((r) => r.detail);
  for (const [name, sql] of Object.entries(SEARCH_SQL)) {
    const lines = plan(sql);
    const scans = lines.filter((l) => /^SCAN /.test(l));
    if (name === 'firmContains') assert.ok(scans.length === 1 && /^SCAN (TABLE )?(f|firms)\b/.test(scans[0]), `${name}: ${lines.join(' | ')}`);
    else if (name === 'truck') assert.ok(scans.length === 1 && /^SCAN (TABLE )?trucks\b/.test(scans[0]), `${name}: ${lines.join(' | ')}`);
    else {
      assert.deepEqual(scans, [], `${name}: ${lines.join(' | ')}`);
      assert.ok(lines.some((l) => /^SEARCH .* USING (COVERING )?INDEX/.test(l)), `${name}: ${lines.join(' | ')}`);
    }
  }
});

test('speed: 3 000 firms and 20 000 LRs, every kind of search under 100 ms', () => {
  const db = freshDb();
  const stations = Array.from({ length: 30 }, (_, i) => insertStation(db, `Town ${i}`));
  const putFirm = db.prepare("INSERT INTO firms (name, name_key, seat) VALUES (?, ?, 't')");
  const putTruck = db.prepare("INSERT INTO trucks (number, number_key, seat) VALUES (?, ?, 't')");
  const putLr = db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, seat)
     VALUES (?, ?, ?, ? || '-10-01', 'A', 'B', ?, ?, 'Cloth', 3, 't')`,
  );
  db.transaction(() => {
    for (let i = 0; i < 3000; i++) putFirm.run(`Firm ${i} Traders`, nameKey(`Firm ${i} Traders`));
    for (let i = 0; i < 300; i++) putTruck.run(`MH 29 AB ${1000 + i}`, truckKey(`MH 29 AB ${1000 + i}`));
    for (let i = 1; i <= 20000; i++) {
      const year = i <= 10000 ? 2025 : 2026;
      putLr.run(`u${i}`, year, i % 10000 || 10000, String(year), stations[0], stations[i % 30]);
    }
  })();
  find(db, 'warm');
  for (const text of ['4321', 'firm 12', 'traders', 'zzzz no match', '1234', 'town 2', 'mh 29 ab 1100']) {
    const t0 = performance.now();
    find(db, text);
    const took = performance.now() - t0;
    assert.ok(took < 100, `"${text}" took ${took.toFixed(1)} ms`);
  }
  const t = performance.now();
  find(db, 'traders'); // the worst case: a contains scan over all 3 000 firms
  console.log(`# search "traders" over 3000 firms / 20000 LRs: ${(performance.now() - t).toFixed(1)} ms`);
});

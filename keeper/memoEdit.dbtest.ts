// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Saved memos (3.2): the list, the header edit, taking LRs off / moving / adding, "differs", recalculate, cancel, history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult, LrInput, MemoDetail, MemoHeaderInput, SavedMemoFilters } from '../shared';
import { makeDashboard } from './dashboard';
import { savedSql } from './memos';
import { ADMIN, SYSTEM, book, create, lrInput, now, refused, saved, setUp, type Set } from './memoTesting';
import { fastest, insertStation } from './testing';

const none: SavedMemoFilters = { from: null, to: null, truckId: null, toStationId: null };
const n = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const got = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.memoFields ?? r.taken ?? r.fields ?? '')}`);
  return r.value;
};

/** A memo of `count` booked LRs (through the real saves), with the memo as the keeper reads it. */
function memoOf(s: Set, count: number, over: Parameters<typeof create>[2] = {}, lrOver: Partial<LrInput> = {}) {
  const lrs = Array.from({ length: count }, () => book(s, lrOver));
  const made = saved(create(s, lrs.map((l) => l.id), over));
  return { id: made.id, no: made.challanNo, lrs, get: () => got(s.memos.get(s.db, made.id)) };
}
/** Everything a change may write, as one string, to prove a refusal wrote nothing. */
const footprint = (s: Set) =>
  JSON.stringify({
    memos: s.db.prepare('SELECT id, status, version, memo_date, truck_id, driver_id, from_station_id, to_station_id, truck_hire_paise, loading_hamali_paise, frozen_lr_count, frozen_qty, frozen_topay_paise, frozen_paid_paise, frozen_charges_paise, frozen_stax_paise FROM memos ORDER BY id').all(),
    audit: n(s, 'audit_log'),
    counters: s.db.prepare('SELECT name, year, last FROM counters ORDER BY name, year').all(),
    lrs: s.db.prepare('SELECT id, status, memo_id, version FROM lrs ORDER BY id').all(),
  });
const header = (m: MemoDetail, over: Partial<MemoHeaderInput> = {}): MemoHeaderInput => ({
  date: m.date, truckId: m.truckId, driverId: m.driverId, fromStationId: m.fromStationId, toStationId: m.toStationId,
  truckHire: String(m.truckHirePaise / 100), loadingHamali: String(m.loadingHamaliPaise / 100), ...over,
});
const lrStatus = (s: Set, id: number) => s.db.prepare('SELECT status, memo_id AS memoId, version FROM lrs WHERE id = ?').get(id) as { status: string; memoId: number | null; version: number };
const pendingNos = (s: Set) => {
  const r = got(s.memos.pending(s.db, { from: null, to: null, toStationId: null, consignor: null, consignee: null }, null));
  return r.rows.map((x) => x.lrNo);
};
const lastAudit = (s: Set, count = 1) =>
  s.db.prepare('SELECT seat, action, entity, entity_id AS entityId, before_json AS before, after_json AS after FROM audit_log ORDER BY id DESC LIMIT ?').all(count) as {
    seat: string; action: string; entity: string; entityId: string; before: string | null; after: string | null;
  }[];

// ---- get / differs ----

test('get: a fresh memo shows its frozen totals and the totals now, equal, and does not differ', () => {
  const s = setUp();
  const m = memoOf(s, 3, {}, { staxPercent: '5', godownBhada: '10', hamali: '4' });
  const d = m.get();
  assert.deepEqual(d.now, d.frozen);
  assert.equal(d.differs, false);
  assert.equal(d.frozen.lrs, 3);
  assert.ok(d.frozen.staxPaise > 0 && d.frozen.chargesPaise > 0);
});

test('differs: an LR edit that changes count, quantity, to pay, paid, charges or tax makes the memo differ; one that changes none of them does not', () => {
  const s = setUp();
  const m = memoOf(s, 2);
  const target = m.lrs[0].id;
  const edit = (over: Partial<LrInput>) => {
    const cur = got(s.lrs.get(s.db, target));
    const r = s.lrs.update(s.db, 'seat-1', target, cur.version, lrInput(s, { qty: String(cur.qty), toPay: String(cur.toPayPaise / 100), ...over }), SYSTEM);
    got(r);
  };
  edit({ particular: 'Steel pipes' }); // not part of the totals
  assert.equal(m.get().differs, false);
  const flags: [string, Partial<LrInput>][] = [
    ['qty', { qty: '4' }],
    ['to pay', { qty: '4', toPay: '2,000' }],
    ['paid', { qty: '4', toPay: '', paid: '700' }],
    ['charges', { qty: '4', toPay: '', paid: '700', godownBhada: '15' }],
    ['tax', { qty: '4', toPay: '', paid: '700', godownBhada: '15', staxPercent: '12' }],
  ];
  for (const [name, over] of flags) {
    edit(over);
    assert.equal(m.get().differs, true, name);
    assert.equal(got(s.memos.list(s.db, none, null)).rows.find((r) => r.id === m.id)?.differs, true, `${name} (list)`);
  }
  // putting it back to what it was clears the difference with no recalculation: it is computed when read
  edit({ qty: '3', toPay: '1,800', paid: '', godownBhada: '', staxPercent: '0' });
  assert.equal(m.get().differs, false);
  assert.equal(got(s.memos.list(s.db, none, null)).rows.find((r) => r.id === m.id)?.differs, false);
});

// ---- the list ----

test('list: newest first by (date, challan number), every filter, 100 a page with a cursor, differs and status per row', () => {
  const s = setUp();
  const old = memoOf(s, 1, { date: '2026-10-20', systemPin: SYSTEM });
  const a = memoOf(s, 1);
  const b = memoOf(s, 2, { truckId: s.truck2, toStationId: s.amravati });
  const mid = memoOf(s, 1, { date: '2026-10-25', systemPin: SYSTEM });
  const all = got(s.memos.list(s.db, none, null));
  // 31-10: challan 3 then 2; 25-10: challan 4; 20-10: challan 1 (the numbers follow the order they were saved in)
  assert.deepEqual(all.rows.map((r) => r.challanNo), [b.no, a.no, mid.no, old.no]);
  assert.equal(all.next, null);
  assert.deepEqual(Object.keys(all.rows[0]).sort(), ['challanNo', 'challanYear', 'date', 'differs', 'driver', 'id', 'lrCount', 'qty', 'status', 'toStation', 'truck'].sort());
  const row = all.rows[0];
  assert.deepEqual([row.truck, row.driver, row.toStation, row.lrCount, row.qty, row.status, row.differs], ['MH 29 AB 1', 'Ramesh Pawar', 'Amravati', 2, 6, 'saved', false]);
  const f = (over: Partial<SavedMemoFilters>) => got(s.memos.list(s.db, { ...none, ...over }, null)).rows.map((r) => r.challanNo);
  assert.deepEqual(f({ from: '2026-10-25' }), [b.no, a.no, mid.no]);
  assert.deepEqual(f({ to: '2026-10-25' }), [mid.no, old.no]);
  assert.deepEqual(f({ from: '2026-10-21', to: '2026-10-30' }), [mid.no]);
  assert.deepEqual(f({ truckId: s.truck2 }), [b.no]);
  assert.deepEqual(f({ toStationId: s.amravati }), [b.no]);
  assert.deepEqual(f({ toStationId: s.nagpur, from: '2026-10-31' }), [a.no]);
  // a cancelled memo stays listed, with its status and never "differs"
  got(s.memos.cancel(s.db, 'seat-1', a.id, a.get().version, 'wrong truck', ADMIN));
  const after = got(s.memos.list(s.db, none, null)).rows.find((r) => r.id === a.id);
  assert.deepEqual([after?.status, after?.differs], ['cancelled', false]);
});

test('list: the cursor goes on exactly where the page ended, across 1 January too', () => {
  const s = setUp();
  const station = insertStation(s.db, 'Hinganghat');
  const put = s.db.prepare(
    `INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id, seat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 't')`,
  );
  s.db.transaction(() => {
    for (let i = 1; i <= 60; i++) put.run(`old-${i}`, 2025, i, '2025-12-31', s.truck, s.driver, s.yavatmal, station); // challans 1 to 60 of 2025
    for (let i = 1; i <= 150; i++) put.run(`new-${i}`, 2026, i, i % 2 ? '2026-01-01' : '2026-01-02', s.truck, s.driver, s.yavatmal, station);
  })();
  const seen: { date: string; no: number }[] = [];
  let cursor = null as { date: string; no: number } | null;
  for (let page = 1; page <= 3; page++) {
    const r = got(s.memos.list(s.db, none, cursor));
    assert.equal(r.rows.length, page < 3 ? 100 : 10);
    assert.equal(r.next === null, page === 3);
    seen.push(...r.rows.map((x) => ({ date: x.date, no: x.challanNo })));
    cursor = r.next;
  }
  const want = s.db.prepare('SELECT memo_date AS date, challan_no AS no FROM memos ORDER BY memo_date DESC, challan_no DESC').all();
  assert.deepEqual(seen, want, 'the order is (date, number) newest first all the way, no row twice or missing');
});

test('list: the statement reads the LRs by memo through an index, never by scanning them', () => {
  const s = setUp();
  memoOf(s, 2);
  for (const f of [none, { ...none, from: '2026-10-01', to: '2026-10-31', truckId: s.truck, toStationId: s.nagpur }]) {
    const q = savedSql(f, true);
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all({ ...q.args, cd: '2026-10-31', cn: 99 }) as { detail: string }[]).map((r) => r.detail);
    assert.ok(!plan.some((l) => /^SCAN (TABLE lrs\b|l\b)/.test(l)), plan.join(' | '));
    assert.ok(plan.some((l) => /^SEARCH (TABLE lrs\b|lrs\b|l\b).* USING (COVERING )?INDEX lrs_by_memo/.test(l)), plan.join(' | '));
  }
});

// ---- header edit ----

test('editHeader: only the changed fields are written (with one version up and one audit row), the challan number stays, a no-op writes nothing', () => {
  const s = setUp();
  const m = memoOf(s, 2, { truckHire: '4,500' });
  const d = m.get();
  const r = got(s.memos.editHeader(s.db, 'seat-2', m.id, d.version, header(d, { truckId: s.truck2, truckHire: '5,000', date: '2026-10-25' }), SYSTEM));
  assert.equal(r.changed, true);
  assert.deepEqual([r.memo.truck, r.memo.truckHirePaise, r.memo.date, r.memo.challanNo, r.memo.version, r.memo.driver], ['MH 29 AB 1', 500000, '2026-10-25', m.no, d.version + 1, 'Ramesh Pawar']);
  assert.equal(r.memo.frozen.lrs, 2, 'the frozen totals are untouched');
  const [audit] = lastAudit(s);
  assert.deepEqual([audit.seat, audit.action, audit.entity, audit.entityId], ['seat-2', 'memos.edit', 'memos', String(m.id)]);
  assert.deepEqual(JSON.parse(audit.before ?? ''), { date: '2026-10-31', truckId: s.truck, truckHirePaise: 450000 });
  assert.deepEqual(JSON.parse(audit.after ?? ''), { date: '2026-10-25', truckId: s.truck2, truckHirePaise: 500000 });
  const before = footprint(s);
  const same = got(s.memos.editHeader(s.db, 'seat-1', m.id, r.memo.version, header(r.memo), SYSTEM));
  assert.equal(same.changed, false);
  assert.equal(footprint(s), before);
});

test('editHeader: a stale version is refused with the current memo, before the other rules; the PIN comes first; nothing is written by any refusal', () => {
  const s = setUp();
  const m = memoOf(s, 1);
  const d = m.get();
  got(s.memos.editHeader(s.db, 'seat-1', m.id, d.version, header(d, { truckHire: '10' }), SYSTEM));
  const before = footprint(s);
  const stale = refused(s.memos.editHeader(s.db, 'seat-1', m.id, d.version, header(d, { toStationId: d.fromStationId }), SYSTEM));
  assert.equal(stale.code, 'memo-stale');
  assert.equal(stale.memo?.truckHirePaise, 1000, 'the answer carries the current memo');
  const cur = m.get();
  const bad = (over: Partial<MemoHeaderInput>, pin = SYSTEM) => s.memos.editHeader(s.db, 'seat-1', m.id, cur.version, header(cur, over), pin);
  assert.equal(refused(bad({ truckHire: '10' }, '9999')).code, 'wrong-pin');
  assert.equal(refused(bad({ truckHire: '10' }, ADMIN)).code, 'wrong-pin', 'the Admin PIN is not the System PIN');
  assert.equal(refused(bad({ truckHire: '10' }, '')).code, 'wrong-pin');
  const field = (over: Partial<MemoHeaderInput>) => refused(bad(over)).memoFields;
  assert.deepEqual(field({ toStationId: cur.fromStationId }), { toStation: 'same' });
  assert.deepEqual(field({ date: '2026-11-01' }), { date: 'future' });
  assert.deepEqual(field({ date: '2025-12-31' }), { date: 'year' }, 'the challan number belongs to 2026: the date stays in 2026');
  assert.deepEqual(field({ truckHire: 'lots' }), { truckHire: 'amount' });
  assert.deepEqual(field({ truckId: null }), { truck: 'required' });
  assert.deepEqual(field({ driverId: 9999 }), { driver: 'missing' });
  assert.equal(footprint(s), before);
  assert.equal(refused(s.memos.editHeader(s.db, 'seat-1', 9999, 1, header(cur), SYSTEM)).code, 'memo-missing');
});

test('editHeader: a truck deactivated since stays allowed while it is left alone; a new pick must be active; a cancelled memo cannot be edited', () => {
  const s = setUp();
  const m = memoOf(s, 1);
  const t = got(s.masters.update(s.db, 'seat-1', 'trucks', s.truck, 1, { number: 'MH 29 BE 1234' }, SYSTEM));
  got(s.masters.setActive(s.db, 'seat-1', 'trucks', s.truck, t.version, false, SYSTEM));
  const d = m.get();
  assert.equal(got(s.memos.editHeader(s.db, 'seat-1', m.id, d.version, header(d, { truckHire: '7' }), SYSTEM)).changed, true);
  const cur = m.get();
  const t2 = got(s.masters.create(s.db, 'seat-1', 'trucks', { number: 'MH 31 ZZ 9' }));
  got(s.masters.setActive(s.db, 'seat-1', 'trucks', t2.id, t2.version, false, SYSTEM));
  assert.deepEqual(refused(s.memos.editHeader(s.db, 'seat-1', m.id, cur.version, header(cur, { truckId: t2.id }), SYSTEM)).memoFields, { truck: 'missing' });
  got(s.memos.cancel(s.db, 'seat-1', m.id, cur.version, 'test', ADMIN));
  const dead = m.get();
  assert.equal(refused(s.memos.editHeader(s.db, 'seat-1', m.id, dead.version, header(dead, { truckHire: '1' }), SYSTEM)).code, 'memo-cancelled');
});

// ---- take LRs off ----

test('removeLrs: the LRs go back to booked on every seat, the memo differs, and every LR and the memo have an audit row', () => {
  const s = setUp();
  const m = memoOf(s, 3);
  const [one, two, three] = m.lrs;
  const d = m.get();
  const r = got(s.memos.removeLrs(s.db, 'seat-2', m.id, [two.id], SYSTEM));
  assert.deepEqual(r.lrs.map((l) => l.id), [one.id, three.id]);
  assert.deepEqual(lrStatus(s, two.id), { status: 'booked', memoId: null, version: 3 });
  assert.deepEqual(pendingNos(s), [two.no], 'it is in the pending list again');
  assert.equal(r.version, d.version + 1);
  assert.equal(r.differs, true);
  assert.deepEqual([r.frozen.lrs, r.now.lrs], [3, 2], 'saved totals untouched, totals now follow');
  const [lrAudit, memoAudit] = lastAudit(s, 2);
  assert.deepEqual([lrAudit.action, lrAudit.entity, lrAudit.entityId, lrAudit.seat], ['lrs.memo-remove', 'lrs', String(two.id), 'seat-2']);
  assert.deepEqual(JSON.parse(lrAudit.before ?? ''), { status: 'loaded', memoId: m.id });
  assert.deepEqual(JSON.parse(memoAudit.after ?? '').lrNos, [two.no]);
  assert.deepEqual([memoAudit.action, memoAudit.entityId], ['memos.remove-lrs', String(m.id)]);
  assert.equal(lastAudit(s, 10).filter((a) => a.action === 'lrs.memo-remove' || a.action === 'memos.remove-lrs').length, 2, 'one row for the LR, one for the memo');
});

test('removeLrs: the last LR cannot be taken off; LRs not on the memo are named; nothing is written by any refusal', () => {
  const s = setUp();
  const m = memoOf(s, 2);
  const other = memoOf(s, 1);
  const free = book(s);
  const before = footprint(s);
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, m.lrs.map((l) => l.id), SYSTEM)).code, 'memo-last-lr');
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[0].id], '0000')).code, 'wrong-pin');
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[0].id], ADMIN)).code, 'wrong-pin');
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [], SYSTEM)).memoFields?.lrs, 'required');
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[0].id, 99999], SYSTEM)).memoFields?.lrs, 'missing');
  const c = refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[0].id, other.lrs[0].id, free.id], SYSTEM));
  assert.equal(c.code, 'memo-conflict');
  assert.deepEqual(c.taken?.map((x) => [x.lrNo, x.state, x.challanNo]), [[other.lrs[0].no, 'loaded', other.no], [free.no, 'booked', null]]);
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', 9999, [free.id], SYSTEM)).code, 'memo-missing');
  assert.equal(footprint(s), before);
  got(s.memos.cancel(s.db, 'seat-1', m.id, m.get().version, 'x', ADMIN));
  assert.equal(refused(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[0].id], SYSTEM)).code, 'memo-cancelled');
});

// ---- move ----

test('moveLrs: one transaction updates memo_id; both memos then differ; the LR keeps loaded; both memos and the LR are audited', () => {
  const s = setUp();
  const a = memoOf(s, 3);
  const b = memoOf(s, 1, { truckId: s.truck2 });
  const r = got(s.memos.moveLrs(s.db, 'seat-2', a.id, [a.lrs[1].id, a.lrs[2].id], b.id, SYSTEM));
  assert.deepEqual(r.lrs.map((l) => l.id), [a.lrs[0].id], 'the answer is the memo the LRs left');
  assert.deepEqual(lrStatus(s, a.lrs[1].id), { status: 'loaded', memoId: b.id, version: 3 });
  assert.deepEqual([a.get().differs, b.get().differs], [true, true]);
  assert.deepEqual([b.get().now.lrs, b.get().frozen.lrs], [3, 1]);
  assert.deepEqual(pendingNos(s), []);
  const rows = lastAudit(s, 4);
  assert.deepEqual(rows.map((x) => [x.action, x.entity]).sort(), [['lrs.memo-move', 'lrs'], ['lrs.memo-move', 'lrs'], ['memos.move-in', 'memos'], ['memos.move-out', 'memos']]);
  assert.equal(JSON.parse(rows.find((x) => x.action === 'memos.move-out')?.after ?? '').toChallanNo, b.no);
});

test('moveLrs: the target must be another saved memo; the source keeps at least one LR; LRs not on the source are named; nothing is written', () => {
  const s = setUp();
  const a = memoOf(s, 2);
  const b = memoOf(s, 1);
  const dead = memoOf(s, 1);
  got(s.memos.cancel(s.db, 'seat-1', dead.id, dead.get().version, 'x', ADMIN));
  const before = footprint(s);
  const move = (ids: number[], target: number, pin = SYSTEM) => s.memos.moveLrs(s.db, 'seat-1', a.id, ids, target, pin);
  assert.equal(refused(move([a.lrs[0].id], a.id)).code, 'memo-target', 'the same memo');
  assert.equal(refused(move([a.lrs[0].id], dead.id)).code, 'memo-target', 'a cancelled memo');
  assert.equal(refused(move([a.lrs[0].id], 9999)).code, 'memo-target', 'no such memo');
  assert.equal(refused(move(a.lrs.map((l) => l.id), b.id)).code, 'memo-last-lr');
  assert.equal(refused(move([a.lrs[0].id], b.id, '0000')).code, 'wrong-pin');
  const c = refused(move([a.lrs[0].id, b.lrs[0].id], b.id));
  assert.deepEqual([c.code, c.taken?.map((x) => [x.lrNo, x.state, x.challanNo])], ['memo-conflict', [[b.lrs[0].no, 'loaded', b.no]]]);
  assert.equal(footprint(s), before);
  assert.equal(refused(s.memos.moveLrs(s.db, 'seat-1', dead.id, [dead.lrs[0].id], b.id, SYSTEM)).code, 'memo-cancelled');
});

// ---- add ----

test('addLrs: pending LRs join the memo in one transaction (claim guard), the memo differs, the LRs and the memo are audited', () => {
  const s = setUp();
  const m = memoOf(s, 1);
  const x = book(s);
  const y = book(s);
  const r = got(s.memos.addLrs(s.db, 'seat-2', m.id, [x.id, y.id], SYSTEM));
  assert.deepEqual(r.lrs.map((l) => l.id), [m.lrs[0].id, x.id, y.id]);
  assert.deepEqual(lrStatus(s, x.id), { status: 'loaded', memoId: m.id, version: 2 });
  assert.deepEqual([r.differs, r.frozen.lrs, r.now.lrs, r.version], [true, 1, 3, m.get().version]);
  assert.deepEqual(pendingNos(s), []);
  assert.deepEqual(lastAudit(s, 3).map((a) => a.action), ['lrs.memo-add', 'lrs.memo-add', 'memos.add-lrs']);
  assert.deepEqual(JSON.parse(lastAudit(s, 3)[2].after ?? '').lrNos, [x.no, y.no]);
});

test('addLrs: an LR loaded elsewhere, cancelled, or already on this memo refuses the whole change and names it; nothing is written', () => {
  const s = setUp();
  const m = memoOf(s, 1);
  const other = memoOf(s, 1);
  const cancelled = book(s);
  got(s.lrs.cancel(s.db, 'seat-1', cancelled.id, 1, 'wrong', SYSTEM));
  const fine = book(s);
  const before = footprint(s);
  const r = refused(s.memos.addLrs(s.db, 'seat-1', m.id, [fine.id, other.lrs[0].id, cancelled.id, m.lrs[0].id], SYSTEM));
  assert.equal(r.code, 'memo-conflict');
  assert.deepEqual(r.taken?.map((x) => [x.lrNo, x.state, x.challanNo]).sort(), [
    [m.lrs[0].no, 'loaded', m.no], [other.lrs[0].no, 'loaded', other.no], [cancelled.no, 'cancelled', null],
  ].sort());
  assert.equal(lrStatus(s, fine.id).status, 'booked', 'the good one stayed booked: all or nothing');
  assert.equal(refused(s.memos.addLrs(s.db, 'seat-1', m.id, [fine.id], '0000')).code, 'wrong-pin');
  assert.equal(refused(s.memos.addLrs(s.db, 'seat-1', m.id, [], SYSTEM)).memoFields?.lrs, 'required');
  assert.equal(refused(s.memos.addLrs(s.db, 'seat-1', m.id, [fine.id, 99999], SYSTEM)).memoFields?.lrs, 'missing');
  assert.equal(refused(s.memos.addLrs(s.db, 'seat-1', 9999, [fine.id], SYSTEM)).code, 'memo-missing');
  assert.equal(footprint(s), before);
});

/** `count` plain booked LRs, fast. */
const bulk = (s: Set, count: number): number[] =>
  Array.from({ length: count }, (_, i) =>
    Number(s.db.prepare(`INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, seat) VALUES (?, 2026, ?, '2026-10-30', 'A', 'B', ?, ?, 'Cloth', 1, 't')`).run(`b-${i}`, 5000 + i, s.yavatmal, s.nagpur).lastInsertRowid),
  );

test('addLrs: a memo carries at most 500 LRs, counting the ones already on it', () => {
  const s = setUp();
  const m = saved(create(s, bulk(s, 499)));
  const two = [book(s).id, book(s).id];
  assert.equal(refused(s.memos.addLrs(s.db, 'seat-1', m.id, two, SYSTEM)).memoFields?.lrs, 'many');
  assert.equal(got(s.memos.addLrs(s.db, 'seat-1', m.id, [two[0]], SYSTEM)).lrs.length, 500);
});

test('moveLrs: the target memo cannot go over 500 LRs either', () => {
  const s = setUp();
  const target = saved(create(s, bulk(s, 499)));
  const source = memoOf(s, 3);
  const before = footprint(s);
  assert.equal(refused(s.memos.moveLrs(s.db, 'seat-1', source.id, [source.lrs[0].id, source.lrs[1].id], target.id, SYSTEM)).memoFields?.lrs, 'many');
  assert.equal(footprint(s), before);
  assert.equal(got(s.memos.moveLrs(s.db, 'seat-1', source.id, [source.lrs[0].id], target.id, SYSTEM)).lrs.length, 2);
  assert.equal(got(s.memos.get(s.db, target.id)).lrs.length, 500);
});

test("byDate: today's memos leave out a cancelled one", () => {
  const s = setUp();
  const a = memoOf(s, 1);
  const b = memoOf(s, 1);
  got(s.memos.cancel(s.db, 'seat-1', a.id, a.get().version, 'x', ADMIN));
  assert.deepEqual(got(s.memos.byDate(s.db, null)).map((m) => m.challanNo), [b.no]);
});

// ---- recalculate ----

test('recalculate: needs the Admin PIN, copies the totals now onto the memo, clears the difference, and audits old → new', () => {
  const s = setUp();
  const m = memoOf(s, 2);
  const d0 = m.get();
  got(s.memos.removeLrs(s.db, 'seat-1', m.id, [m.lrs[1].id], SYSTEM));
  const d = m.get();
  assert.equal(d.differs, true);
  const before = footprint(s);
  assert.equal(refused(s.memos.recalculate(s.db, 'seat-1', m.id, d.version, SYSTEM)).code, 'wrong-pin', 'the System PIN is not enough');
  assert.equal(refused(s.memos.recalculate(s.db, 'seat-1', m.id, d.version, '0000')).code, 'wrong-pin');
  assert.equal(refused(s.memos.recalculate(s.db, 'seat-1', m.id, d.version - 1, ADMIN)).code, 'memo-stale');
  assert.equal(footprint(s), before);
  const r = got(s.memos.recalculate(s.db, 'seat-2', m.id, d.version, ADMIN));
  assert.equal(r.changed, true);
  assert.deepEqual(r.memo.frozen, d.now);
  assert.equal(r.memo.differs, false);
  assert.equal(r.memo.version, d.version + 1);
  assert.equal(r.memo.lrCount, 1, 'the list row follows the frozen count');
  assert.equal(got(s.memos.list(s.db, none, null)).rows[0].differs, false);
  const [audit] = lastAudit(s);
  assert.deepEqual([audit.action, audit.seat], ['memos.recalculate', 'seat-2']);
  assert.deepEqual(JSON.parse(audit.before ?? ''), d0.frozen);
  assert.deepEqual(JSON.parse(audit.after ?? ''), d.now);
  // nothing differs now: a second Recalculate writes nothing
  const again = footprint(s);
  assert.equal(got(s.memos.recalculate(s.db, 'seat-1', m.id, r.memo.version, ADMIN)).changed, false);
  assert.equal(footprint(s), again);
});

// ---- cancel ----

test('cancel: needs the Admin PIN and a reason; every LR is booked again, the number is never reused, Dashboard counts leave it out', () => {
  const s = setUp();
  const keep = memoOf(s, 1);
  const m = memoOf(s, 3);
  const dash = makeDashboard(now);
  const counts = () => {
    const r = got(dash.summary(s.db, null));
    return [r.memos, r.trucksOut, r.pending];
  };
  assert.deepEqual(counts(), [2, 1, 0]);
  const d = m.get();
  const before = footprint(s);
  assert.equal(refused(s.memos.cancel(s.db, 'seat-1', m.id, d.version, 'wrong truck', SYSTEM)).code, 'wrong-pin', 'the System PIN is not enough');
  assert.equal(refused(s.memos.cancel(s.db, 'seat-1', m.id, d.version, 'wrong truck', '0000')).code, 'wrong-pin');
  for (const reason of ['   ', 'x'.repeat(201)]) {
    const bad = refused(s.memos.cancel(s.db, 'seat-1', m.id, d.version, reason, ADMIN));
    assert.deepEqual([bad.code, bad.memoFields], ['memo-invalid', { reason: 'required' }]);
  }
  assert.equal(refused(s.memos.cancel(s.db, 'seat-1', m.id, d.version + 5, 'wrong truck', ADMIN)).code, 'memo-stale');
  assert.equal(footprint(s), before);
  const r = got(s.memos.cancel(s.db, 'seat-2', m.id, d.version, 'wrong truck', ADMIN));
  assert.deepEqual([r.status, r.version, r.lrs.length, r.differs, r.challanNo], ['cancelled', d.version + 1, 0, false, m.no]);
  assert.deepEqual(r.frozen, d.frozen, 'what was printed stays on the memo');
  for (const l of m.lrs) assert.deepEqual(lrStatus(s, l.id), { status: 'booked', memoId: null, version: 3 });
  assert.deepEqual(pendingNos(s), m.lrs.map((l) => l.no), 'they are pending again');
  assert.deepEqual(counts(), [1, 1, 3]);
  assert.equal(saved(create(s, [m.lrs[0].id])).challanNo, m.no + 1, 'the cancelled number is not reused');
  assert.equal(refused(s.memos.cancel(s.db, 'seat-1', m.id, r.version, 'again', ADMIN)).code, 'memo-cancelled');
  const audits = lastAudit(s, 40).filter((a) => a.action === 'memos.cancel');
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].after ?? ''), { status: 'cancelled', reason: 'wrong truck', lrNos: m.lrs.map((l) => l.no) });
  assert.equal(lastAudit(s, 60).filter((a) => a.action === 'lrs.memo-cancel').length, 3);
  assert.equal(keep.get().status, 'saved');
});

// ---- history ----

test('history: who, when, what, for the memo, newest first, at most 50', () => {
  const s = setUp();
  const a = memoOf(s, 3);
  const b = memoOf(s, 1);
  const x = book(s);
  const d = a.get();
  got(s.memos.editHeader(s.db, 'seat-2', a.id, d.version, header(d, { truckId: s.truck2, truckHire: '9' }), SYSTEM));
  got(s.memos.removeLrs(s.db, 'seat-1', a.id, [a.lrs[2].id], SYSTEM));
  got(s.memos.moveLrs(s.db, 'seat-1', a.id, [a.lrs[1].id], b.id, SYSTEM));
  got(s.memos.addLrs(s.db, 'seat-1', a.id, [x.id], SYSTEM));
  got(s.memos.recalculate(s.db, 'seat-1', a.id, a.get().version, ADMIN));
  const h = got(s.memos.history(s.db, a.id));
  assert.deepEqual(h.map((e) => e.action), ['recalculated', 'added', 'moved-out', 'removed', 'edited', 'created']);
  assert.deepEqual(h[1].lrNos, [x.no]);
  assert.deepEqual([h[2].lrNos, h[2].otherNo], [[a.lrs[1].no], b.no]);
  assert.deepEqual(h[3].lrNos, [a.lrs[2].no]);
  assert.deepEqual(h[4].changes, [
    { field: 'truck', from: 'MH 29 BE 1234', to: 'MH 29 AB 1' },
    { field: 'truckHire', from: 0, to: 900 },
  ]);
  assert.equal(h[4].seat, 'seat-2');
  assert.ok(h[0].changes.some((c) => c.field === 'lrs'), 'the recalculation shows what the totals became');
  assert.deepEqual(got(s.memos.history(s.db, b.id)).map((e) => [e.action, e.otherNo]), [['moved-in', a.no], ['created', undefined]]);
  got(s.memos.cancel(s.db, 'seat-1', a.id, a.get().version, 'duplicate', ADMIN));
  const last = got(s.memos.history(s.db, a.id))[0];
  assert.deepEqual([last.action, last.reason, last.lrNos.length], ['cancelled', 'duplicate', 2]);
  // at most 50
  const long = memoOf(s, 1);
  for (let i = 1; i <= 60; i++) {
    const cur = long.get();
    got(s.memos.editHeader(s.db, 'seat-1', long.id, cur.version, header(cur, { truckHire: String(i) }), SYSTEM));
  }
  assert.equal(got(s.memos.history(s.db, long.id)).length, 50);
  assert.equal(refused(s.memos.history(s.db, 99999)).code, 'memo-missing');
});

test('speed: the saved-memos list answers in under 100 ms over 5 000 memos, and 100 LRs of a 200-LR memo are removed and added back in under 100 ms plus the PIN checks', () => {
  const s = setUp();
  const put = s.db.prepare(
    `INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id, frozen_lr_count, seat) VALUES (?, 2025, ?, ?, ?, ?, ?, ?, 1, 't')`,
  );
  s.db.transaction(() => {
    for (let i = 1; i <= 5000; i++) put.run(`m-${i}`, i, `2025-0${1 + (i % 9)}-1${i % 9}`, s.truck, s.driver, s.yavatmal, s.nagpur);
  })();
  const t = fastest(5, () => got(s.memos.list(s.db, none, null)));
  assert.ok(t < 100, `list took ${t.toFixed(1)} ms`);
  const lrs = Array.from({ length: 200 }, () => book(s));
  const m = saved(create(s, lrs.map((l) => l.id)));
  const ids = lrs.slice(0, 100).map((l) => l.id);
  const t2 = fastest(3, () => {
    got(s.memos.removeLrs(s.db, 'seat-1', m.id, ids, SYSTEM));
    got(s.memos.addLrs(s.db, 'seat-1', m.id, ids, SYSTEM));
  });
  // each change checks the System PIN with scrypt (about 170 ms by design): the budget is for the rest
  const pinMs = fastest(3, () => s.pins.verify(s.db, 'system', SYSTEM));
  assert.ok(t2 - 2 * pinMs < 100, `remove + add took ${t2.toFixed(1)} ms with two PIN checks of ${pinMs.toFixed(1)} ms`);
});

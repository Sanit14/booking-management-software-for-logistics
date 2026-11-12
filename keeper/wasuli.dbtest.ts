// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Wasuli: the transitions (compare-and-set), the lists and the agent stats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult, WasuliChanged, WasuliCollectInput, WasuliFilters, WasuliPage, WasuliRow, WasuliSeen } from '../shared';
import { AGENT_STATS_SQL, listSql, makeWasuli } from './wasuli';
import { book, now, setUp as baseSetUp, SYSTEM } from './memoTesting';
import { fastest, insert, insertLr } from './testing';

const TODAY = '2026-10-31';

function setUp() {
  const s = baseSetUp();
  const wasuli = makeWasuli(s.pins, now);
  const agent = (name: string) => s.made(s.masters.create(s.db, 'seat-1', 'agents', { name })).id;
  return { ...s, wasuli, agent };
}
type Set = ReturnType<typeof setUp>;

const seen = (r: WasuliRow): WasuliSeen => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
const changed = (r: KeeperResult<WasuliChanged>): WasuliRow[] => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.wasuliFields ?? r.wasuli ?? r.detail ?? '')}`);
  return r.value.rows;
};
const refused = <T>(r: KeeperResult<T>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<T>, { ok: false }>;
};
/** A booked LR with a wasuli amount, and its collection row as the screen would hold it. */
function owed(s: Set, amount: string, over: Parameters<typeof book>[1] = {}): WasuliRow {
  const lr = book(s, { wasuli: amount, ...over });
  const r = s.wasuli.find(s.db, lr.no);
  assert.ok(r.ok, r.ok ? '' : r.code);
  return r.value;
}
const row = (s: Set, id: number) => s.db.prepare('SELECT * FROM wasuli WHERE id = ?').get(id) as Record<string, unknown>;
const audits = (s: Set, like = 'wasuli.%') =>
  s.db.prepare('SELECT action, seat, entity_id AS entity, before_json AS before, after_json AS after FROM audit_log WHERE action LIKE ? ORDER BY rowid').all(like) as {
    action: string; seat: string; entity: string; before: string | null; after: string | null;
  }[];
const collectInput = (over: Partial<WasuliCollectInput> = {}): WasuliCollectInput => ({ amount: '', mode: 'cash', remark: '', ...over });
const page = (s: Set, f: Partial<WasuliFilters> = {}, cursor: WasuliPage['next'] = null): WasuliPage => {
  const r = s.wasuli.list(s.db, { tab: 'unassigned', agentId: null, period: 'week', ...f }, cursor);
  assert.ok(r.ok);
  return r.value;
};
/** An assigned row: the LR, then the whole route through the real call. */
function assigned(s: Set, amount: string, agentId: number): WasuliRow {
  return changed(s.wasuli.assign(s.db, 'seat-1', [seen(owed(s, amount))], agentId))[0];
}
const days = (n: number) => {
  const d = new Date(2026, 9, 31 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('assign hands unassigned rows to an active agent: status, date, version, seat and one audit row each', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = owed(s, '500');
  const b = owed(s, '250.50');
  assert.deepEqual([a.status, a.agent, a.amountPaise, a.version], ['unassigned', null, 50000, 1]);
  const rows = changed(s.wasuli.assign(s.db, 'seat-2', [seen(a), seen(b)], ramesh));
  assert.deepEqual(rows.map((r) => [r.lrNo, r.status, r.agent, r.assignedDate, r.version, r.seat]), [
    [a.lrNo, 'assigned', 'Ramesh', TODAY, 2, 'seat-2'],
    [b.lrNo, 'assigned', 'Ramesh', TODAY, 2, 'seat-2'],
  ]);
  const log = audits(s, 'wasuli.assign');
  assert.equal(log.length, 2);
  assert.deepEqual(JSON.parse(log[0].before ?? ''), { status: 'unassigned', agent_id: null, assigned_date: null, collected_date: null, collected_paise: null, mode: null, remark: '' });
  assert.equal(JSON.parse(log[0].after ?? '').agent_id, ramesh);
});

test('assign is all or nothing: one row that moved on stops the batch and is named, the others stay as they were', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const suresh = s.agent('Suresh');
  const a = owed(s, '100');
  const b = owed(s, '200');
  const c = owed(s, '300');
  changed(s.wasuli.assign(s.db, 'seat-3', [seen(b)], suresh)); // another seat got b first
  const auditsBefore = audits(s).length;

  const r = refused(s.wasuli.assign(s.db, 'seat-1', [seen(a), seen(b), seen(c)], ramesh));
  assert.equal(r.code, 'wasuli-stale');
  assert.deepEqual(r.wasuli?.map((x) => [x.lrNo, x.status, x.agent, x.seat]), [[b.lrNo, 'assigned', 'Suresh', 'seat-3']]);
  for (const x of [a, c]) assert.equal(row(s, x.id).status, 'unassigned', 'the good rows were rolled back with it');
  assert.equal(audits(s).length, auditsBefore);
});

test('assign refuses an unknown or inactive agent and writes nothing', () => {
  const s = setUp();
  const gone = s.agent('Gone');
  const off = s.made(s.masters.setActive(s.db, 'seat-1', 'agents', gone, 1, false, SYSTEM));
  assert.equal(off.active, false);
  const a = owed(s, '100');
  for (const agentId of [gone, 99999]) {
    const r = refused(s.wasuli.assign(s.db, 'seat-1', [seen(a)], agentId));
    assert.deepEqual([r.code, r.wasuliFields], ['wasuli-invalid', { agent: 'missing' }]);
  }
  assert.equal(row(s, a.id).status, 'unassigned');
});

test('a change needs the row as it was seen: wrong status, wrong agent or an old version is stale, with the row as it is now', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = owed(s, '100');
  // seen as assigned while it is unassigned (a stale screen), and every action on a state it does not allow
  const lie = { ...seen(a), status: 'assigned' as const, agentId: ramesh };
  for (const r of [s.wasuli.collect(s.db, 'seat-1', lie, collectInput({ amount: '1' })), s.wasuli.toPool(s.db, 'seat-1', lie), s.wasuli.reassign(s.db, 'seat-1', lie, s.agent('Other'))]) {
    const x = refused(r);
    assert.equal(x.code, 'wasuli-stale');
    assert.deepEqual(x.wasuli?.map((w) => w.status), ['unassigned']);
  }
  assert.equal(refused(s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '1' }))).code, 'wasuli-stale', 'an unassigned row cannot be collected');
  assert.equal(refused(s.wasuli.assign(s.db, 'seat-1', [{ ...seen(a), version: 9 }], ramesh)).code, 'wasuli-stale');
  assert.equal(refused(s.wasuli.assign(s.db, 'seat-1', [{ ...seen(a), id: 99999 }], ramesh)).code, 'wasuli-stale', 'a row that is gone');
  assert.equal(row(s, a.id).version, 1);
  assert.equal(audits(s, 'wasuli.%').filter((x) => x.action !== 'wasuli.create').length, 0);
});

test('reassign moves an assigned row to another active agent with a new date; the same agent is refused', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const suresh = s.agent('Suresh');
  const a = assigned(s, '100', ramesh);
  s.db.prepare("UPDATE wasuli SET assigned_date = '2026-10-20' WHERE id = ?").run(a.id);
  const fresh = { ...a, version: 3 };
  assert.equal(refused(s.wasuli.reassign(s.db, 'seat-1', fresh, suresh)).code, 'wasuli-stale', 'seen at version 3 while it is 2');

  const mine = { ...a, assignedDate: '2026-10-20' };
  assert.deepEqual(refused(s.wasuli.reassign(s.db, 'seat-1', mine, ramesh)).wasuliFields, { agent: 'same' });
  assert.deepEqual(refused(s.wasuli.reassign(s.db, 'seat-1', mine, 99999)).wasuliFields, { agent: 'missing' });
  const [moved] = changed(s.wasuli.reassign(s.db, 'seat-2', seen(mine), suresh));
  assert.deepEqual([moved.agent, moved.assignedDate, moved.status, moved.seat], ['Suresh', TODAY, 'assigned', 'seat-2']);
  const log = audits(s, 'wasuli.reassign');
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].before ?? '').agent_id, ramesh);
  // The old screen still thinks Ramesh has it: the second reassign is refused and shows who has it now.
  const late = refused(s.wasuli.reassign(s.db, 'seat-1', seen(mine), s.agent('Third')));
  assert.deepEqual(late.wasuli?.map((x) => [x.agent, x.seat]), [['Suresh', 'seat-2']]);
});

test('back to pool clears the agent and the date; the row can be assigned again', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = assigned(s, '100', ramesh);
  const [pooled] = changed(s.wasuli.toPool(s.db, 'seat-1', seen(a)));
  assert.deepEqual([pooled.status, pooled.agentId, pooled.assignedDate, pooled.version], ['unassigned', null, null, 3]);
  assert.equal(audits(s, 'wasuli.to-pool').length, 1);
  assert.equal(refused(s.wasuli.toPool(s.db, 'seat-1', seen(a))).code, 'wasuli-stale', 'the same press twice');
  assert.equal(changed(s.wasuli.assign(s.db, 'seat-1', [seen(pooled)], ramesh))[0].version, 4);
});

test('collect: the full amount, a part payment, the mode and a remark; the date is today and no PIN is asked', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const full = assigned(s, '500', ramesh);
  const [done] = changed(s.wasuli.collect(s.db, 'seat-2', seen(full), collectInput({ amount: '500', mode: 'upi', remark: '  ref   4512 ' })));
  assert.deepEqual([done.status, done.collectedPaise, done.mode, done.remark, done.collectedDate, done.agent, done.seat, done.version], ['collected', 50000, 'upi', 'ref 4512', TODAY, 'Ramesh', 'seat-2', 3]);

  const part = assigned(s, '800', ramesh);
  const [half] = changed(s.wasuli.collect(s.db, 'seat-1', seen(part), collectInput({ amount: '300.25', mode: 'cash', remark: 'rest next week' })));
  assert.deepEqual([half.collectedPaise, half.amountPaise], [30025, 80000], 'a part payment is collected with the lower amount');

  const log = audits(s, 'wasuli.collect');
  assert.equal(log.length, 2);
  assert.equal(JSON.parse(log[0].before ?? '').status, 'assigned');
  assert.deepEqual(JSON.parse(log[0].after ?? ''), { status: 'collected', agent_id: ramesh, assigned_date: TODAY, collected_date: TODAY, collected_paise: 50000, mode: 'upi', remark: 'ref 4512' });
});

test('collect: what is wrong is named and nothing is written; a row that moved on is stale before anything else', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = assigned(s, '500', ramesh);
  const bad = (input: Partial<WasuliCollectInput>) => refused(s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '500', ...input })));
  assert.deepEqual(bad({ amount: '500.01' }).wasuliFields, { amount: 'over' });
  assert.deepEqual(bad({ amount: '' }).wasuliFields, { amount: 'required' });
  assert.deepEqual(bad({ amount: '0' }).wasuliFields, { amount: 'amount' });
  assert.deepEqual(bad({ amount: 'five' }).wasuliFields, { amount: 'amount' });
  assert.deepEqual(bad({ mode: null }).wasuliFields, { mode: 'required' });
  assert.deepEqual(bad({ remark: 'x'.repeat(201) }).wasuliFields, { remark: 'long' });
  assert.deepEqual(bad({ amount: '', mode: null }).wasuliFields, { amount: 'required', mode: 'required' });
  assert.equal(row(s, a.id).status, 'assigned');
  assert.equal(audits(s, 'wasuli.collect').length, 0);

  // Collected on another seat meanwhile: the answer is "changed", not "invalid", even for a bad amount.
  changed(s.wasuli.collect(s.db, 'seat-3', seen(a), collectInput({ amount: '500' })));
  const late = refused(s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: 'five' })));
  assert.equal(late.code, 'wasuli-stale');
  assert.deepEqual(late.wasuli?.map((x) => [x.status, x.seat]), [['collected', 'seat-3']]);
});

test('the same collect sent twice makes one collection and one audit row', () => {
  const s = setUp();
  const a = assigned(s, '500', s.agent('Ramesh'));
  const first = s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '500' }));
  const second = s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '500' }));
  assert.deepEqual([first.ok, second.ok], [true, false]);
  assert.equal(audits(s, 'wasuli.collect').length, 1);
  assert.equal(row(s, a.id).version, 3);
});

test('undo a collection: the System PIN first, then back to Assigned to the same agent with the collection cleared', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = assigned(s, '500', ramesh);
  const [done] = changed(s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '200', mode: 'card', remark: 'part' })));

  assert.equal(refused(s.wasuli.uncollect(s.db, 'seat-1', seen(done), '0000')).code, 'wrong-pin');
  assert.equal(refused(s.wasuli.uncollect(s.db, 'seat-1', seen(done), '')).code, 'wrong-pin');
  assert.equal(row(s, a.id).status, 'collected', 'a wrong PIN writes nothing');

  const [back] = changed(s.wasuli.uncollect(s.db, 'seat-2', seen(done), SYSTEM));
  assert.deepEqual([back.status, back.agent, back.assignedDate, back.collectedDate, back.collectedPaise, back.mode, back.remark, back.version], ['assigned', 'Ramesh', TODAY, null, null, null, '', 4]);
  const log = audits(s, 'wasuli.uncollect');
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].before ?? '').collected_paise, 20000, 'the audit row keeps what was collected');
  assert.equal(refused(s.wasuli.uncollect(s.db, 'seat-1', seen(done), SYSTEM)).code, 'wasuli-stale', 'undoing it twice');
  // It can be collected again, and the LR can be edited again once it is not collected.
  assert.equal(changed(s.wasuli.collect(s.db, 'seat-1', seen(back), collectInput({ amount: '500' })))[0].collectedPaise, 50000);
});

test('a remark on a collected row: System PIN, trimmed, empty allowed, the same text writes nothing', () => {
  const s = setUp();
  const a = assigned(s, '500', s.agent('Ramesh'));
  const [done] = changed(s.wasuli.collect(s.db, 'seat-1', seen(a), collectInput({ amount: '500', remark: 'first' })));
  assert.equal(refused(s.wasuli.remark(s.db, 'seat-1', seen(done), 'new', '0000')).code, 'wrong-pin');
  assert.deepEqual(refused(s.wasuli.remark(s.db, 'seat-1', seen(done), 'x'.repeat(201), SYSTEM)).wasuliFields, { remark: 'long' });
  assert.equal(row(s, a.id).remark, 'first');

  const r = s.wasuli.remark(s.db, 'seat-2', seen(done), '  UPI   confirmed ', SYSTEM);
  assert.ok(r.ok && r.value.changed);
  const [edited] = changed(r);
  assert.deepEqual([edited.remark, edited.version, edited.seat], ['UPI confirmed', 4, 'seat-2']);
  const same = s.wasuli.remark(s.db, 'seat-1', seen(edited), 'UPI confirmed', SYSTEM);
  assert.ok(same.ok && !same.value.changed);
  assert.equal(row(s, a.id).version, 4);
  assert.equal(audits(s, 'wasuli.remark').length, 1);
  assert.equal(changed(s.wasuli.remark(s.db, 'seat-1', seen(edited), '', SYSTEM))[0].remark, '');
  assert.equal(refused(s.wasuli.remark(s.db, 'seat-1', seen(done), 'late', SYSTEM)).code, 'wasuli-stale', 'seen at version 3');
  const notYet = assigned(s, '100', s.agent('Other'));
  assert.equal(refused(s.wasuli.remark(s.db, 'seat-1', seen(notYet), 'x', SYSTEM)).code, 'wasuli-stale', 'only a collected row has a remark to edit');
});

test('a failure while writing undoes the whole change', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const a = owed(s, '100');
  const b = owed(s, '200');
  s.db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON audit_log WHEN NEW.action = 'wasuli.assign' AND NEW.entity_id = '${b.id}' BEGIN SELECT RAISE(ABORT, 'audit down'); END`);
  assert.throws(() => s.wasuli.assign(s.db, 'seat-1', [seen(a), seen(b)], ramesh), /audit down/);
  assert.equal(row(s, a.id).status, 'unassigned', 'the first row went back too');
});

test('Unassigned lists oldest LR first (date, number), not by id, across a year', () => {
  const s = setUp();
  const late = owed(s, '100'); // today
  const oldest = owed(s, '200', { date: '2026-10-20' });
  const mid = owed(s, '300', { date: '2026-10-25' });
  const sameDay = owed(s, '400', { date: '2026-10-25' });
  insertLr(s.db, { lr_year: 2025, lr_no: 3000, lr_date: '2025-12-31', wasuli_paise: 500, seat: 't' });
  const lastYear = s.db.prepare('SELECT id FROM lrs WHERE lr_year = 2025').get() as { id: number };
  insert(s.db, 'wasuli', { lr_id: lastYear.id, amount_paise: 500, seat: 't' });

  const p = page(s);
  assert.deepEqual(p.rows.map((r) => [r.lrYear, r.lrNo]), [[2025, 3000], [2026, oldest.lrNo], [2026, mid.lrNo], [2026, sameDay.lrNo], [2026, late.lrNo]]);
  assert.deepEqual([p.count, p.amountPaise, p.next], [5, 100500, null]);
  assert.deepEqual(p.rows.map((r) => r.days), [304, 11, 6, 6, 0]);
  assert.deepEqual(p.counts, { unassigned: 5, assigned: 0, collected: 0 });
});

test('Assigned lists one agent oldest assigned first; Collected newest first inside the last 7 or 30 days', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const suresh = s.agent('Suresh');
  const a = assigned(s, '100', ramesh);
  const b = assigned(s, '200', ramesh);
  const c = assigned(s, '300', ramesh);
  const other = assigned(s, '400', suresh);
  s.db.prepare('UPDATE wasuli SET assigned_date = ? WHERE id = ?').run('2026-10-28', a.id);
  s.db.prepare('UPDATE wasuli SET assigned_date = ? WHERE id = ?').run('2026-10-26', b.id);
  s.db.prepare('UPDATE wasuli SET assigned_date = ? WHERE id = ?').run('2026-10-28', c.id);
  const asg = page(s, { tab: 'assigned', agentId: ramesh });
  assert.deepEqual(asg.rows.map((r) => r.lrNo), [b.lrNo, a.lrNo, c.lrNo], 'by assigned date, then LR number');
  assert.deepEqual(asg.rows.map((r) => r.days), [5, 3, 3]);
  assert.deepEqual([asg.count, asg.amountPaise], [3, 60000]);
  assert.deepEqual(page(s, { tab: 'assigned', agentId: suresh }).rows.map((r) => r.lrNo), [other.lrNo]);
  assert.deepEqual(asg.counts, { unassigned: 0, assigned: 3, collected: 0 });

  // Collected on different days: today, 6, 7, 29 and 30 days ago.
  const dated = [0, 6, 7, 29, 30].map((ago, i) => {
    const w = assigned(s, '100', ramesh);
    const [done] = changed(s.wasuli.collect(s.db, 'seat-1', seen(w), collectInput({ amount: String(10 * (i + 1)) })));
    s.db.prepare('UPDATE wasuli SET collected_date = ? WHERE id = ?').run(days(ago), done.id);
    return { ago, lrNo: done.lrNo };
  });
  const week = page(s, { tab: 'collected', agentId: ramesh, period: 'week' });
  assert.deepEqual(week.rows.map((r) => r.lrNo), dated.slice(0, 2).map((d) => d.lrNo), 'today and 6 days ago are in the last 7 days; 7 days ago is not');
  assert.deepEqual([week.count, week.amountPaise, week.rows[0].days], [2, 1000 + 2000, 0]);
  const month = page(s, { tab: 'collected', agentId: ramesh, period: 'month' });
  assert.deepEqual(month.rows.map((r) => r.lrNo), dated.slice(0, 4).map((d) => d.lrNo), '29 days ago is in the last 30; 30 days ago is not');
  assert.deepEqual(month.counts, { unassigned: 0, assigned: 3, collected: 4 });
  assert.deepEqual(page(s, { tab: 'collected', agentId: suresh }).rows, []);
});

test('Assigned and Collected with no agent picked list nothing but still count the tabs', () => {
  const s = setUp();
  owed(s, '100');
  const p = page(s, { tab: 'assigned', agentId: null });
  assert.deepEqual([p.rows, p.next, p.count, p.amountPaise, p.counts], [[], null, 0, 0, { unassigned: 1, assigned: 0, collected: 0 }]);
  assert.deepEqual(page(s, { tab: 'collected', agentId: null }).rows, []);
});

test('a row carries its challan once the LR is loaded', () => {
  const s = setUp();
  const w = owed(s, '100');
  assert.equal(w.challanNo, null);
  const m = s.memos.create(s.db, 'seat-1', {
    uid: 'm1', date: null, truckId: s.truck, driverId: s.driver, fromStationId: s.yavatmal, toStationId: s.nagpur, truckHire: '', loadingHamali: '', hamaliRate: '0.40', commission: '10', lrIds: [w.lrId],
  });
  assert.ok(m.ok);
  assert.equal(page(s).rows[0].challanNo, 1);
});

test('paging: 100 a page by (date, number), no row twice or missed, exactly 100 has no next page', () => {
  const s = setUp();
  const n = 250;
  s.db.transaction(() => {
    for (let i = 1; i <= n; i++) {
      const lr = insertLr(s.db, { lr_no: 1000 + i, lr_date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, wasuli_paise: 100 * i, seat: 't' });
      insert(s.db, 'wasuli', { lr_id: lr, amount_paise: 100 * i, seat: 't' });
    }
  })();
  const seenNos: number[] = [];
  let cursor: WasuliPage['next'] = null;
  const sizes: number[] = [];
  do {
    const p: WasuliPage = page(s, {}, cursor);
    sizes.push(p.rows.length);
    seenNos.push(...p.rows.map((r) => r.lrNo));
    assert.deepEqual([p.count, p.amountPaise], [n, 100 * ((n * (n + 1)) / 2)], 'the totals are for the whole filter, on every page');
    cursor = p.next;
  } while (cursor);
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(new Set(seenNos).size, n);
  const sorted = [...s.db.prepare('SELECT lr_no AS no FROM lrs ORDER BY lr_date, lr_no').all() as { no: number }[]].map((r) => r.no);
  assert.deepEqual(seenNos, sorted);

  s.db.prepare('DELETE FROM wasuli WHERE lr_id IN (SELECT id FROM lrs ORDER BY lr_date DESC, lr_no DESC LIMIT 150)').run();
  const exact = page(s);
  assert.deepEqual([exact.rows.length, exact.next], [100, null]);
  insertLr(s.db, { lr_no: 99999, wasuli_paise: 100, seat: 't' });
  insert(s.db, 'wasuli', { lr_id: Number((s.db.prepare('SELECT id FROM lrs WHERE lr_no = 99999').get() as { id: number }).id), amount_paise: 100, seat: 't' });
  assert.notEqual(page(s).next, null, '101 rows have a next page');
});

test('paging Assigned and Collected resumes after the last row of the page', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  s.db.transaction(() => {
    for (let i = 1; i <= 130; i++) {
      const lr = insertLr(s.db, { lr_no: 2000 + i, lr_date: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`, wasuli_paise: 100, seat: 't' });
      const collected = i % 2 === 0;
      insert(s.db, 'wasuli', {
        lr_id: lr, amount_paise: 100, seat: 't', status: collected ? 'collected' : 'assigned', agent_id: ramesh, assigned_date: `2026-10-${String(1 + (i % 5)).padStart(2, '0')}`,
        ...(collected ? { collected_date: `2026-10-${String(25 + (i % 6)).padStart(2, '0')}`, collected_paise: 100, mode: 'cash' } : {}),
      });
    }
  })();
  for (const tab of ['assigned', 'collected'] as const) {
    const all: number[] = [];
    let cursor: WasuliPage['next'] = null;
    let pages = 0;
    do {
      const p: WasuliPage = page(s, { tab, agentId: ramesh, period: 'month' }, cursor);
      all.push(...p.rows.map((r) => r.lrNo));
      cursor = p.next;
      pages++;
    } while (cursor);
    assert.equal(new Set(all).size, 65, tab);
    assert.equal(pages, 1, `${tab}: 65 rows fit one page`);
  }
  // Force a second page on Assigned by adding more.
  s.db.transaction(() => {
    for (let i = 1; i <= 80; i++) {
      const lr = insertLr(s.db, { lr_no: 3000 + i, lr_date: '2026-10-10', wasuli_paise: 100, seat: 't' });
      insert(s.db, 'wasuli', { lr_id: lr, amount_paise: 100, seat: 't', status: 'assigned', agent_id: ramesh, assigned_date: '2026-10-03' });
    }
  })();
  const first = page(s, { tab: 'assigned', agentId: ramesh });
  assert.equal(first.rows.length, 100);
  const second = page(s, { tab: 'assigned', agentId: ramesh }, first.next);
  assert.equal(second.rows.length, 45);
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 145);
  const key = (r: WasuliRow) => `${r.assignedDate} ${r.lrDate} ${String(r.lrNo).padStart(6, '0')}`;
  const order = [...first.rows, ...second.rows].map(key);
  assert.deepEqual(order, [...order].sort(), 'oldest assigned first, continuing across the page');

  // Collected runs newest first (the keyset goes the other way): 65 + 80 collected rows make a second page too.
  s.db.transaction(() => {
    for (let i = 1; i <= 80; i++) {
      const lr = insertLr(s.db, { lr_no: 5000 + i, lr_date: `2026-10-${String(1 + (i % 9)).padStart(2, '0')}`, wasuli_paise: 100, seat: 't' });
      insert(s.db, 'wasuli', { lr_id: lr, amount_paise: 100, seat: 't', status: 'collected', agent_id: ramesh, assigned_date: '2026-10-03', collected_date: `2026-10-${String(25 + (i % 6)).padStart(2, '0')}`, collected_paise: 100, mode: 'upi' });
    }
  })();
  const c1 = page(s, { tab: 'collected', agentId: ramesh, period: 'month' });
  assert.equal(c1.rows.length, 100);
  const c2 = page(s, { tab: 'collected', agentId: ramesh, period: 'month' }, c1.next);
  assert.deepEqual([c2.rows.length, c2.next, c1.count], [45, null, 145]);
  assert.equal(new Set([...c1.rows, ...c2.rows].map((r) => r.id)).size, 145, 'no row twice, none missed');
  const ckey = (r: WasuliRow) => `${r.collectedDate} ${r.lrDate} ${String(r.lrNo).padStart(6, '0')}`;
  const corder = [...c1.rows, ...c2.rows].map(ckey);
  assert.deepEqual(corder, [...corder].sort().reverse(), 'newest collected first, continuing across the page');
});

test('find: an LR of this year, else last year; and why there is none', () => {
  const s = setUp();
  const w = owed(s, '100');
  const none = book(s);
  const lastYear = insertLr(s.db, { lr_year: 2025, lr_no: 4000, lr_date: '2025-12-30', wasuli_paise: 700, seat: 't' });
  insert(s.db, 'wasuli', { lr_id: lastYear, amount_paise: 700, seat: 't' });

  const found = s.wasuli.find(s.db, w.lrNo);
  assert.ok(found.ok && found.value.id === w.id);
  const old = s.wasuli.find(s.db, 4000);
  assert.ok(old.ok && old.value.lrYear === 2025);
  assert.deepEqual([refused(s.wasuli.find(s.db, none.no)).code, refused(s.wasuli.find(s.db, none.no)).detail], ['wasuli-missing', 'no-wasuli']);
  assert.equal(refused(s.wasuli.find(s.db, 987654)).detail, 'no-lr');
  // A History row knows the year: exactly that year's LR, never another year's with the same number.
  const sameNo = insertLr(s.db, { lr_year: 2025, lr_no: w.lrNo, lr_date: '2025-12-30', wasuli_paise: 300, seat: 't' });
  insert(s.db, 'wasuli', { lr_id: sameNo, amount_paise: 300, seat: 't' });
  const lastYears = s.wasuli.find(s.db, w.lrNo, 2025);
  assert.ok(lastYears.ok && lastYears.value.lrYear === 2025 && lastYears.value.id !== w.id, 'LR ' + w.lrNo + '/2025, not this year\'s');
  assert.equal(refused(s.wasuli.find(s.db, 4000, 2026)).detail, 'no-lr', 'this year has no LR 4000');
});

test('agent stats: assigned now, collected today and in the period, per agent; an agent with nothing is listed with zeros', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const suresh = s.agent('Suresh');
  s.agent('Zero');
  const a1 = assigned(s, '100', ramesh);
  assigned(s, '250', ramesh);
  const c1 = assigned(s, '300', ramesh);
  const c2 = assigned(s, '400', ramesh);
  const c3 = assigned(s, '500', suresh);
  const done = (w: WasuliRow, amount: string, ago: number) => {
    const [d] = changed(s.wasuli.collect(s.db, 'seat-1', seen(w), collectInput({ amount })));
    s.db.prepare('UPDATE wasuli SET collected_date = ? WHERE id = ?').run(days(ago), d.id);
  };
  done(c1, '300', 0);
  done(c2, '150', 3);
  done(c3, '500', 20);
  assert.ok(a1.id > 0);

  const week = s.wasuli.agentStats(s.db, 'week');
  assert.ok(week.ok);
  assert.deepEqual(week.value.map((x) => [x.name, x.active, x.assignedCount, x.assignedPaise, x.collectedTodayCount, x.collectedTodayPaise, x.collectedPeriodCount, x.collectedPeriodPaise]), [
    ['Ramesh', true, 2, 35000, 1, 30000, 2, 45000],
    ['Suresh', true, 0, 0, 0, 0, 0, 0],
    ['Zero', true, 0, 0, 0, 0, 0, 0],
  ]);
  const month = s.wasuli.agentStats(s.db, 'month');
  assert.ok(month.ok);
  assert.deepEqual(month.value.find((x) => x.name === 'Suresh')?.collectedPeriodPaise, 50000);
});

test('the lists are served by indexes: no scan of lrs, and no scan of wasuli for a tab', () => {
  const s = setUp();
  const plan = (sql: string, args: Record<string, unknown>) => (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Object.keys(args).length > 0 ? [args] : [])) as { detail: string }[]).map((r) => r.detail);
  for (const tab of ['unassigned', 'assigned', 'collected'] as const) {
    for (const cursor of [null, { a: tab === 'unassigned' ? '' : '2026-10-01', date: '2026-10-01', no: 5 }]) {
      const q = listSql(tab, cursor, 1, '2026-10-25');
      for (const [name, sql, args] of [['rows', q.rows, q.rowsArgs], ['total', q.total, q.totalArgs]] as const) {
        const lines = plan(sql, args);
        assert.ok(!lines.some((l) => /^SCAN (TABLE lrs\b|l\b)/.test(l)), `${tab} ${name}: ${lines.join(' | ')}`);
        assert.ok(!lines.some((l) => /^SCAN (TABLE wasuli\b|w\b)/.test(l)), `${tab} ${name}: ${lines.join(' | ')}`);
      }
    }
  }
  const stats = plan(AGENT_STATS_SQL, { today: TODAY, since: '2026-10-25' });
  assert.ok(!stats.some((l) => /^SCAN (TABLE wasuli\b|wasuli\b)/.test(l)), stats.join(' | '));
  assert.ok(!stats.some((l) => /^SCAN (TABLE lrs\b|l\b)/.test(l)), stats.join(' | '));
});

test('speed: the lists answer in under 150 ms over 20 000 collections', () => {
  const s = setUp();
  const ramesh = s.agent('Ramesh');
  const put = s.db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, wasuli_paise, seat)
     VALUES (?, 2026, ?, ?, 'A', 'B', ?, ?, 'Cloth', 3, 5000, 't')`,
  );
  s.db.transaction(() => {
    for (let i = 1; i <= 20000; i++) put.run(`u${i}`, i, `2026-${i % 2 ? '09' : '10'}-${String(1 + (i % 28)).padStart(2, '0')}`, s.yavatmal, s.nagpur);
    s.db.exec(`INSERT INTO wasuli (lr_id, amount_paise, seat) SELECT id, wasuli_paise, seat FROM lrs`);
    // 3 000 are with Ramesh (1 500 assigned, 1 500 collected over the last months)
    s.db.prepare(`UPDATE wasuli SET status = 'assigned', agent_id = ?, assigned_date = '2026-10-20' WHERE id <= 3000`).run(ramesh);
    s.db.prepare(`UPDATE wasuli SET status = 'collected', collected_date = '2026-10-' || printf('%02d', 1 + (id % 28)), collected_paise = amount_paise, mode = 'cash' WHERE id <= 1500`).run();
  })();
  for (const [tab, label] of [['unassigned', 'Unassigned'], ['assigned', 'Assigned'], ['collected', 'Collected']] as const) {
    const first = page(s, { tab, agentId: ramesh, period: 'month' });
    assert.equal(first.rows.length, 100, label);
    const took = fastest(5, () => void page(s, { tab, agentId: ramesh, period: 'month' }));
    assert.ok(took < 150, `${label} took ${took.toFixed(1)} ms at its fastest of 5`);
  }
  const stats = fastest(5, () => void s.wasuli.agentStats(s.db, 'month'));
  assert.ok(stats < 100, `agent stats took ${stats.toFixed(1)} ms at its fastest of 5`);
});

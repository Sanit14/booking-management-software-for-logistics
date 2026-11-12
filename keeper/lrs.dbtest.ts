// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult, LrDetail, LrInput, LrSaved, LrUpdated } from '../shared';
import { lrAmounts } from './money';
import { makeLrs } from './lrs';
import { makeMasters } from './masters';
import { makePins } from './pins';
import { freshDb, insertMemo } from './testing';

const ADMIN = '1111';
const SYSTEM = '2222';
const TODAY = '2026-10-29';

function setUp() {
  const pins = makePins();
  const db = freshDb();
  assert.ok(pins.setup(db, 'seat-1', ADMIN, SYSTEM).ok);
  const masters = makeMasters(pins);
  const lrs = makeLrs(pins, masters, () => new Date(2026, 9, 29, 10, 30)); // local time: 29 October 2026
  const id = (r: KeeperResult<{ id: number }>) => {
    assert.ok(r.ok);
    return r.value.id;
  };
  const yavatmal = id(masters.create(db, 'seat-1', 'stations', { name: 'Yavatmal' }));
  const nagpur = id(masters.create(db, 'seat-1', 'stations', { name: 'Nagpur' }));
  const ganesh = id(masters.create(db, 'seat-1', 'firms', { name: 'Shree Ganesh Traders' }));
  return { db, lrs, masters, yavatmal, nagpur, ganesh };
}
type Set = ReturnType<typeof setUp>;

let serial = 0;
/** A valid LR from the firm "Shree Ganesh Traders" to a walk-in; `over` changes it. A new uid every time. */
const input = (s: Set, over: Partial<LrInput> = {}): LrInput => ({
  uid: `uid-${++serial}`,
  date: null,
  fromStationId: s.yavatmal,
  toStationId: s.nagpur,
  consignor: { firmId: s.ganesh, name: '', addToFirms: false },
  consignee: { firmId: null, name: 'Kale Brothers', addToFirms: false },
  particular: 'Cloth bales',
  qty: '3',
  toPay: '1,800',
  paid: '',
  hamali: '30',
  wasuli: '',
  ...over,
});

const save = (s: Set, over: Partial<LrInput> = {}, seat = 'seat-1') => s.lrs.create(s.db, seat, input(s, over));
const saved = (r: KeeperResult<LrSaved>): LrSaved => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.fields ?? r.detail ?? '')}`);
  return r.value;
};
const refused = (r: KeeperResult<LrSaved>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<LrSaved>, { ok: false }>;
};
const n = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
/** Everything a save may write. */
const footprint = (s: Set) => ({
  lrs: n(s, 'lrs'),
  firms: n(s, 'firms'),
  audit: n(s, 'audit_log'),
  counters: JSON.stringify(s.db.prepare('SELECT name, year, last FROM counters ORDER BY name, year').all()),
});

test('the number is issued in the save, 1, 2, 3 with no gap', () => {
  const s = setUp();
  assert.equal(s.lrs.defaults(s.db, null).nextNo, 1);
  const nos = [saved(save(s)), saved(save(s)), saved(save(s))].map((r) => r.row.lrNo);
  assert.deepEqual(nos, [1, 2, 3]);
  assert.equal(s.lrs.defaults(s.db, null).nextNo, 4);
});

test('the series restarts each year: a backdated LR takes its own year\'s number and does not disturb this year\'s', () => {
  const s = setUp();
  assert.equal(saved(save(s)).row.lrNo, 1);
  const old = saved(save(s, { date: '2025-12-30', systemPin: SYSTEM }));
  assert.equal(old.row.lrNo, 1, '2025 has its own series');
  assert.equal(saved(save(s, { date: '2025-12-31', systemPin: SYSTEM })).row.lrNo, 2);
  assert.equal(saved(save(s)).row.lrNo, 2, 'this year went on from 1');
  assert.equal(s.lrs.defaults(s.db, '2025-12-31').nextNo, 3);
});

test('a refused save does not burn a number', () => {
  const s = setUp();
  assert.equal(saved(save(s)).row.lrNo, 1);
  refused(save(s, { consignee: { firmId: null, name: 'Shree Ganesh Traders', addToFirms: true } })); // exists: rolled back
  assert.equal(saved(save(s)).row.lrNo, 2);
});

test('the same uid twice with the same values returns the first LR and writes nothing more', () => {
  const s = setUp();
  const first = saved(save(s, { uid: 'one-form' }));
  assert.equal(first.again, false);
  const before = footprint(s);
  const second = saved(save(s, { uid: 'one-form' }));
  assert.equal(second.again, true);
  assert.deepEqual(second.row, first.row);
  assert.deepEqual(footprint(s), before);
});

test('a new firm typed on both sides in two spellings is one firm; the retry of that save is the same save', () => {
  const s = setUp();
  const both = {
    consignor: { firmId: null, name: 'ABC Traders', addToFirms: true },
    consignee: { firmId: null, name: 'abc   traders', addToFirms: true }, // saved under the first spelling
  };
  const first = saved(save(s, { uid: 'both', ...both }));
  assert.equal(first.again, false);
  assert.equal(saved(save(s, { uid: 'both', ...both })).again, true);
});

test('a retry of a walk-in added to firms, or of a backdated LR (no PIN sent), is still the same save', () => {
  const s = setUp();
  const added = { consignee: { firmId: null, name: '  Kale   Brothers ', addToFirms: true } };
  assert.equal(saved(save(s, { uid: 'added', ...added })).again, false);
  assert.equal(saved(save(s, { uid: 'added', ...added })).again, true);
  assert.equal(saved(save(s, { uid: 'added', consignee: { firmId: null, name: 'Kale Brothers', addToFirms: false } })).again, true, 'the box ticked or not, it is the same LR');
  const old = { date: '2025-12-30' };
  assert.equal(saved(save(s, { uid: 'old', ...old, systemPin: SYSTEM })).again, false);
  assert.equal(saved(save(s, { uid: 'old', ...old })).again, true, 'a retry needs no PIN');
});

test('the same uid with a changed value is refused: the saved LR is named, nothing is written, the number does not move (O3)', () => {
  const s = setUp();
  const first = saved(save(s, { uid: 'one-form' }));
  const before = footprint(s);
  const changed: Partial<LrInput>[] = [
    { qty: '99' },
    { toPay: '5' },
    { toPay: '', paid: '1,800' },
    { particular: 'Steel pipes' },
    { hamali: '31' },
    { wasuli: '10' },
    { date: '2025-12-30', systemPin: SYSTEM },
    { toStationId: s.yavatmal, fromStationId: s.nagpur },
    { consignee: { firmId: null, name: 'Kale Brothers Pvt', addToFirms: false } },
    { consignee: { firmId: s.ganesh, name: '', addToFirms: false } },
    { qty: 'abc' }, // not even valid
  ];
  for (const over of changed) {
    const r = refused(save(s, { uid: 'one-form', ...over }));
    assert.equal(r.code, 'lr-already-saved', JSON.stringify(over));
    assert.equal(r.lr?.id, first.row.id);
    assert.equal(r.lr?.lrNo, first.row.lrNo);
    assert.deepEqual(footprint(s), before, JSON.stringify(over));
  }
  assert.equal(saved(save(s)).row.lrNo, first.row.lrNo + 1, 'the next LR takes the next number: nothing was burnt or reused');
});

test('a walk-in without "Add to firms" is stored by name only; with it the firm is created in the same save', () => {
  const s = setUp();
  const plain = saved(save(s));
  assert.equal(plain.firmsAdded, false);
  assert.equal(n(s, 'firms'), 1);
  assert.deepEqual(s.db.prepare('SELECT consignor_id AS cid, consignor_name AS cn, consignee_id AS eid, consignee_name AS en FROM lrs WHERE id = ?').get(plain.row.id), {
    cid: s.ganesh, cn: 'Shree Ganesh Traders', eid: null, en: 'Kale Brothers',
  });

  const added = saved(save(s, { consignee: { firmId: null, name: '  Kale   Brothers ', addToFirms: true } }));
  assert.equal(added.firmsAdded, true);
  assert.equal(n(s, 'firms'), 2);
  const firm = s.db.prepare("SELECT id, name FROM firms WHERE name = 'Kale Brothers'").get() as { id: number; name: string };
  assert.equal((s.db.prepare('SELECT consignee_id AS id FROM lrs WHERE id = ?').get(added.row.id) as { id: number }).id, firm.id);
  assert.equal(n(s, 'audit_log') >= 1, true);
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'masters.create' AND entity = 'firms'").get() as { n: number }).n, 2, 'the new firm has its own audit row');
});

test('the same new firm as consignor and consignee is created once', () => {
  const s = setUp();
  const r = saved(save(s, { consignor: { firmId: null, name: 'Om Stores', addToFirms: true }, consignee: { firmId: null, name: 'om  stores', addToFirms: true } }));
  assert.equal(n(s, 'firms'), 2);
  const row = s.db.prepare('SELECT consignor_id AS a, consignee_id AS b FROM lrs WHERE id = ?').get(r.row.id) as { a: number; b: number };
  assert.equal(row.a, row.b);
});

test('"Add to firms" on a name that exists is refused and names the party; nothing is written', () => {
  const s = setUp();
  const before = footprint(s);
  const r = refused(save(s, { consignee: { firmId: null, name: 'shree ganesh traders ', addToFirms: true } }));
  assert.equal(r.code, 'master-exists');
  assert.equal(r.detail, 'consignee');
  assert.deepEqual(footprint(s), before);
});

test('"Add to firms" on a similar name asks first, and saves when resent with confirmSimilar', () => {
  const s = setUp();
  const walkIn = { firmId: null, name: 'Shree Ganesh', addToFirms: true };
  const before = footprint(s);
  const r = refused(save(s, { uid: 'sim', consignor: walkIn }));
  assert.equal(r.code, 'master-similar');
  assert.equal(r.detail, 'consignor');
  assert.deepEqual(r.similar, ['Shree Ganesh Traders']);
  assert.deepEqual(footprint(s), before, 'neither the LR nor the firm');
  const again = saved(save(s, { uid: 'sim', consignor: walkIn, confirmSimilar: true }));
  assert.equal(again.firmsAdded, true);
  assert.equal(n(s, 'firms'), 2);
});

test('every validation refusal writes nothing at all', () => {
  const s = setUp();
  saved(save(s)); // so there is something to compare against
  const bad: [string, Partial<LrInput>][] = [
    ['no consignor', { consignor: { firmId: null, name: ' ', addToFirms: false } }],
    ['no consignee', { consignee: { firmId: null, name: '', addToFirms: true } }],
    ['no to station', { toStationId: null }],
    ['to = from', { toStationId: s.yavatmal }],
    ['no particular', { particular: '  ' }],
    ['no quantity', { qty: '' }],
    ['quantity 0', { qty: '0' }],
    ['quantity 1.5', { qty: '1.5' }],
    ['to pay and paid', { toPay: '10', paid: '10' }],
    ['bad money', { hamali: 'abc' }],
    ['negative money', { wasuli: '-5' }],
    ['future date', { date: '2026-10-30', systemPin: SYSTEM }],
    ['not a date', { date: '2026-02-30', systemPin: SYSTEM }],
    ['unknown station', { toStationId: 999 }],
    ['unknown firm', { consignor: { firmId: 999, name: '', addToFirms: false } }],
  ];
  for (const [what, over] of bad) {
    const before = footprint(s);
    const r = refused(save(s, over));
    assert.equal(r.code, 'lr-invalid', what);
    assert.ok(r.fields && Object.keys(r.fields).length > 0, what);
    assert.deepEqual(footprint(s), before, what);
  }
});

test('the refusal names the field and the reason', () => {
  const s = setUp();
  assert.deepEqual(refused(save(s, { toStationId: s.yavatmal, qty: '0' })).fields, { toStation: 'same', qty: 'whole' });
  assert.deepEqual(refused(save(s, { toPay: '1', paid: '1' })).fields, { paid: 'both' });
  assert.deepEqual(refused(save(s, { toStationId: 999 })).fields, { toStation: 'missing' });
  assert.deepEqual(refused(save(s, { consignor: { firmId: 999, name: '', addToFirms: false } })).fields, { consignor: 'missing' });
});

test('an inactive station or firm is refused, not saved', () => {
  const s = setUp();
  const station = s.db.prepare('SELECT version FROM stations WHERE id = ?').get(s.nagpur) as { version: number };
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'stations', s.nagpur, station.version, false, SYSTEM).ok);
  assert.deepEqual(refused(save(s)).fields, { toStation: 'missing' });
  const firm = s.db.prepare('SELECT version FROM firms WHERE id = ?').get(s.ganesh) as { version: number };
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'firms', s.ganesh, firm.version, false, SYSTEM).ok);
  assert.equal(n(s, 'lrs'), 0);
});

test('a date other than today needs the System PIN; a wrong PIN or none writes nothing', () => {
  const s = setUp();
  const before = footprint(s);
  assert.equal(refused(save(s, { date: '2026-10-20' })).code, 'wrong-pin');
  assert.equal(refused(save(s, { date: '2026-10-20', systemPin: '9999' })).code, 'wrong-pin');
  assert.equal(refused(save(s, { date: '2026-10-20', systemPin: ADMIN })).code, 'wrong-pin', 'the Admin PIN is not the System PIN');
  assert.deepEqual(footprint(s), before);
  const r = saved(save(s, { date: '2026-10-20', systemPin: SYSTEM }));
  assert.equal((s.db.prepare('SELECT lr_date AS d FROM lrs WHERE id = ?').get(r.row.id) as { d: string }).d, '2026-10-20');
  // Today's own date written out is still today: no PIN.
  assert.equal(saved(save(s, { date: TODAY })).row.lrNo, 2);
});

test('preview = saved = lrAmounts: freight + the hamali that was typed', () => {
  const s = setUp();
  const i = input(s, { qty: '3' });
  const p = s.lrs.preview(i);
  assert.ok(p.ok);
  assert.deepEqual(p.value.fields, {});
  // freight 1,800 -> 180000; hamali 30 -> 3000 as typed (it does not follow the quantity); no tax
  assert.deepEqual(p.value.amounts, { freight: 180000, hamali: 3000, total: 183000 });
  const nine = s.lrs.preview({ ...i, qty: '9' });
  assert.ok(nine.ok);
  assert.deepEqual(nine.value.amounts, p.value.amounts, 'the quantity does not change the hamali');
  const r = saved(s.lrs.create(s.db, 'seat-1', i));
  assert.deepEqual(r.amounts, p.value.amounts);
  const row = s.db.prepare('SELECT * FROM lrs WHERE id = ?').get(r.row.id) as Parameters<typeof lrAmounts>[0];
  assert.deepEqual(lrAmounts(row), r.amounts);
});

test('preview writes nothing, answers on a half-filled form, and says what is malformed', () => {
  const s = setUp();
  const before = footprint(s);
  const empty = s.lrs.preview(input(s, { qty: '', toPay: '', hamali: '' }));
  assert.ok(empty.ok);
  assert.deepEqual(empty.value.amounts, { freight: 0, hamali: 0, total: 0 });
  const wrong = s.lrs.preview(input(s, { hamali: 'x', toPay: '10', paid: '5' }));
  assert.ok(wrong.ok);
  assert.deepEqual(wrong.value.fields, { hamali: 'amount', paid: 'both' });
  assert.deepEqual(footprint(s), before);
});

test('byDate lists that day newest first by LR number, with totals from SQL; cancelled LRs are left out', () => {
  const s = setUp();
  const a = saved(save(s, { qty: '2', toPay: '100' }));
  const b = saved(save(s, { qty: '5', toPay: '', paid: '40' }));
  const c = saved(save(s, { qty: '7', toPay: '10' }));
  saved(save(s, { date: '2026-10-20', systemPin: SYSTEM, qty: '100' })); // another day
  s.db.prepare("UPDATE lrs SET status = 'cancelled' WHERE id = ?").run(c.row.id);
  s.db.prepare("UPDATE lrs SET status = 'loaded', memo_id = ? WHERE id = ?").run(insertMemo(s.db), b.row.id);

  const day = s.lrs.byDate(s.db, null);
  assert.ok(day.ok);
  assert.equal(day.value.date, TODAY);
  assert.deepEqual(day.value.rows.map((r) => r.lrNo), [3, 2, 1]);
  assert.deepEqual(day.value.rows[2], { id: a.row.id, lrNo: 1, consignor: 'Shree Ganesh Traders', consignee: 'Kale Brothers', toStation: 'Nagpur', qty: 2, toPayPaise: 10000, paidPaise: 0, status: 'booked' });
  assert.deepEqual(day.value.totals, { count: 2, qty: 7, toPayPaise: 10000, paidPaise: 4000, booked: 1, loaded: 1 });
  const other = s.lrs.byDate(s.db, '2026-10-20');
  assert.ok(other.ok);
  assert.equal(other.value.rows.length, 1);
  const none = s.lrs.byDate(s.db, '2026-01-01');
  assert.ok(none.ok);
  assert.deepEqual(none.value.totals, { count: 0, qty: 0, toPayPaise: 0, paidPaise: 0, booked: 0, loaded: 0 });
});

test('each saved LR has one audit row with its values', () => {
  const s = setUp();
  const r = saved(save(s, {}, 'seat-7'));
  const rows = s.db.prepare("SELECT seat, entity, entity_id AS id, before_json AS before, after_json AS after FROM audit_log WHERE action = 'lrs.create'").all() as Record<string, string | null>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seat, 'seat-7');
  assert.equal(rows[0].entity, 'lrs');
  assert.equal(rows[0].id, String(r.row.id));
  assert.equal(rows[0].before, null);
  assert.equal((JSON.parse(rows[0].after as string) as { lr_no: number }).lr_no, 1);
  assert.equal((s.db.prepare('SELECT seat FROM lrs WHERE id = ?').get(r.row.id) as { seat: string }).seat, 'seat-7');
});

test('LR defaults: no station until the Admin PIN sets it; wrong PIN or a bad station change nothing', () => {
  const s = setUp();
  assert.deepEqual(s.lrs.defaults(s.db, null), { today: TODAY, bookingStationId: null, nextNo: 1 });
  const want = { bookingStationId: s.yavatmal };
  const before = footprint(s);
  const wrong = s.lrs.setDefaults(s.db, 'seat-1', want, SYSTEM);
  assert.equal(wrong.ok === false && wrong.code, 'wrong-pin', 'the System PIN is not enough');
  const noStation = s.lrs.setDefaults(s.db, 'seat-1', { ...want, bookingStationId: 999 }, ADMIN);
  assert.equal(noStation.ok === false && noStation.code, 'lr-invalid');
  assert.deepEqual(footprint(s), before);

  const done = s.lrs.setDefaults(s.db, 'seat-1', want, ADMIN);
  assert.ok(done.ok);
  assert.deepEqual(done.value, { today: TODAY, bookingStationId: s.yavatmal, nextNo: 1 });
  assert.equal(n(s, 'audit_log'), before.audit + 1);
  const row = s.db.prepare("SELECT before_json AS before, after_json AS after FROM audit_log WHERE action = 'settings.lr-defaults'").get() as { before: string; after: string };
  assert.deepEqual([JSON.parse(row.before), JSON.parse(row.after)], [{ bookingStationId: null }, { bookingStationId: s.yavatmal }], 'the audit row carries the booking station only');
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key IN ('defaultChargeOption', 'defaultStaxBp')").get() as { n: number }).n, 0, 'nothing else is written to settings');
  assert.ok(s.lrs.setDefaults(s.db, 'seat-1', { ...want, bookingStationId: null }, ADMIN).ok);
  assert.equal(s.lrs.defaults(s.db, null).bookingStationId, null);
});

// ---- Session 2.3: open, edit, cancel, restore, history ----

const detailOf = (r: KeeperResult<LrDetail>): LrDetail => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.fields ?? r.detail ?? '')}`);
  return r.value;
};
const edit = (s: Set, lr: { id: number; version: number }, over: Partial<LrInput> = {}, pin = SYSTEM, seat = 'seat-1') =>
  s.lrs.update(s.db, seat, lr.id, lr.version, input(s, over), pin);
const updatedOf = (r: KeeperResult<LrUpdated>): LrUpdated => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.fields ?? r.detail ?? '')}`);
  return r.value;
};
const failed = <T>(r: KeeperResult<T>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<T>, { ok: false }>;
};
const open = (s: Set, over: Partial<LrInput> = {}) => detailOf(s.lrs.get(s.db, saved(save(s, over)).row.id));
/** Everything an edit may write, including the row itself. */
const written = (s: Set, id: number) => ({ ...footprint(s), row: JSON.stringify(s.db.prepare('SELECT * FROM lrs WHERE id = ?').get(id)) });
const station = (s: Set, name: string) => {
  const r = s.masters.create(s.db, 'seat-1', 'stations', { name });
  assert.ok(r.ok);
  return r.value.id;
};
const memoNo = (s: Set, memo: number) => (s.db.prepare('SELECT challan_no AS n FROM memos WHERE id = ?').get(memo) as { n: number }).n;

test('get and find open an LR with everything the form needs; find is the current year\'s series', () => {
  const s = setUp();
  const a = saved(save(s, { qty: '3', toPay: '1,800' }));
  const lr = detailOf(s.lrs.get(s.db, a.row.id));
  assert.deepEqual(
    { ...lr, amounts: undefined },
    {
      id: a.row.id, version: 1, status: 'booked', lrNo: 1, lrYear: 2026, date: TODAY, memoNo: null, memoId: null,
      fromStationId: s.yavatmal, toStationId: s.nagpur, consignorId: s.ganesh, consignor: 'Shree Ganesh Traders', consigneeId: null, consignee: 'Kale Brothers',
      particular: 'Cloth bales', qty: 3, toPayPaise: 180000, paidPaise: 0, hamaliPaise: 3000, wasuliPaise: 0, amounts: undefined,
    },
  );
  assert.deepEqual(lr.amounts, a.amounts);
  assert.deepEqual(detailOf(s.lrs.find(s.db, 1)), lr);
  saved(save(s, { date: '2025-12-30', systemPin: SYSTEM })); // 2025's no. 1: not this year's
  assert.equal(detailOf(s.lrs.find(s.db, 1)).id, a.row.id);
  assert.equal(failed(s.lrs.find(s.db, 99)).code, 'lr-missing');
  assert.equal(failed(s.lrs.get(s.db, 12345)).code, 'lr-missing');
});

test('edit: changes only what differs, keeps the number, bumps the version, audits changed fields only', () => {
  const s = setUp();
  const lr = open(s, { toPay: '1,800' });
  const r = updatedOf(edit(s, lr, { toPay: '', paid: '1,800', consignee: { firmId: null, name: 'Patil Hardware', addToFirms: false } }, SYSTEM, 'seat-9'));
  assert.equal(r.changed, true);
  assert.equal(r.firmsAdded, false);
  assert.equal(r.lr.lrNo, lr.lrNo, 'the number never changes');
  assert.equal(r.lr.version, 2);
  assert.equal(r.lr.paidPaise, 180000);
  assert.equal(r.lr.toPayPaise, 0);
  assert.equal(r.lr.consignee, 'Patil Hardware');
  assert.deepEqual(r.lr.amounts, lrAmounts({ topay_paise: 0, paid_paise: 180000, hamali_paise: 3000 }));
  const rows = s.db.prepare("SELECT seat, before_json AS before, after_json AS after FROM audit_log WHERE action = 'lrs.update'").all() as { seat: string; before: string; after: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seat, 'seat-9');
  assert.deepEqual(JSON.parse(rows[0].before), { topay_paise: 180000, paid_paise: 0, consignee_name: 'Kale Brothers' });
  assert.deepEqual(JSON.parse(rows[0].after), { topay_paise: 0, paid_paise: 180000, consignee_name: 'Patil Hardware' });
  assert.equal(n(s, 'lrs'), 1);
  assert.equal(detailOf(s.lrs.get(s.db, lr.id)).version, 2);
});

test('edit with nothing changed writes nothing and says so', () => {
  const s = setUp();
  const lr = open(s);
  const before = written(s, lr.id);
  const r = updatedOf(edit(s, lr)); // the same values as the save
  assert.equal(r.changed, false);
  assert.equal(r.lr.version, 1);
  assert.deepEqual(written(s, lr.id), before);
});

test('edit: a stale version is refused with the current LR and writes nothing', () => {
  const s = setUp();
  const lr = open(s);
  updatedOf(edit(s, lr, { qty: '9' }, SYSTEM, 'seat-1')); // another seat got there first
  const before = written(s, lr.id);
  const stale = failed(edit(s, lr, { qty: '20' }, SYSTEM, 'seat-2')); // still holds version 1
  assert.equal(stale.code, 'lr-stale');
  assert.equal(stale.lr?.version, 2);
  assert.equal(stale.lr?.qty, 9, 'the second seat sees what the first saved');
  assert.deepEqual(written(s, lr.id), before);
});

test('a stale version is told before anything else is looked at: invalid input or a blank reason does not hide it', () => {
  const s = setUp();
  const lr = open(s);
  updatedOf(edit(s, lr, { qty: '9' })); // the LR moved on to version 2
  const update = failed(edit(s, lr, { qty: '0' })); // stale AND invalid
  assert.equal(update.code, 'lr-stale');
  assert.equal(update.lr?.version, 2);
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', lr.id, 1, '', SYSTEM)).code, 'lr-stale');
});

test('edit: no PIN, a wrong PIN or the Admin PIN writes nothing', () => {
  const s = setUp();
  const lr = open(s);
  const before = written(s, lr.id);
  for (const pin of ['', '0000', ADMIN]) assert.equal(failed(edit(s, lr, { qty: '9' }, pin)).code, 'wrong-pin', JSON.stringify(pin));
  assert.deepEqual(written(s, lr.id), before);
});

test('edit: every validation refusal names the field and writes nothing', () => {
  const s = setUp();
  const lr = open(s);
  const before = written(s, lr.id);
  const cases: [Partial<LrInput>, string, string][] = [
    [{ qty: '0' }, 'qty', 'whole'],
    [{ particular: ' ' }, 'particular', 'required'],
    [{ toPay: '10', paid: '5' }, 'paid', 'both'],
    [{ toStationId: s.yavatmal }, 'toStation', 'same'],
    [{ toStationId: 999 }, 'toStation', 'missing'],
    [{ consignor: { firmId: 999, name: '', addToFirms: false } }, 'consignor', 'missing'],
    [{ date: '2026-10-30' }, 'date', 'future'],
  ];
  for (const [over, field, why] of cases) {
    const r = failed(edit(s, lr, over));
    assert.equal(r.code, 'lr-invalid', field);
    assert.equal((r.fields as Record<string, string>)[field], why, field);
  }
  assert.deepEqual(written(s, lr.id), before);
});

test('edit: the date may move within the LR\'s year, never into another year', () => {
  const s = setUp();
  const lr = open(s);
  const before = written(s, lr.id);
  const across = failed(edit(s, lr, { date: '2025-12-31' }));
  assert.equal(across.code, 'lr-invalid');
  assert.equal(across.fields?.date, 'year');
  assert.deepEqual(written(s, lr.id), before);
  const within = updatedOf(edit(s, lr, { date: '2026-01-05' }));
  assert.equal(within.lr.date, '2026-01-05');
  assert.equal(within.lr.lrNo, lr.lrNo, 'and it keeps its number');
  assert.equal(within.lr.lrYear, 2026);
});

test('edit: a walk-in ticked "Add to firms" is saved with the edit; a refusal rolls the whole edit back', () => {
  const s = setUp();
  const lr = open(s);
  const r = updatedOf(edit(s, lr, { consignee: { firmId: null, name: 'Zeta Traders', addToFirms: true } }));
  assert.equal(r.firmsAdded, true);
  assert.notEqual(r.lr.consigneeId, null);
  const before = written(s, lr.id);
  const clash = failed(edit(s, r.lr, { qty: '77', consignee: { firmId: null, name: 'Shree Ganesh Traders', addToFirms: true } }));
  assert.equal(clash.code, 'master-exists');
  assert.deepEqual(written(s, lr.id), before, 'the quantity change did not stay');
});

test('edit: a firm or station deactivated after the save does not stop the LR being edited while it is left alone; a new pick must be active', () => {
  const s = setUp();
  const lr = open(s);
  const pune = station(s, 'Pune');
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'firms', s.ganesh, 1, false, SYSTEM).ok);
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'stations', s.nagpur, 1, false, SYSTEM).ok);
  const r = updatedOf(edit(s, lr, { qty: '8' }));
  assert.equal(r.lr.qty, 8);
  assert.equal(r.lr.consignorId, s.ganesh);
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'stations', pune, 1, false, SYSTEM).ok);
  const bad = failed(edit(s, r.lr, { toStationId: pune }));
  assert.equal(bad.fields?.toStation, 'missing');
});

test('edit of a loaded LR is allowed; it stays loaded on its memo', () => {
  const s = setUp();
  const lr = open(s);
  const memo = insertMemo(s.db);
  s.db.prepare("UPDATE lrs SET status = 'loaded', memo_id = ? WHERE id = ?").run(memo, lr.id);
  const r = updatedOf(edit(s, lr, { qty: '11' }));
  assert.equal(r.lr.qty, 11);
  assert.equal(r.lr.status, 'loaded');
  assert.equal(r.lr.memoNo, memoNo(s, memo));
});

test('a cancelled LR cannot be edited until it is restored', () => {
  const s = setUp();
  const lr = open(s);
  const c = detailOf(s.lrs.cancel(s.db, 'seat-1', lr.id, lr.version, 'wrong party', SYSTEM));
  const before = written(s, lr.id);
  assert.equal(failed(edit(s, c, { qty: '9' })).code, 'lr-cancelled');
  assert.deepEqual(written(s, lr.id), before);
});

test('cancel: needs a reason and the System PIN; it keeps its number, stays listed and leaves the day totals', () => {
  const s = setUp();
  open(s, { qty: '2', toPay: '100' });
  const b = open(s, { qty: '5', toPay: '40' });
  const before = written(s, b.id);
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', b.id, 1, '', SYSTEM)).fields?.reason, 'required');
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', b.id, 1, '   ', SYSTEM)).code, 'lr-invalid');
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', b.id, 1, 'duplicate', '')).code, 'wrong-pin');
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', b.id, 1, 'duplicate', ADMIN)).code, 'wrong-pin');
  assert.deepEqual(written(s, b.id), before);

  const c = detailOf(s.lrs.cancel(s.db, 'seat-3', b.id, 1, '  duplicate   entry ', SYSTEM));
  assert.equal(c.status, 'cancelled');
  assert.equal(c.version, 2);
  assert.equal(c.lrNo, 2);
  const day = s.lrs.byDate(s.db, null);
  assert.ok(day.ok);
  assert.deepEqual(day.value.rows.map((r) => [r.lrNo, r.status]), [[2, 'cancelled'], [1, 'booked']], 'still listed');
  assert.deepEqual(day.value.totals, { count: 1, qty: 2, toPayPaise: 10000, paidPaise: 0, booked: 1, loaded: 0 });
  assert.equal(saved(save(s)).row.lrNo, 3, 'a cancelled number is never reused');
  const audit = s.db.prepare("SELECT seat, before_json AS before, after_json AS after FROM audit_log WHERE action = 'lrs.cancel'").all() as { seat: string; before: string; after: string }[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].seat, 'seat-3');
  assert.deepEqual(JSON.parse(audit[0].before), { status: 'booked' });
  assert.deepEqual(JSON.parse(audit[0].after), { status: 'cancelled', reason: 'duplicate entry' });
});

test('cancel: refused on a stale version, on a cancelled LR, and on an LR that is on a memo (naming the memo)', () => {
  const s = setUp();
  const lr = open(s);
  updatedOf(edit(s, lr, { qty: '9' }));
  const stale = failed(s.lrs.cancel(s.db, 'seat-2', lr.id, 1, 'oops', SYSTEM));
  assert.equal(stale.code, 'lr-stale');
  assert.equal(stale.lr?.version, 2);

  const loaded = open(s);
  const memo = insertMemo(s.db);
  s.db.prepare("UPDATE lrs SET status = 'loaded', memo_id = ? WHERE id = ?").run(memo, loaded.id);
  const before = written(s, loaded.id);
  const refusal = failed(s.lrs.cancel(s.db, 'seat-1', loaded.id, 1, 'oops', SYSTEM));
  assert.equal(refusal.code, 'lr-on-memo');
  assert.equal(refusal.detail, String(memoNo(s, memo)));
  assert.deepEqual(written(s, loaded.id), before);

  const done = detailOf(s.lrs.cancel(s.db, 'seat-1', lr.id, 2, 'oops', SYSTEM));
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', lr.id, done.version, 'again', SYSTEM)).code, 'lr-cancelled');
  assert.equal(failed(s.lrs.cancel(s.db, 'seat-1', 99999, 1, 'x', SYSTEM)).code, 'lr-missing');
});

test('restore: a cancelled LR only, System PIN, back to booked with its number and money', () => {
  const s = setUp();
  const lr = open(s, { toPay: '100' });
  assert.equal(failed(s.lrs.restore(s.db, 'seat-1', lr.id, lr.version, SYSTEM)).code, 'lr-not-cancelled');
  const c = detailOf(s.lrs.cancel(s.db, 'seat-1', lr.id, 1, 'by mistake', SYSTEM));
  const before = written(s, lr.id);
  assert.equal(failed(s.lrs.restore(s.db, 'seat-1', lr.id, c.version, '')).code, 'wrong-pin');
  assert.equal(failed(s.lrs.restore(s.db, 'seat-1', lr.id, c.version, '0000')).code, 'wrong-pin');
  assert.equal(failed(s.lrs.restore(s.db, 'seat-1', lr.id, 1, SYSTEM)).code, 'lr-stale');
  assert.deepEqual(written(s, lr.id), before);
  const back = detailOf(s.lrs.restore(s.db, 'seat-4', lr.id, c.version, SYSTEM));
  assert.equal(back.status, 'booked');
  assert.equal(back.version, 3);
  assert.equal(back.lrNo, lr.lrNo);
  assert.equal(back.toPayPaise, 10000);
  const day = s.lrs.byDate(s.db, null);
  assert.ok(day.ok);
  assert.equal(day.value.totals.count, 1, 'counted again');
});

test('history: newest first, one entry per change, edits list old and new with station names, cancel carries the reason', () => {
  const s = setUp();
  const pune = station(s, 'Pune');
  const lr = open(s);
  const e = updatedOf(edit(s, lr, { toStationId: pune, qty: '4', toPay: '2,000' }, SYSTEM, 'seat-2'));
  const c = detailOf(s.lrs.cancel(s.db, 'seat-3', lr.id, e.lr.version, 'wrong party', SYSTEM));
  detailOf(s.lrs.restore(s.db, 'seat-4', lr.id, c.version, SYSTEM));
  const h = s.lrs.history(s.db, lr.id);
  assert.ok(h.ok);
  assert.deepEqual(h.value.map((x) => [x.action, x.seat]), [['restored', 'seat-4'], ['cancelled', 'seat-3'], ['edited', 'seat-2'], ['created', 'seat-1']]);
  assert.equal(h.value[1].reason, 'wrong party');
  assert.deepEqual(h.value[2].changes, [
    { field: 'toStation', from: 'Nagpur', to: 'Pune' },
    { field: 'qty', from: 3, to: 4 },
    { field: 'toPay', from: 180000, to: 200000 },
  ]);
  assert.deepEqual(h.value[0].changes, []);
  assert.ok(h.value.every((x) => /^\d{4}-\d\d-\d\dT/.test(x.at)));
  const none = s.lrs.history(s.db, 99999);
  assert.ok(none.ok);
  assert.deepEqual(none.value, []);
});

test('history: at most 50 entries, newest first', () => {
  const s = setUp();
  let lr = open(s);
  for (let i = 0; i < 55; i++) lr = updatedOf(edit(s, lr, { qty: String(10 + i) })).lr;
  const h = s.lrs.history(s.db, lr.id);
  assert.ok(h.ok);
  assert.equal(h.value.length, 50);
  assert.equal(h.value[0].changes[0].to, 64, 'the newest');
});

// ---- Session 4.5: the LR as the customer approved it (no charge option, godown, delivery or service tax) ----
const OLD_COLUMNS = 'charge_option, godown_bhada_paise, godown_insurance_paise, delivery_charges_paise, pf_paise, stax_bp';
const oldColumnsOf = (s: Set, id: number) => s.db.prepare(`SELECT ${OLD_COLUMNS} FROM lrs WHERE id = ?`).get(id);
const NONE = { charge_option: 'blank', godown_bhada_paise: 0, godown_insurance_paise: 0, delivery_charges_paise: 0, pf_paise: 0, stax_bp: 0 };

test('a saved LR and an edited LR leave the older charge and tax columns at 0 / blank', () => {
  const s = setUp();
  const a = saved(save(s, { qty: '3', toPay: '1,800', hamali: '30' }));
  assert.deepEqual(oldColumnsOf(s, a.row.id), NONE);
  assert.deepEqual(a.amounts, { freight: 180000, hamali: 3000, total: 183000 });
  const lr = detailOf(s.lrs.get(s.db, a.row.id));
  updatedOf(edit(s, lr, { hamali: '45', toPay: '', paid: '1,800' }));
  assert.deepEqual(oldColumnsOf(s, a.row.id), NONE);
  assert.deepEqual(detailOf(s.lrs.get(s.db, a.row.id)).amounts, { freight: 180000, hamali: 4500, total: 184500 });
});

test('an LR saved before 4.5 adds only freight + hamali; an edit leaves its old columns as they were and does not audit them', () => {
  const s = setUp();
  const a = saved(save(s, { uid: 'old-form', qty: '3', toPay: '1,800', hamali: '30' }));
  // What the older program wrote: option 1, godown and delivery charges, PF, 5% service tax.
  s.db.prepare("UPDATE lrs SET charge_option = 'option1', godown_bhada_paise = 500, godown_insurance_paise = 500, delivery_charges_paise = 200, pf_paise = 100, stax_bp = 500 WHERE id = ?").run(a.row.id);
  const old = { charge_option: 'option1', godown_bhada_paise: 500, godown_insurance_paise: 500, delivery_charges_paise: 200, pf_paise: 100, stax_bp: 500 };
  const lr = detailOf(s.lrs.get(s.db, a.row.id));
  assert.deepEqual(lr.amounts, { freight: 180000, hamali: 3000, total: 183000 }, 'the old columns count for nothing');
  const r = updatedOf(edit(s, lr, { hamali: '31' }));
  assert.deepEqual(r.lr.amounts, { freight: 180000, hamali: 3100, total: 183100 });
  assert.deepEqual(oldColumnsOf(s, a.row.id), old, 'the edit did not touch them');
  const row = s.db.prepare("SELECT before_json AS before, after_json AS after FROM audit_log WHERE action = 'lrs.update'").get() as { before: string; after: string };
  assert.deepEqual([JSON.parse(row.before), JSON.parse(row.after)], [{ hamali_paise: 3000 }, { hamali_paise: 3100 }]);
  // A retry of the first save (O3) compares only the fields that remain: the old columns neither match nor mismatch.
  assert.equal(failed(s.lrs.create(s.db, 'seat-1', input(s, { uid: 'old-form', qty: '3', toPay: '1,800', hamali: '30' }))).code, 'lr-already-saved', 'hamali was edited since');
  const lr2 = detailOf(s.lrs.get(s.db, a.row.id));
  assert.equal(saved(s.lrs.create(s.db, 'seat-1', input(s, { uid: 'old-form', qty: '3', toPay: '1,800', hamali: '31' }))).again, true);
  assert.equal(lr2.version, r.lr.version);
});

test('the History of an edit written before 4.5 still reads: old fields come after the current ones, with old → new', () => {
  const s = setUp();
  const a = saved(save(s, { qty: '3', toPay: '1,800', hamali: '30' }));
  s.db
    .prepare("INSERT INTO audit_log (seat, action, entity, entity_id, before_json, after_json) VALUES ('PC01', 'lrs.update', 'lrs', ?, ?, ?)")
    .run(String(a.row.id), JSON.stringify({ charge_option: 'blank', godown_bhada_paise: 0, stax_bp: 0, hamali_paise: 0 }), JSON.stringify({ charge_option: 'option1', godown_bhada_paise: 500, stax_bp: 250, hamali_paise: 3000 }));
  const h = s.lrs.history(s.db, a.row.id);
  assert.ok(h.ok);
  const edited = h.value.find((e) => e.action === 'edited');
  assert.deepEqual(edited?.changes, [
    { field: 'hamali', from: 0, to: 3000 },
    { field: 'chargeOption', from: 'blank', to: 'option1' },
    { field: 'godownBhada', from: 0, to: 500 },
    { field: 'staxPercent', from: '0', to: '2.5' },
  ]);
});

// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult, LrInput, LrSaved } from '../shared';
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
  chargeOption: 'option1',
  godownBhada: '5',
  godownInsurance: '5',
  deliveryCharges: '2',
  hamali: '30',
  wasuli: '',
  staxPercent: '5',
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

test('the same uid twice returns the first LR and writes nothing more', () => {
  const s = setUp();
  const first = saved(save(s, { uid: 'one-form' }));
  assert.equal(first.again, false);
  const before = footprint(s);
  const second = saved(save(s, { uid: 'one-form', qty: '99', toPay: '5' })); // even if the retry differs: it is the same save
  assert.equal(second.again, true);
  assert.deepEqual(second.row, first.row);
  assert.deepEqual(footprint(s), before);
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
    ['bad tax', { staxPercent: '150' }],
    ['bad option', { chargeOption: 'option9' as 'blank' }],
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

test('preview = saved = lrAmounts, and the charge defaults come from the chosen option and quantity', () => {
  const s = setUp();
  const i = input(s, { qty: '3' });
  const p = s.lrs.preview(s.db, i);
  assert.ok(p.ok);
  assert.deepEqual(p.value.defaults, { godownBhada: 500, godownInsurance: 500, deliveryCharges: 200, hamali: 3000 }, 'option 1: hamali Rs 10 per dag x 3');
  assert.deepEqual(p.value.fields, {});
  // freight 1,800 -> 180000; charges 500+500+200+3000; tax 5% of freight = 9000
  assert.deepEqual(p.value.amounts, { freight: 180000, charges: 3000 + 500 + 500 + 200, stax: 9000, total: 180000 + 4200 + 9000 });
  const r = saved(s.lrs.create(s.db, 'seat-1', i));
  assert.deepEqual(r.amounts, p.value.amounts);
  const row = s.db.prepare('SELECT * FROM lrs WHERE id = ?').get(r.row.id) as Parameters<typeof lrAmounts>[0];
  assert.deepEqual(lrAmounts(row), r.amounts);
});

test('preview writes nothing, answers on a half-filled form, and says what is malformed', () => {
  const s = setUp();
  const before = footprint(s);
  const empty = s.lrs.preview(s.db, input(s, { qty: '', toPay: '', godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '', staxPercent: '', chargeOption: 'blank' }));
  assert.ok(empty.ok);
  assert.deepEqual(empty.value.amounts, { freight: 0, charges: 0, stax: 0, total: 0 });
  assert.deepEqual(empty.value.defaults, { godownBhada: 0, godownInsurance: 0, deliveryCharges: 0, hamali: 0 });
  const wrong = s.lrs.preview(s.db, input(s, { hamali: 'x', staxPercent: '200', toPay: '10', paid: '5' }));
  assert.ok(wrong.ok);
  assert.deepEqual(wrong.value.fields, { hamali: 'amount', staxPercent: 'percent', paid: 'both' });
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

test('LR defaults: blank option, 0% and no station until the Admin PIN sets them; wrong PIN or bad values change nothing', () => {
  const s = setUp();
  assert.deepEqual(s.lrs.defaults(s.db, null), { today: TODAY, bookingStationId: null, chargeOption: 'blank', staxPercent: '0', nextNo: 1 });
  const want = { bookingStationId: s.yavatmal, chargeOption: 'option2' as const, staxPercent: '2.5' };
  const before = footprint(s);
  const wrong = s.lrs.setDefaults(s.db, 'seat-1', want, SYSTEM);
  assert.equal(wrong.ok === false && wrong.code, 'wrong-pin', 'the System PIN is not enough');
  const bad = s.lrs.setDefaults(s.db, 'seat-1', { ...want, staxPercent: '101' }, ADMIN);
  assert.equal(bad.ok === false && bad.code, 'lr-invalid');
  const noStation = s.lrs.setDefaults(s.db, 'seat-1', { ...want, bookingStationId: 999 }, ADMIN);
  assert.equal(noStation.ok === false && noStation.code, 'lr-invalid');
  assert.deepEqual(footprint(s), before);

  const done = s.lrs.setDefaults(s.db, 'seat-1', want, ADMIN);
  assert.ok(done.ok);
  assert.deepEqual(done.value, { today: TODAY, bookingStationId: s.yavatmal, chargeOption: 'option2', staxPercent: '2.5', nextNo: 1 });
  assert.equal(n(s, 'audit_log'), before.audit + 1);
  assert.ok(s.lrs.setDefaults(s.db, 'seat-1', { ...want, bookingStationId: null }, ADMIN).ok);
  assert.equal(s.lrs.defaults(s.db, null).bookingStationId, null);
});

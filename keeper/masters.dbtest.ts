// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firm, KeeperResult, MasterKind, MasterRow } from '../shared';
import { makeMasters } from './masters';
import { makePins } from './pins';
import { freshDb } from './testing';

const SYSTEM = '2222';

function setUp() {
  const pins = makePins();
  const db = freshDb();
  assert.ok(pins.setup(db, 'seat-1', '1111', SYSTEM).ok);
  return { db, m: makeMasters(pins) };
}

type Set = ReturnType<typeof setUp>;
const saved = (r: KeeperResult<MasterRow>): MasterRow => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${r.detail ?? ''}`);
  return r.value;
};
const refused = (r: KeeperResult<MasterRow>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<MasterRow>, { ok: false }>;
};
const create = (s: Set, kind: MasterKind, fields: Parameters<Set['m']['create']>[3], confirm = false) => s.m.create(s.db, 'seat-1', kind, fields, confirm);
const update = (s: Set, kind: MasterKind, row: MasterRow, fields: Parameters<Set['m']['create']>[3], pin = SYSTEM, confirm = false) =>
  s.m.update(s.db, 'seat-1', kind, row.id, row.version, fields, pin, confirm);
const setActive = (s: Set, kind: MasterKind, row: MasterRow, active: boolean, pin = SYSTEM) =>
  s.m.setActive(s.db, 'seat-1', kind, row.id, row.version, active, pin);
const audits = (s: Set) =>
  s.db.prepare("SELECT action, entity, entity_id AS id, before_json AS before, after_json AS after FROM audit_log WHERE action LIKE 'masters.%' ORDER BY id").all() as Record<string, string | null>[];
const count = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('create saves each kind and returns the saved row', () => {
  const s = setUp();
  assert.deepEqual(saved(create(s, 'stations', { name: '  Yavatmal ' })), { id: 1, name: 'Yavatmal', active: true, version: 1 });
  const firm = saved(create(s, 'firms', { name: 'Shree Ganesh Traders', stationId: 1, phone: '98220 12345' })) as Firm;
  assert.deepEqual({ ...firm, id: 0 }, { id: 0, name: 'Shree Ganesh Traders', stationId: 1, phone: '9822012345', active: true, version: 1 });
  assert.deepEqual(saved(create(s, 'trucks', { number: 'mh-29 be 1234' })), { id: 1, number: 'MH-29 BE 1234', active: true, version: 1 });
  assert.deepEqual(saved(create(s, 'drivers', { name: 'Ravi Kumar', phone: '+91 98220-12345' })), { id: 1, name: 'Ravi Kumar', phone: '919822012345', active: true, version: 1 });
  assert.equal((saved(create(s, 'firms', { name: 'Zed Firm' })) as Firm).stationId, null, 'the station is optional');
  assert.equal((saved(create(s, 'firms', { name: 'Yak Firm', stationId: null })) as Firm).stationId, null);
});

test('all() lists active and inactive rows in name / number order, not by id', () => {
  const s = setUp();
  const b = saved(create(s, 'stations', { name: 'Bori' }));
  saved(create(s, 'stations', { name: 'Akola' }));
  saved(create(s, 'stations', { name: 'darwha' }));
  saved(setActive(s, 'stations', b, false));
  saved(create(s, 'trucks', { number: 'MH 29 BE 2000' }));
  saved(create(s, 'trucks', { number: 'MH 29 BE 1000' }));
  saved(create(s, 'drivers', { name: 'zahir' }));
  saved(create(s, 'drivers', { name: 'Anil' }));
  saved(create(s, 'drivers', { name: 'anil kale', phone: '123' }, true)); // similar to Anil, confirmed
  const all = s.m.all(s.db);
  assert.deepEqual(all.stations.map((r) => [r.name, r.active]), [['Akola', true], ['Bori', false], ['darwha', true]]);
  assert.deepEqual(all.trucks.map((r) => r.number), ['MH 29 BE 1000', 'MH 29 BE 2000']);
  assert.deepEqual(all.drivers.map((r) => r.name), ['Anil', 'anil kale', 'zahir']);
});

test('stations: a duplicate name is refused, however it is typed, active or not', () => {
  const s = setUp();
  const first = saved(create(s, 'stations', { name: 'Nagpur' }));
  for (const typed of ['nagpur', '  NAGPUR ', 'Nagpur  ']) {
    const r = refused(create(s, 'stations', { name: typed }));
    assert.equal(r.code, 'master-exists', typed);
    assert.deepEqual(r.row, first);
  }
  const off = saved(setActive(s, 'stations', first, false));
  const again = refused(create(s, 'stations', { name: 'nagpur' }));
  assert.equal(again.code, 'master-exists');
  assert.deepEqual(again.row, off, 'the inactive row is handed back so the screen can offer to reactivate it');
  assert.equal(saved(create(s, 'stations', { name: 'Nagpur City' })).id, 2, 'stations have no similar-name rule');
  assert.equal(count(s, 'stations'), 2);
});

test('firms: exact duplicate refused; a similar name needs confirmation and then saves', () => {
  const s = setUp();
  const first = saved(create(s, 'firms', { name: 'Shree Ganesh Traders' }));
  assert.equal(refused(create(s, 'firms', { name: 'shree ganesh traders ' })).code, 'master-exists');
  assert.equal(refused(create(s, 'firms', { name: 'shree ganesh traders ' }, true)).code, 'master-exists', 'confirming does not allow an exact duplicate');

  const longer = refused(create(s, 'firms', { name: 'Shree Ganesh Traders and Sons' }));
  assert.equal(longer.code, 'master-similar');
  assert.deepEqual(longer.similar, ['Shree Ganesh Traders']);
  assert.equal(count(s, 'firms'), 1, 'nothing is saved until confirmed');
  assert.equal(saved(create(s, 'firms', { name: 'Shree Ganesh Traders and Sons' }, true)).id, 2);

  assert.deepEqual(refused(create(s, 'firms', { name: 'Shree Ganesh' })).similar, ['Shree Ganesh Traders', 'Shree Ganesh Traders and Sons']);
  assert.equal(saved(create(s, 'firms', { name: 'Ganesh Traders' })).id, 3, 'a name that only contains the text is not similar');
  assert.equal(first.id, 1);
});

test('firms: the station must exist and be active (a station the firm already has stays allowed)', () => {
  const s = setUp();
  const live = saved(create(s, 'stations', { name: 'Live' }));
  const dead = saved(create(s, 'stations', { name: 'Dead' }));
  const firm = saved(create(s, 'firms', { name: 'Alpha', stationId: dead.id }));
  saved(setActive(s, 'stations', dead, false));
  assert.equal(refused(create(s, 'firms', { name: 'Beta', stationId: dead.id })).detail, 'station');
  assert.equal(refused(create(s, 'firms', { name: 'Gamma', stationId: 999 })).detail, 'station');
  assert.equal(refused(create(s, 'firms', { name: 'Gamma', stationId: 1.5 })).detail, 'station');
  assert.equal((saved(update(s, 'firms', firm, { name: 'Alpha', stationId: dead.id, phone: '1' })) as Firm).stationId, dead.id);
  assert.equal(refused(update(s, 'firms', saved(create(s, 'firms', { name: 'Delta' })), { name: 'Delta', stationId: dead.id })).detail, 'station');
  assert.equal(saved(create(s, 'firms', { name: 'Epsilon', stationId: live.id })).id, 3);
});

test('trucks: the number is compared without case, spaces, dots and dashes', () => {
  const s = setUp();
  const first = saved(create(s, 'trucks', { number: 'MH 29 BE 1234' }));
  for (const typed of ['mh-29-be-1234', 'Mh.29.Be.1234', 'mh29be1234 ']) {
    const r = refused(create(s, 'trucks', { number: typed }));
    assert.equal(r.code, 'master-exists', typed);
    assert.deepEqual(r.row, first);
  }
  assert.equal(saved(create(s, 'trucks', { number: 'MH 29 BE 1235' })).id, 2);
});

test('drivers: same name and phone is refused, same name alone needs confirmation', () => {
  const s = setUp();
  const first = saved(create(s, 'drivers', { name: 'Ravi Kumar', phone: '9822012345' }));
  const same = refused(create(s, 'drivers', { name: ' ravi  kumar', phone: '98220 12345' }));
  assert.equal(same.code, 'master-exists');
  assert.deepEqual(same.row, first);

  const sameName = refused(create(s, 'drivers', { name: 'Ravi Kumar', phone: '9000000000' }));
  assert.equal(sameName.code, 'master-similar');
  assert.deepEqual(sameName.similar, ['Ravi Kumar · 9822012345']);
  assert.equal(count(s, 'drivers'), 1);
  assert.equal(saved(create(s, 'drivers', { name: 'Ravi Kumar', phone: '9000000000' }, true)).id, 2);
  assert.equal(refused(create(s, 'drivers', { name: 'Ravi Kumar', phone: '9000000000' }, true)).code, 'master-exists');
  assert.equal(saved(create(s, 'drivers', { name: 'Suresh' })).id, 3);
});

test('values that cannot be saved are refused naming the field, and nothing is written', () => {
  const s = setUp();
  assert.equal(refused(create(s, 'stations', { name: '   ' })).detail, 'name');
  assert.equal(refused(create(s, 'stations', {})).detail, 'name');
  assert.equal(refused(create(s, 'stations', { name: 5 as unknown as string })).detail, 'name');
  assert.equal(refused(create(s, 'trucks', { number: '' })).detail, 'number');
  assert.equal(refused(create(s, 'drivers', { name: 'Ravi', phone: '98x' })).detail, 'phone');
  assert.equal(refused(create(s, 'firms', { name: 'Alpha', phone: '1'.repeat(16) })).detail, 'phone');
  assert.equal(count(s, 'stations') + count(s, 'trucks') + count(s, 'drivers') + count(s, 'firms'), 0);
  assert.deepEqual(audits(s), [], 'a refused write leaves no audit row');
});

test('update needs the System PIN: a wrong one is refused and nothing is written', () => {
  const s = setUp();
  const row = saved(create(s, 'stations', { name: 'Nagpur' }));
  assert.deepEqual(refused(update(s, 'stations', row, { name: 'Nagpur East' }, '9999')).code, 'wrong-pin');
  assert.equal(refused(update(s, 'stations', row, { name: 'Nagpur East' }, '1111')).code, 'wrong-pin', 'the Admin PIN is not the System PIN');
  assert.deepEqual(s.m.all(s.db).stations, [row]);
  assert.equal(audits(s).length, 1, 'only the create');

  const after = saved(update(s, 'stations', row, { name: 'Nagpur East' }));
  assert.deepEqual(after, { id: row.id, name: 'Nagpur East', active: true, version: 2 });
});

test('update: a stale version is refused with the current row; the winner keeps the data', () => {
  const s = setUp();
  const mine = saved(create(s, 'trucks', { number: 'MH 29 BE 1234' }));
  const theirs = saved(update(s, 'trucks', mine, { number: 'MH 29 BE 9999' }));
  const r = refused(update(s, 'trucks', mine, { number: 'MH 29 BE 5555' }));
  assert.equal(r.code, 'master-stale');
  assert.deepEqual(r.row, theirs);
  assert.deepEqual(s.m.all(s.db).trucks, [theirs]);
  assert.equal(refused(s.m.update(s.db, 's', 'trucks', 999, 1, { number: 'X' }, SYSTEM)).code, 'master-missing');
});

test('correcting a phone or station does not re-ask about a similar name that was already there', () => {
  const s = setUp();
  saved(create(s, 'drivers', { name: 'Ramesh', phone: '1' }));
  const second = saved(create(s, 'drivers', { name: 'Ramesh', phone: '2' }, true));
  assert.equal(saved(update(s, 'drivers', second, { name: 'Ramesh', phone: '3' })).version, 2, 'two Rameshes: fixing a phone needs no confirmation');
  saved(create(s, 'firms', { name: 'Shree Ganesh' }));
  const long = saved(create(s, 'firms', { name: 'Shree Ganesh Traders' }, true));
  const fixed = saved(update(s, 'firms', long, { name: 'Shree Ganesh Traders', phone: '9' }));
  assert.equal(fixed.version, 2);
  assert.equal(refused(update(s, 'firms', fixed, { name: 'Shree Ganesh Traders Ltd', phone: '9' })).code, 'master-similar', 'changing the name still asks');
  assert.equal(refused(update(s, 'firms', fixed, { name: 'shree ganesh' })).code, 'master-exists', 'an exact duplicate is still refused');
});

test('a value of the wrong type is refused, not dropped or guessed', () => {
  const s = setUp();
  assert.equal(refused(create(s, 'firms', { name: 'Alpha', phone: 5 as unknown as string })).detail, 'phone');
  assert.equal(refused(create(s, 'firms', { name: 'Alpha', stationId: '1' as unknown as number })).detail, 'station');
  assert.equal(refused(create(s, 'trucks', { number: ['x'] as unknown as string })).detail, 'number');
  assert.equal(count(s, 'firms') + count(s, 'trucks'), 0);
});

test('update runs the same duplicate and similar checks, leaving the row itself out', () => {
  const s = setUp();
  const a = saved(create(s, 'firms', { name: 'Alpha Traders' }));
  const b = saved(create(s, 'firms', { name: 'Beta Traders' }));
  assert.equal(refused(update(s, 'firms', b, { name: 'alpha traders' })).code, 'master-exists');
  assert.equal(refused(update(s, 'firms', b, { name: 'Alpha Traders Ltd' })).code, 'master-similar');
  const same = saved(update(s, 'firms', a, { name: 'ALPHA TRADERS', phone: '123' })) as Firm;
  assert.deepEqual([same.name, same.phone, same.version], ['ALPHA TRADERS', '123', 2], 'a change of case or phone on its own row is not a duplicate');
  assert.equal(saved(update(s, 'firms', b, { name: 'Alpha Traders Ltd' }, SYSTEM, true)).id, b.id);

  const d1 = saved(create(s, 'drivers', { name: 'Ravi', phone: '1' }));
  const d2 = saved(create(s, 'drivers', { name: 'Anil', phone: '2' }));
  assert.equal(refused(update(s, 'drivers', d2, { name: 'Ravi', phone: '1' })).code, 'master-exists');
  assert.equal(saved(update(s, 'drivers', d1, { name: 'Ravi', phone: '3' })).version, 2);
});

test('deactivate asks the System PIN, keeps the row and its id; reactivate needs no PIN', () => {
  const s = setUp();
  const row = saved(create(s, 'firms', { name: 'Alpha' }));
  assert.equal(refused(setActive(s, 'firms', row, false, '0000')).code, 'wrong-pin');
  assert.equal(s.m.all(s.db).firms[0].active, true);

  const off = saved(setActive(s, 'firms', row, false));
  assert.deepEqual([off.id, off.active, off.version], [row.id, false, 2]);
  assert.equal(s.m.all(s.db).firms.length, 1, 'the row stays for old LRs and reports');
  assert.equal(count(s, 'firms'), 1);

  const on = saved(setActive(s, 'firms', off, true, ''));
  assert.deepEqual([on.active, on.version], [true, 3]);
  assert.equal(refused(setActive(s, 'firms', off, false)).code, 'master-stale', 'the old version is stale now');
  assert.equal(saved(setActive(s, 'firms', on, true)).version, 3, 'already active: nothing changes');
});

test('every write has its audit row, in the same transaction, never holding a PIN', () => {
  const s = setUp();
  const row = saved(create(s, 'stations', { name: 'Nagpur' }));
  const edited = saved(update(s, 'stations', row, { name: 'Nagpur East' }));
  const off = saved(setActive(s, 'stations', edited, false));
  saved(setActive(s, 'stations', off, true));
  refused(update(s, 'stations', row, { name: 'stale' })); // refused: no row
  assert.deepEqual(audits(s).map((a) => [a.action, a.entity, a.id]), [
    ['masters.create', 'stations', '1'],
    ['masters.update', 'stations', '1'],
    ['masters.deactivate', 'stations', '1'],
    ['masters.activate', 'stations', '1'],
  ]);
  const [create_, update_] = audits(s);
  assert.equal(create_.before, null);
  assert.equal(JSON.parse(create_.after ?? '').name, 'Nagpur');
  assert.equal(JSON.parse(update_.before ?? '').name, 'Nagpur');
  assert.equal(JSON.parse(update_.after ?? '').name, 'Nagpur East');
  assert.ok(!audits(s).some((a) => /2222/.test(`${a.before}${a.after}`)));

  // The audit table refuses to be written outside the change: if it fails, the master row is not saved either.
  s.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'masters.create' BEGIN SELECT RAISE(ABORT, 'audit down'); END");
  assert.throws(() => create(s, 'stations', { name: 'Akola' }), /audit down/);
  assert.equal(count(s, 'stations'), 1, 'the station was rolled back with its audit row');
});

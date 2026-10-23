// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Every rule the card puts in the schema is proven by trying to break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, insert, insertLr, insertMemo, insertStation, insertTruck } from './testing';

const CHECK = /CHECK constraint failed/;
const UNIQUE = /UNIQUE constraint failed/;

test('a minimal valid LR and memo are accepted', () => {
  const db = freshDb();
  const memo = insertMemo(db);
  insertLr(db);
  insertLr(db, { status: 'loaded', memo_id: memo, topay_paise: 100000, stax_bp: 500, charge_option: 'option1' });
  insertLr(db, { status: 'cancelled' });
  insertLr(db, { paid_paise: 5000 });
});

test('an LR cannot be both to pay and paid', () => {
  const db = freshDb();
  assert.throws(() => insertLr(db, { topay_paise: 100, paid_paise: 100 }), CHECK);
  insertLr(db, { topay_paise: 100, paid_paise: 0 });
  insertLr(db, { topay_paise: 0, paid_paise: 100 });
});

test('loaded needs a memo, and a memo needs loaded', () => {
  const db = freshDb();
  const memo = insertMemo(db);
  assert.throws(() => insertLr(db, { status: 'loaded' }), CHECK);
  assert.throws(() => insertLr(db, { status: 'booked', memo_id: memo }), CHECK);
  assert.throws(() => insertLr(db, { status: 'cancelled', memo_id: memo }), CHECK);
  insertLr(db, { status: 'loaded', memo_id: memo });
});

test('negative paise, quantity or memo money is refused, in every column', () => {
  const db = freshDb();
  for (const col of ['topay_paise', 'paid_paise', 'godown_bhada_paise', 'godown_insurance_paise', 'delivery_charges_paise', 'hamali_paise', 'pf_paise', 'wasuli_paise', 'qty']) {
    assert.throws(() => insertLr(db, { [col]: -1 }), CHECK, col);
  }
  for (const col of ['truck_hire_paise', 'loading_hamali_paise', 'frozen_lr_count', 'frozen_qty', 'frozen_topay_paise', 'frozen_paid_paise', 'frozen_charges_paise', 'frozen_stax_paise']) {
    assert.throws(() => insertMemo(db, { [col]: -1 }), CHECK, col);
  }
});

test('service tax is between 0 and 10000 basis points', () => {
  const db = freshDb();
  insertLr(db, { stax_bp: 0 });
  insertLr(db, { stax_bp: 10000 });
  assert.throws(() => insertLr(db, { stax_bp: 10001 }), CHECK);
  assert.throws(() => insertLr(db, { stax_bp: -1 }), CHECK);
});

test('LR and memo numbers are unique within their year, not across years', () => {
  const db = freshDb();
  insertLr(db, { lr_year: 2026, lr_no: 500 });
  assert.throws(() => insertLr(db, { lr_year: 2026, lr_no: 500 }), UNIQUE);
  insertLr(db, { lr_year: 2027, lr_date: '2027-01-02', lr_no: 500 });
  insertMemo(db, { challan_year: 2026, challan_no: 900 });
  assert.throws(() => insertMemo(db, { challan_year: 2026, challan_no: 900 }), UNIQUE);
  insertMemo(db, { challan_year: 2027, memo_date: '2027-01-02', challan_no: 900 });
});

test('only whole numbers are stored in paise, quantity, tax and number columns', () => {
  const db = freshDb();
  const STRICT = /cannot store (REAL|TEXT) value in INTEGER column/;
  for (const col of ['topay_paise', 'paid_paise', 'godown_bhada_paise', 'hamali_paise', 'pf_paise', 'wasuli_paise', 'qty', 'stax_bp', 'lr_no']) {
    assert.throws(() => insertLr(db, { [col]: 12.5 }), STRICT, `${col} = 12.5`);
    assert.throws(() => insertLr(db, { [col]: 'abc' }), STRICT, `${col} = 'abc'`);
  }
  for (const col of ['truck_hire_paise', 'frozen_topay_paise', 'frozen_qty']) {
    assert.throws(() => insertMemo(db, { [col]: 0.5 }), STRICT, col);
  }
  assert.throws(() => insert(db, 'counters', { name: 'lr', year: 2026, last: 1.5 }), STRICT);
  insertLr(db, { topay_paise: 12 }); // a whole number is fine
});

test('dates are ISO text and the year column matches the date', () => {
  const db = freshDb();
  for (const bad of ['24-10-2026', '2026/10/24', '2026-10-2', 'today', '']) {
    assert.throws(() => insertLr(db, { lr_date: bad }), CHECK, bad);
    assert.throws(() => insertMemo(db, { memo_date: bad }), CHECK, bad);
  }
  assert.throws(() => insertLr(db, { lr_year: 2027, lr_date: '2026-12-31' }), CHECK);
  assert.throws(() => insertMemo(db, { challan_year: 2025, memo_date: '2026-01-01' }), CHECK);
  insertLr(db, { lr_year: 2026, lr_date: '2026-12-31' });
  insertLr(db, { lr_year: 2027, lr_date: '2027-01-01' });
});

test('a caller-made uid can be used once only', () => {
  const db = freshDb();
  insertLr(db, { uid: 'same' });
  assert.throws(() => insertLr(db, { uid: 'same' }), UNIQUE);
  insertMemo(db, { uid: 'same' }); // lrs and memos have separate uid spaces
  assert.throws(() => insertMemo(db, { uid: 'same' }), UNIQUE);
});

test('status, charge option, active flag and counter name only take the listed values', () => {
  const db = freshDb();
  assert.throws(() => insertLr(db, { status: 'done' }), CHECK);
  assert.throws(() => insertLr(db, { charge_option: 'option3' }), CHECK);
  assert.throws(() => insertMemo(db, { status: 'loaded' }), CHECK);
  assert.throws(() => insert(db, 'stations', { name: 'X', name_key: 'x', active: 2, seat: 't' }), CHECK);
  assert.throws(() => insert(db, 'counters', { name: 'receipt', year: 2026, last: 0 }), CHECK);
  assert.throws(() => insert(db, 'counters', { name: 'lr', year: 2026, last: -1 }), CHECK);
});

test('names are unique by key, so differently spelt copies are refused', () => {
  const db = freshDb();
  insertStation(db, 'Yavatmal');
  assert.throws(() => insertStation(db, '  YAVATMAL '), UNIQUE);
  insertTruck(db, 'MH 29 AB 1234');
  assert.throws(() => insertTruck(db, 'mh  29 ab 1234'), UNIQUE);
  const firm = (name: string, key: string) => insert(db, 'firms', { name, name_key: key, seat: 't' });
  firm('Raj Kumar', 'raj kumar');
  assert.throws(() => firm('raj kumar', 'raj kumar'), UNIQUE);
});

test('foreign keys are enforced', () => {
  const db = freshDb();
  assert.throws(() => insertLr(db, { to_station_id: 99999 }), /FOREIGN KEY constraint failed/);
  assert.throws(() => insertLr(db, { consignor_id: 99999 }), /FOREIGN KEY constraint failed/);
  assert.throws(() => insertMemo(db, { truck_id: 99999 }), /FOREIGN KEY constraint failed/);
});

test('every business table records seat, timestamps and a starting version', () => {
  const db = freshDb();
  const id = insertStation(db, 'Wardha');
  const row = db.prepare('SELECT seat, version, created_at, updated_at FROM stations WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(row.seat, 'test');
  assert.equal(row.version, 1);
  assert.match(String(row.created_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(row.created_at, row.updated_at);
  assert.throws(() => insert(db, 'stations', { name: 'No seat', name_key: 'no seat' }), /NOT NULL constraint failed/);
});

test('the audit log is append-only', () => {
  const db = freshDb();
  const id = insert(db, 'audit_log', { seat: 't', action: 'test', entity: 'lr', entity_id: '1' });
  assert.throws(() => db.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('changed', id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(id), /append-only/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 1);
});

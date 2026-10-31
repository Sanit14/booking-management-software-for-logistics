// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult } from '../shared';
import { LOCK_MS } from './lockout';
import { makePins } from './pins';
import { freshDb } from './testing';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function setUp() {
  const c = clock();
  const pins = makePins(c.now);
  const db = freshDb();
  const made = pins.setup(db, 'seat-1', '1111', '2222');
  assert.ok(made.ok);
  return { c, pins, db, code: made.value.recoveryCode };
}

const code = (r: KeeperResult<unknown>) => (r.ok ? 'ok' : r.code);
const rows = (db: ReturnType<typeof freshDb>, sql: string) => db.prepare(sql).all() as Record<string, string>[];

test('setup stores both PINs once and hands back a 12-character recovery code', () => {
  const c = clock();
  const pins = makePins(c.now);
  const db = freshDb();
  assert.equal(pins.isSet(db), false);
  const made = pins.setup(db, 'seat-1', '1111', '2222');
  assert.ok(made.ok);
  assert.match(made.value.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(pins.isSet(db), true);
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'ok');
  assert.equal(code(pins.verify(db, 'system', '2222')), 'ok');
});

test('set-once: a second setup (another seat finishing later) is refused and changes nothing', () => {
  const { pins, db } = setUp();
  assert.equal(code(pins.setup(db, 'seat-2', '3333', '4444')), 'pins-already-set');
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'ok');
  assert.equal(code(pins.verify(db, 'admin', '3333')), 'wrong-pin');
});

test('PINs must be exactly four digits and the two must differ', () => {
  const pins = makePins(clock().now);
  const db = freshDb();
  for (const bad of ['', '123', '12345', 'abcd', '12 4']) assert.equal(code(pins.setup(db, 's', bad, '2222')), 'bad-pin');
  assert.equal(code(pins.setup(db, 's', '1111', '12a4')), 'bad-pin');
  assert.equal(code(pins.setup(db, 's', '1111', '1111')), 'pins-same');
  assert.equal(pins.isSet(db), false);
});

test('before setup nothing verifies', () => {
  const pins = makePins(clock().now);
  assert.equal(code(pins.verify(freshDb(), 'admin', '1111')), 'pins-not-set');
});

test('a wrong PIN is refused; the right kind of PIN is needed', () => {
  const { pins, db } = setUp();
  assert.equal(code(pins.verify(db, 'admin', '2222')), 'wrong-pin');
  assert.equal(code(pins.verify(db, 'system', '1111')), 'wrong-pin');
});

test('five wrong tries lock that PIN for 60 s (even the right one), then it opens; the other kind is unaffected', () => {
  const { c, pins, db } = setUp();
  for (let i = 0; i < 4; i++) assert.equal(code(pins.verify(db, 'admin', '0000')), 'wrong-pin');
  const fifth = pins.verify(db, 'admin', '0000');
  assert.ok(!fifth.ok && fifth.code === 'pin-locked' && fifth.detail === '60');
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'pin-locked');
  assert.equal(code(pins.verify(db, 'system', '2222')), 'ok');
  c.advance(LOCK_MS);
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'ok');
});

test('change System PIN needs the Admin PIN; the old System PIN stops working', () => {
  const { pins, db } = setUp();
  assert.equal(code(pins.changeSystem(db, 'seat-1', '9999', '5555')), 'wrong-pin');
  assert.equal(code(pins.changeSystem(db, 'seat-1', '1111', '555')), 'bad-pin');
  assert.equal(code(pins.changeSystem(db, 'seat-1', '1111', '1111')), 'pins-same');
  assert.equal(code(pins.changeSystem(db, 'seat-1', '1111', '5555')), 'ok');
  assert.equal(code(pins.verify(db, 'system', '2222')), 'wrong-pin');
  assert.equal(code(pins.verify(db, 'system', '5555')), 'ok');
});

test('change Admin PIN needs the current Admin PIN and may not equal the System PIN', () => {
  const { pins, db } = setUp();
  assert.equal(code(pins.changeAdmin(db, 'seat-1', '0000', '5555')), 'wrong-pin');
  assert.equal(code(pins.changeAdmin(db, 'seat-1', '1111', '2222')), 'pins-same');
  assert.equal(code(pins.changeAdmin(db, 'seat-1', '1111', '5555')), 'ok');
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'wrong-pin');
  assert.equal(code(pins.verify(db, 'admin', '5555')), 'ok');
});

test('recovery code resets both PINs and issues a new code; the old code is dead', () => {
  const { pins, db, code: old } = setUp();
  const r = pins.recover(db, 'seat-1', old.toLowerCase().replace(/-/g, ' '), '3333', '4444'); // forgiving about case and spacing
  assert.ok(r.ok);
  assert.notEqual(r.value.recoveryCode, old);
  assert.equal(code(pins.verify(db, 'admin', '3333')), 'ok');
  assert.equal(code(pins.verify(db, 'system', '4444')), 'ok');
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'wrong-pin');
  assert.equal(code(pins.recover(db, 'seat-1', old, '5555', '6666')), 'wrong-recovery-code');
  assert.ok(pins.recover(db, 'seat-1', r.value.recoveryCode, '5555', '6666').ok);
});

test('wrong recovery codes are counted and locked like PINs; recovery also clears a PIN lock', () => {
  const { c, pins, db, code: real } = setUp();
  for (let i = 0; i < 4; i++) assert.equal(code(pins.recover(db, 's', 'AAAA-AAAA-AAAA', '3333', '4444')), 'wrong-recovery-code');
  assert.equal(code(pins.recover(db, 's', 'AAAA-AAAA-AAAA', '3333', '4444')), 'pin-locked');
  assert.equal(code(pins.recover(db, 's', real, '3333', '4444')), 'pin-locked');
  c.advance(30_000);
  for (let i = 0; i < 5; i++) pins.verify(db, 'admin', '0000');
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'pin-locked');
  c.advance(30_000); // the recovery lock has run out, the Admin lock has 30 s left
  assert.ok(pins.recover(db, 's', real, '3333', '4444').ok);
  assert.equal(code(pins.verify(db, 'admin', '3333')), 'ok');
});

test('what is stored is a salted hash: the PIN and the code are not the stored value, nor does it read as them', () => {
  const { pins, db, code: recovery } = setUp();
  const stored = rows(db, "SELECT key, value FROM settings WHERE key IN ('pin_admin', 'pin_system', 'pin_recovery')");
  assert.deepEqual(stored.map((r) => r.key).sort(), ['pin_admin', 'pin_recovery', 'pin_system']);
  for (const r of stored) assert.match(r.value, /^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  // Not "the random hash holds no 1111": a hex string may hold those digits by chance. The value must not be the PIN
  // or the code, and must not parse as a number (a PIN) either.
  for (const secret of ['1111', '2222', recovery, recovery.replace(/-/g, '')]) assert.ok(!stored.some((r) => r.value === secret), `stored as ${secret}`);
  assert.ok(stored.every((r) => Number.isNaN(Number(r.value))));
  // the same PIN set again gets another salt, so equal PINs do not look equal
  const other = freshDb();
  makePins(clock().now).setup(other, 's', '1111', '2222');
  assert.notEqual(stored.find((r) => r.key === 'pin_admin')?.value, rows(other, "SELECT value FROM settings WHERE key = 'pin_admin'")[0].value);
  assert.equal(code(pins.verify(db, 'admin', '1111')), 'ok');
});

test('every set, change and reset leaves an audit row, never a PIN', () => {
  const { pins, db, code: recovery } = setUp();
  pins.changeSystem(db, 'seat-2', '1111', '5555');
  pins.changeAdmin(db, 'seat-3', '1111', '6666');
  pins.recover(db, 'seat-4', recovery, '7777', '8888');
  pins.verify(db, 'admin', '0000'); // a wrong try writes nothing
  const audit = rows(db, 'SELECT seat, action, entity, entity_id, before_json, after_json FROM audit_log ORDER BY id');
  assert.deepEqual(
    audit.map((a) => [a.seat, a.action, a.entity, a.entity_id]),
    [
      ['seat-1', 'pins.setup', 'settings', 'pins'],
      ['seat-2', 'pins.change-system', 'settings', 'pins'],
      ['seat-3', 'pins.change-admin', 'settings', 'pins'],
      ['seat-4', 'pins.recover', 'settings', 'pins'],
    ],
  );
  const text = JSON.stringify(audit);
  for (const secret of ['1111', '2222', '5555', '6666', '7777', '8888', recovery, recovery.replace(/-/g, '')]) assert.ok(!text.includes(secret), `audit holds ${secret}`);
});

test('a failed change changes nothing and writes no audit row', () => {
  const { pins, db } = setUp();
  const before = rows(db, 'SELECT * FROM audit_log').length;
  pins.changeSystem(db, 's', '9999', '5555');
  assert.equal(rows(db, 'SELECT * FROM audit_log').length, before);
});

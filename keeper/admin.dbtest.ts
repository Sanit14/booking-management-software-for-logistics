// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// The Admin-PIN changes of 4.2 that touch no business table: an update started, a seat renamed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult } from '../shared';
import { makeAdmin } from './admin';
import { ADMIN, SYSTEM, setUp } from './memoTesting';

const NOW = new Date(2026, 10, 6, 10, 0);
const setup = () => {
  const s = setUp();
  return { ...s, admin: makeAdmin(s.pins, () => NOW) };
};
const audits = (s: ReturnType<typeof setup>, action: string) =>
  s.db.prepare('SELECT seat, entity, entity_id AS entityId, before_json AS before, after_json AS after FROM audit_log WHERE action = ?').all(action) as {
    seat: string; entity: string; entityId: string; before: string | null; after: string | null;
  }[];
const wrote = (s: ReturnType<typeof setup>, seat: string, daysAgo: number) =>
  s.db
    .prepare('INSERT INTO audit_log (at, seat, action, entity, entity_id) VALUES (?, ?, ?, ?, ?)')
    .run(new Date(NOW.getTime() - daysAgo * 86400000).toISOString(), seat, 'settings.company', 'settings', 'company');
const code = (r: KeeperResult<unknown>) => (r.ok ? 'ok' : r.code);

test('update start: the Admin PIN, then one audit row with the two versions; a wrong PIN or the System PIN writes nothing', () => {
  const s = setup();
  assert.equal(code(s.admin.updateStart(s.db, 'PC02', '0.2.1', '0.3.0', '0000')), 'wrong-pin');
  assert.equal(code(s.admin.updateStart(s.db, 'PC02', '0.2.1', '0.3.0', SYSTEM)), 'wrong-pin');
  assert.equal(audits(s, 'app.update').length, 0);
  assert.equal(code(s.admin.updateStart(s.db, 'PC02', '0.2.1', '0.3.0', ADMIN)), 'ok');
  const [row] = audits(s, 'app.update');
  assert.deepEqual([row.seat, row.entity, JSON.parse(row.before ?? '{}'), JSON.parse(row.after ?? '{}')], ['PC02', 'settings', { version: '0.2.1' }, { version: '0.3.0' }]);
});

test('rename: the Admin PIN first, then the name\'s rules; every refusal writes nothing', () => {
  const s = setup();
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', '0000', [])), 'wrong-pin');
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', SYSTEM, [])), 'wrong-pin', 'the System PIN is not enough');
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'x', '0000', [])), 'wrong-pin', 'the PIN is looked at before the name');
  for (const bad of ['', 'x', 'A'.repeat(21), 'PC_02', '--']) assert.equal(code(s.admin.renameSeat(s.db, 'PC02', bad, ADMIN, [])), 'seat-name-invalid', JSON.stringify(bad));
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'PC02', ADMIN, [])), 'seat-name-same');
  assert.equal(audits(s, 'seat.rename').length, 0);
});

test('rename: not the name of a seat that wrote to the book in the last 30 days or is online now; older than that is free', () => {
  const s = setup();
  wrote(s, 'Counter 2', 10);
  wrote(s, 'Old Counter', 40);
  const taken = s.admin.renameSeat(s.db, 'PC02', 'counter 2', ADMIN, []);
  assert.ok(!taken.ok && taken.code === 'seat-name-taken' && taken.detail === 'Counter 2', 'ASCII case ignored, the other seat\'s spelling comes back');
  const online = s.admin.renameSeat(s.db, 'PC02', 'Front Desk', ADMIN, ['front desk']);
  assert.ok(!online.ok && online.code === 'seat-name-taken');
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'old counter', ADMIN, [])), 'ok', 'a name nobody used for 30 days is free');
  assert.equal(audits(s, 'seat.rename').length, 1);
});

test('rename: the audit row names the old seat; a seat may change the case of its own name, and its old rows keep the old name', () => {
  const s = setup();
  wrote(s, 'PC02', 1);
  const r = s.admin.renameSeat(s.db, 'PC02', '  pc02  ', ADMIN, ['PC02']);
  assert.deepEqual(r.ok && r.value, { name: 'pc02' }, 'its own old name is not "another seat"');
  const [row] = audits(s, 'seat.rename');
  assert.deepEqual([row.seat, row.entity, row.entityId, JSON.parse(row.before ?? '{}'), JSON.parse(row.after ?? '{}')], ['PC02', 'seats', 'PC02', { name: 'PC02' }, { name: 'pc02' }]);
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE seat = 'PC02' AND action = 'settings.company'").get() as { n: number }).n, 1, 'old rows keep the old name');
  assert.ok(s.admin.renameSeat(s.db, 'pc02', 'Counter 9', ADMIN, []).ok);
});

test('five wrong Admin PINs through a rename lock the Admin PIN for every route (the lock is per kind of PIN, not per route)', () => {
  const s = setup();
  for (let i = 0; i < 4; i++) assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', '0000', [])), 'wrong-pin');
  assert.equal(code(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', '0000', [])), 'pin-locked');
  assert.equal(code(s.admin.updateStart(s.db, 'PC02', '0.2.1', '0.3.0', ADMIN)), 'pin-locked');
});

test('rename: a name another seat was just given is taken even before that seat has written anything under it', () => {
  const s = setup();
  assert.ok(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', ADMIN, []).ok);
  const again = s.admin.renameSeat(s.db, 'PC03', 'counter 2', ADMIN, []);
  assert.ok(!again.ok && again.code === 'seat-name-taken' && again.detail === 'Counter 2');
  assert.ok(s.admin.renameSeat(s.db, 'PC02', 'Counter 2', ADMIN, []).ok, 'the same seat may ask again: its own pending name is not another seat\'s');
});

// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAudit } from './audit';
import { freshDb, insertStation } from './testing';

const count = (db: ReturnType<typeof freshDb>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('an audit row is written in the same transaction as the change', () => {
  const db = freshDb();
  db.transaction(() => {
    const id = insertStation(db, 'Pune');
    writeAudit(db, { seat: 'seat-1', action: 'station.create', entity: 'stations', entityId: id, after: { name: 'Pune' } });
  })();
  const row = db.prepare('SELECT * FROM audit_log').get() as Record<string, unknown>;
  assert.equal(row.seat, 'seat-1');
  assert.equal(row.action, 'station.create');
  assert.equal(row.entity, 'stations');
  assert.equal(row.entity_id, '1');
  assert.equal(row.before_json, null);
  assert.deepEqual(JSON.parse(String(row.after_json)), { name: 'Pune' });
  assert.match(String(row.at), /^\d{4}-\d{2}-\d{2}T/);
});

test('the audit row and the change roll back together', () => {
  const db = freshDb();
  assert.throws(() =>
    db.transaction(() => {
      const id = insertStation(db, 'Nagpur');
      writeAudit(db, { seat: 's', action: 'station.create', entity: 'stations', entityId: id });
      throw new Error('save failed');
    })(), /save failed/);
  assert.equal(count(db, 'stations'), 0);
  assert.equal(count(db, 'audit_log'), 0);
});

test('before and after are stored as JSON, text ids work, and the row is found by entity', () => {
  const db = freshDb();
  db.transaction(() => {
    writeAudit(db, { seat: 's', action: 'setting.update', entity: 'settings', entityId: 'chargeRule_option1', before: { a: 1 }, after: { a: 2 } });
    writeAudit(db, { seat: 's', action: 'lr.cancel', entity: 'lrs', entityId: 7 });
  })();
  const rows = db.prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ?').all('settings', 'chargeRule_option1') as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(String(rows[0].before_json)), { a: 1 });
  assert.equal((db.prepare('SELECT entity_id FROM audit_log WHERE entity = ?').get('lrs') as { entity_id: string }).entity_id, '7');
});

test('writing an audit row outside a transaction is refused', () => {
  const db = freshDb();
  assert.throws(() => writeAudit(db, { seat: 's', action: 'x', entity: 'lrs', entityId: 1 }), /inside the transaction/);
  assert.equal(count(db, 'audit_log'), 0);
});

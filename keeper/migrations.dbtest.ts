// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeAudit } from './audit';
import { migrateSafely, readSummary } from './backup';
import { openDatabase, type Db } from './db';
import { currentVersion, migrate, MIGRATIONS } from './migrations';
import { insertLr, insertMemo, insertStation, tempDir } from './testing';

const LATEST = MIGRATIONS.length;

const names = (db: Db, type: 'table' | 'index'): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name').all(type, 'sqlite_%') as { name: string }[]).map((r) => r.name);

test('migrations are numbered 1, 2, 3... with no gap', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 1));
});

test('an empty file reaches the latest version with every table and index', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  assert.equal(migrate(db), LATEST);
  assert.equal(currentVersion(db), LATEST);
  assert.deepEqual(names(db, 'table'), ['agents', 'audit_log', 'counters', 'drivers', 'firms', 'lrs', 'memos', 'schema_version', 'settings', 'stations', 'trucks', 'wasuli']);
  assert.deepEqual(names(db, 'index').filter((n) => !n.startsWith('sqlite_')).filter((n) => /^(lrs|memos|audit|wasuli)_/.test(n)), [
    'audit_by_at',
    'audit_by_entity',
    'lrs_by_consignee',
    'lrs_by_consignor',
    'lrs_by_date',
    'lrs_by_memo',
    'lrs_pending',
    'memos_by_date',
    'memos_by_truck',
    'wasuli_by_collected',
    'wasuli_by_status',
  ]);
  const cols = (index: string) => (db.pragma(`index_info(${index})`) as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols('lrs_pending'), ['status', 'to_station_id', 'lr_date']);
  assert.deepEqual(cols('lrs_by_consignor'), ['consignor_id', 'lr_date']);
  assert.deepEqual(cols('memos_by_truck'), ['truck_id', 'memo_date']);
  assert.deepEqual(cols('wasuli_by_status'), ['status', 'agent_id', 'collected_date']);
  assert.deepEqual(cols('audit_by_at'), ['at']);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('the three charge options are seeded in paise', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  migrate(db);
  const rule = (option: string) => JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(`chargeRule_${option}`) as { value: string }).value);
  assert.deepEqual(rule('option1'), { godownBhadaPaise: 500, godownInsurancePaise: 500, deliveryChargesPaise: 200, hamaliPerDagPaise: 1000, hamaliFlatPaise: 0, hamaliMode: 'perDag' });
  assert.deepEqual(rule('option2'), { godownBhadaPaise: 200, godownInsurancePaise: 300, deliveryChargesPaise: 300, hamaliPerDagPaise: 0, hamaliFlatPaise: 0, hamaliMode: 'none' });
  assert.deepEqual(rule('blank'), { godownBhadaPaise: 0, godownInsurancePaise: 0, deliveryChargesPaise: 0, hamaliPerDagPaise: 0, hamaliFlatPaise: 0, hamaliMode: 'none' });
});

test('running migrate again changes nothing', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  migrate(db);
  insertStation(db, 'Yavatmal');
  const before = JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY key').all());
  assert.equal(migrate(db), LATEST);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }).n, LATEST);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM stations').get() as { n: number }).n, 1);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY key').all()), before);
});

test('a 1.2 database (only an empty schema_version) upgrades in place and keeps its file', () => {
  const file = path.join(tempDir(), 'booking.db');
  const old = openDatabase(file);
  old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)'); // exactly what the 1.2 keeper created
  old.close();
  const sizeBefore = fs.statSync(file).size;
  assert.ok(sizeBefore > 0);

  const db = openDatabase(file);
  assert.equal(currentVersion(db), 0);
  assert.equal(migrate(db), LATEST);
  assert.ok(names(db, 'table').includes('lrs'));
  assert.equal(fs.statSync(file).size >= sizeBefore, true);
  db.close();
  assert.equal(currentVersion(openDatabase(file)), LATEST);
});

test('a database from a newer keeper is refused, not touched', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (99)');
  assert.throws(() => migrate(db), /newer than this keeper/);
  assert.deepEqual(names(db, 'table'), ['schema_version']);
});

test('a failing migration rolls back completely and is not recorded', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  const broken = [
    {
      version: 1,
      up: (d: Db) => {
        d.exec('CREATE TABLE half_done (x INTEGER)');
        throw new Error('boom');
      },
    },
  ];
  assert.throws(() => migrate(db, broken), /boom/);
  assert.equal(currentVersion(db), 0);
  assert.deepEqual(names(db, 'table'), ['schema_version']);
});

test('only migrations above the current version run', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  const ran: number[] = [];
  const list = [1, 2, 3].map((version) => ({ version, up: () => void ran.push(version) }));
  migrate(db, list.slice(0, 2));
  assert.deepEqual(ran, [1, 2]);
  assert.equal(migrate(db, list), 3);
  assert.deepEqual(ran, [1, 2, 3]);
});

// A database as 3.3 left it (schema v1) with one LR of every kind that matters to wasuli.
function v1WithLrs(): { db: Db; ids: Record<string, number> } {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  assert.equal(migrate(db, MIGRATIONS.slice(0, 1)), 1);
  const memo = insertMemo(db);
  const ids = {
    booked: insertLr(db, { wasuli_paise: 5000, seat: 'PC01' }),
    loaded: insertLr(db, { wasuli_paise: 1200, status: 'loaded', memo_id: memo, seat: 'PC02' }),
    cancelled: insertLr(db, { wasuli_paise: 700, status: 'cancelled' }),
    none: insertLr(db, { wasuli_paise: 0 }),
  };
  return { db, ids };
}
const wasuliRows = (db: Db) => db.prepare('SELECT lr_id AS lrId, amount_paise AS amount, status, agent_id AS agent, assigned_date AS assigned, collected_date AS collected, seat FROM wasuli ORDER BY lr_id').all();

test('v2 makes an unassigned wasuli row for every LR that is not cancelled and has an amount, and loses nothing', () => {
  const { db, ids } = v1WithLrs();
  const before = JSON.stringify([db.prepare('SELECT * FROM lrs ORDER BY id').all(), db.prepare('SELECT * FROM memos ORDER BY id').all(), db.prepare('SELECT * FROM stations ORDER BY id').all()]);
  assert.equal(migrate(db), LATEST);
  assert.deepEqual(wasuliRows(db), [
    { lrId: ids.booked, amount: 5000, status: 'unassigned', agent: null, assigned: null, collected: null, seat: 'PC01' },
    { lrId: ids.loaded, amount: 1200, status: 'unassigned', agent: null, assigned: null, collected: null, seat: 'PC02' },
  ]);
  const after = JSON.stringify([db.prepare('SELECT * FROM lrs ORDER BY id').all(), db.prepare('SELECT * FROM memos ORDER BY id').all(), db.prepare('SELECT * FROM stations ORDER BY id').all()]);
  assert.equal(after, before, 'LRs, memos and masters are exactly as they were');
  assert.equal(migrate(db), LATEST);
  assert.equal(wasuliRows(db).length, 2, 'running it again makes no second row');
});

test('v3 adds only an index: the audit log of a v2 file is exactly as it was, a backup of the v2 file comes first, and a second run changes nothing', async () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  assert.equal(migrate(db, MIGRATIONS.slice(0, 2)), 2);
  assert.ok(!names(db, 'index').includes('audit_by_at'));
  db.transaction(() => {
    for (let i = 0; i < 5; i++) writeAudit(db, { seat: `PC0${i}`, action: 'settings.company', entity: 'settings', entityId: 'company', before: { i }, after: { i: i + 1 } });
  })();
  const before = JSON.stringify(db.prepare('SELECT * FROM audit_log ORDER BY id').all());
  const dir = path.join(tempDir(), 'backups');
  const r = await migrateSafely(db, dir, new Date(2026, 10, 6, 9, 0));
  assert.equal(r.version, LATEST);
  assert.equal(r.backupError, undefined);
  assert.equal(readSummary(path.join(dir, 'booking-20261106-0900.db'))?.schemaVersion, 2, 'the backup is the v2 file');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_log ORDER BY id').all()), before, 'not a row of the log changed');
  assert.ok(names(db, 'index').includes('audit_by_at'));
  assert.equal(migrate(db), LATEST);
  assert.equal(names(db, 'index').filter((n) => n === 'audit_by_at').length, 1);
  assert.throws(() => db.prepare("UPDATE audit_log SET seat = 'x'").run(), /append-only/, 'the log is still append-only');
});

test('v2 from an empty v1 database makes empty tables', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  migrate(db, MIGRATIONS.slice(0, 1));
  assert.equal(migrate(db), LATEST);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM wasuli').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n, 0);
});

test('the keeper backs up a v1 database before v2 runs, and the backup is the v1 file', async () => {
  const { db } = v1WithLrs();
  const dir = path.join(tempDir(), 'backups');
  const r = await migrateSafely(db, dir, new Date(2026, 9, 24, 9, 30));
  assert.equal(r.version, LATEST);
  assert.equal(r.backupError, undefined);
  const backup = readSummary(path.join(dir, 'booking-20261024-0930.db'));
  assert.equal(backup?.schemaVersion, 1);
  assert.equal(backup?.lrs, 4);
  assert.equal(wasuliRows(db).length, 2);
});

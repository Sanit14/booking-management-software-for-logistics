// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type Db } from './db';
import { currentVersion, migrate, MIGRATIONS } from './migrations';
import { insertStation, tempDir } from './testing';

const names = (db: Db, type: 'table' | 'index'): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name').all(type, 'sqlite_%') as { name: string }[]).map((r) => r.name);

test('migrations are numbered 1, 2, 3... with no gap', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 1));
});

test('an empty file reaches v1 with every table and index', () => {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  assert.equal(migrate(db), 1);
  assert.equal(currentVersion(db), 1);
  assert.deepEqual(names(db, 'table'), ['audit_log', 'counters', 'drivers', 'firms', 'lrs', 'memos', 'schema_version', 'settings', 'stations', 'trucks']);
  assert.deepEqual(names(db, 'index').filter((n) => !n.startsWith('sqlite_')).filter((n) => /^(lrs|memos|audit)_/.test(n)), [
    'audit_by_entity',
    'lrs_by_consignee',
    'lrs_by_consignor',
    'lrs_by_date',
    'lrs_by_memo',
    'lrs_pending',
    'memos_by_date',
    'memos_by_truck',
  ]);
  const cols = (index: string) => (db.pragma(`index_info(${index})`) as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols('lrs_pending'), ['status', 'to_station_id', 'lr_date']);
  assert.deepEqual(cols('lrs_by_consignor'), ['consignor_id', 'lr_date']);
  assert.deepEqual(cols('memos_by_truck'), ['truck_id', 'memo_date']);
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
  assert.equal(migrate(db), 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }).n, 1);
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
  assert.equal(migrate(db), 1);
  assert.ok(names(db, 'table').includes('lrs'));
  assert.equal(fs.statSync(file).size >= sizeBefore, true);
  db.close();
  assert.equal(currentVersion(openDatabase(file)), 1);
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

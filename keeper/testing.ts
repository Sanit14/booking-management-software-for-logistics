// Helpers for *.dbtest.ts only (they run under Electron's Node, see scripts/test-db.cjs).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from './db';
import { migrate } from './migrations';
import { nameKey } from './names';

const dirs: string[] = [];
process.on('exit', () => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A fresh, empty folder removed when the test process exits. */
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dbtest-'));
  dirs.push(dir);
  return dir;
}

/** A new database file opened the way the keeper opens it, migrated to the latest schema. */
export function freshDb(): Db {
  const db = openDatabase(path.join(tempDir(), 'booking.db'));
  migrate(db);
  return db;
}

type Row = Record<string, unknown>;

export function insert(db: Db, table: string, row: Row): number {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`;
  return Number(db.prepare(sql).run(row).lastInsertRowid);
}

export const insertStation = (db: Db, name: string): number =>
  insert(db, 'stations', { name, name_key: nameKey(name), seat: 'test' });

export const insertTruck = (db: Db, number: string): number =>
  insert(db, 'trucks', { number, number_key: nameKey(number), seat: 'test' });

export const insertDriver = (db: Db, name: string): number => insert(db, 'drivers', { name, seat: 'test' });

let serial = 0;

/** The smallest valid memo; `over` replaces or adds columns. */
export function insertMemo(db: Db, over: Row = {}): number {
  const from = insertStation(db, `From ${++serial}`);
  const to = insertStation(db, `To ${serial}`);
  return insert(db, 'memos', {
    uid: randomUUID(),
    challan_year: 2026,
    challan_no: serial,
    memo_date: '2026-10-24',
    truck_id: insertTruck(db, `MH 29 AB ${serial}`),
    driver_id: insertDriver(db, `Driver ${serial}`),
    from_station_id: from,
    to_station_id: to,
    seat: 'test',
    ...over,
  });
}

/** The smallest valid LR (its own two stations); `over` replaces or adds columns. */
export function insertLr(db: Db, over: Row = {}): number {
  const from = insertStation(db, `From ${++serial}`);
  const to = insertStation(db, `To ${serial}`);
  return insert(db, 'lrs', {
    uid: randomUUID(),
    lr_year: 2026,
    lr_no: serial,
    lr_date: '2026-10-24',
    consignor_name: 'Consignor',
    consignee_name: 'Consignee',
    from_station_id: from,
    to_station_id: to,
    particular: 'Cloth',
    qty: 1,
    seat: 'test',
    ...over,
  });
}

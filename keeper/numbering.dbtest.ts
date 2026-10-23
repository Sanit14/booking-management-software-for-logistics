// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from './db';
import { nextNumber } from './numbering';
import { freshDb, insertLr } from './testing';

// Every call must be inside the caller's transaction, as in a real save.
const issue = (db: Db, name: 'lr' | 'challan', date: string) => db.transaction(() => nextNumber(db, name, date))();

test('the first number of a year is 1, then 2, 3', () => {
  const db = freshDb();
  assert.deepEqual(issue(db, 'lr', '2026-10-24'), { year: 2026, no: 1 });
  assert.deepEqual(issue(db, 'lr', '2026-10-24'), { year: 2026, no: 2 });
  assert.deepEqual(issue(db, 'lr', '2026-10-25'), { year: 2026, no: 3 });
});

test('31 December and 1 January are separate series, and the year comes from the record date', () => {
  const db = freshDb();
  assert.deepEqual(issue(db, 'lr', '2026-12-31'), { year: 2026, no: 1 });
  assert.deepEqual(issue(db, 'lr', '2027-01-01'), { year: 2027, no: 1 });
  // A late entry dated in the old year carries on the old series, whatever today is.
  assert.deepEqual(issue(db, 'lr', '2026-12-31'), { year: 2026, no: 2 });
  assert.deepEqual(issue(db, 'lr', '2027-01-02'), { year: 2027, no: 2 });
});

test('LR and challan series are independent', () => {
  const db = freshDb();
  assert.equal(issue(db, 'lr', '2026-10-24').no, 1);
  assert.equal(issue(db, 'lr', '2026-10-24').no, 2);
  assert.equal(issue(db, 'challan', '2026-10-24').no, 1);
  assert.equal(issue(db, 'lr', '2026-10-24').no, 3);
  assert.equal(issue(db, 'challan', '2026-10-24').no, 2);
});

test('calling outside a transaction throws and issues nothing', () => {
  const db = freshDb();
  assert.throws(() => nextNumber(db, 'lr', '2026-10-24'), /inside the saving transaction/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM counters').get() as { n: number }).n, 0);
  assert.equal(issue(db, 'lr', '2026-10-24').no, 1);
});

test('a rolled-back transaction does not burn a number', () => {
  const db = freshDb();
  assert.equal(issue(db, 'lr', '2026-10-24').no, 1);
  assert.throws(() =>
    db.transaction(() => {
      assert.equal(nextNumber(db, 'lr', '2026-10-24').no, 2);
      throw new Error('save failed');
    })(), /save failed/);
  assert.equal(issue(db, 'lr', '2026-10-24').no, 2); // the same number is issued again
});

test('a bad date is refused before anything is written', () => {
  const db = freshDb();
  for (const bad of ['', '24-10-2026', '2026-13-01', '2026-02-30', 'today']) {
    assert.throws(() => issue(db, 'lr', bad), /invalid date/, bad);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM counters').get() as { n: number }).n, 0);
});

test('200 saves in a row give 1..200 with no gap and no duplicate', () => {
  const db = freshDb();
  for (let i = 0; i < 200; i++) {
    db.transaction(() => {
      const { year, no } = nextNumber(db, 'lr', '2026-10-24');
      insertLr(db, { lr_year: year, lr_no: no });
    })();
  }
  const numbers = (db.prepare('SELECT lr_no FROM lrs WHERE lr_year = 2026 ORDER BY lr_no').all() as { lr_no: number }[]).map((r) => r.lr_no);
  assert.deepEqual(numbers, Array.from({ length: 200 }, (_, i) => i + 1));
  assert.equal((db.prepare("SELECT last FROM counters WHERE name = 'lr' AND year = 2026").get() as { last: number }).last, 200);
});

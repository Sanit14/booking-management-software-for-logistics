// The load-test seeder (scripts/seed-load.cjs, session 4.3) on a tiny book: it must build a database the keeper would accept,
// with the audit trail on the simulated days, and the same seed must give the same book.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from './db';
import { tempDir } from './testing';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seed } = require('../../scripts/seed-load.cjs') as { seed: (o: Record<string, unknown>) => { summary: Record<string, unknown> } };

const small = (root: string) => seed({ root, end: '2026-10-31', days: 10, perDay: 15, vacuum: false });

test('a small seed: a sound database, numbers without gaps, audit rows on the simulated days, triggers back', () => {
  const root = tempDir();
  const { summary } = small(root);
  assert.equal(summary.integrity, 'ok');
  assert.equal(summary.auditTriggers, 2);
  assert.equal((summary.made as { refused: number }).refused, 0);
  const db = openDatabase(path.join(root, 'booking.db'));
  try {
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    assert.equal(n('SELECT COUNT(*) AS n FROM lrs'), summary.lrs && Object.values(summary.lrs as Record<string, number>).reduce((a, b) => a + b, 0));
    assert.ok(n('SELECT COUNT(*) AS n FROM lrs') > 50, 'about 15 a day');
    assert.ok(n('SELECT COUNT(*) AS n FROM memos') > 0, 'some trucks left');
    assert.ok(n("SELECT COUNT(*) AS n FROM lrs WHERE status = 'loaded'") > 0);
    assert.equal(n('SELECT MAX(lr_no) - COUNT(*) AS n FROM lrs'), 0, 'no gap in the LR series');
    assert.equal(n('SELECT MAX(challan_no) - COUNT(*) AS n FROM memos'), 0, 'no gap in the challan series');
    assert.equal(n("SELECT COUNT(*) AS n FROM lrs WHERE lr_date < '2026-10-22' OR lr_date > '2026-10-31'"), 0, '10 days ending 31 October');
    // History reads by `at`: the rows sit on their days, in the order they were written
    assert.equal(n("SELECT COUNT(*) AS n FROM audit_log WHERE at < '2026-10-21' OR at >= '2026-11-01'"), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM audit_log a JOIN audit_log b ON b.id = a.id + 1 WHERE b.at < a.at'), 0, 'audit time never goes backwards');
    assert.ok(n("SELECT COUNT(DISTINCT substr(at, 1, 10)) AS n FROM audit_log") >= 10);
    // the book is still append-only
    assert.throws(() => db.prepare("UPDATE audit_log SET at = 'x' WHERE id = 1").run(), /append-only/);
    // a loaded LR is on a memo, a booked one is not (the table's own CHECK), and the wasuli rows follow their LRs
    assert.equal(n("SELECT COUNT(*) AS n FROM wasuli w JOIN lrs l ON l.id = w.lr_id WHERE l.status = 'cancelled'"), 0);
  } finally {
    db.close();
  }
});

test('the same seed gives the same book, and a folder that holds a database is refused', () => {
  const sig = (root: string) => {
    const db = openDatabase(path.join(root, 'booking.db'));
    try {
      return JSON.stringify([
        db.prepare('SELECT uid, lr_date, lr_no, consignor_name, consignee_name, qty, topay_paise, paid_paise, wasuli_paise, status, memo_id, version FROM lrs ORDER BY id').all(),
        db.prepare('SELECT challan_no, memo_date, truck_id, frozen_lr_count, frozen_topay_paise, status FROM memos ORDER BY id').all(),
        db.prepare('SELECT status, agent_id, collected_date, collected_paise FROM wasuli ORDER BY id').all(),
      ]);
    } finally {
      db.close();
    }
  };
  const a = tempDir();
  const b = tempDir();
  small(a);
  small(b);
  assert.equal(sig(a), sig(b));
  assert.throws(() => small(a), /already holds a booking\.db/);
  assert.throws(() => seed({ root: 'C:\\BookingManagerData', days: 1 }), /real data root/);
});

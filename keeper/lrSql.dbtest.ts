// Runs under Electron's Node via scripts/test-db.cjs. The SQL twin of `lrAmounts`: Memos (frozen totals), Firm Accounts and Reports all
// build their sums from lrSql.ts, so it must agree with the one money function over odd amounts, old rows included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lrMoneySql, lrSumsSql } from './lrSql';
import { lrAmounts, type LrMoney } from './money';
import { freshDb, insertLr } from './testing';

// Odd paise on purpose (1 paisa, 99.99, 1,23,456.79 ...), to pay and paid, hamali 0 and not.
const CASES: { topay_paise: number; paid_paise: number; hamali_paise: number }[] = [
  { topay_paise: 1, paid_paise: 0, hamali_paise: 0 },
  { topay_paise: 0, paid_paise: 9999, hamali_paise: 1 },
  { topay_paise: 12345679, paid_paise: 0, hamali_paise: 1050 },
  { topay_paise: 0, paid_paise: 0, hamali_paise: 7777 },
  { topay_paise: 250000, paid_paise: 0, hamali_paise: 12010 },
  { topay_paise: 0, paid_paise: 3333333, hamali_paise: 33 },
  { topay_paise: 0, paid_paise: 0, hamali_paise: 0 },
];

// What an LR saved before 4.5 carries in the columns nothing reads any more.
const OLD = { godown_bhada_paise: 500, godown_insurance_paise: 500, delivery_charges_paise: 200, pf_paise: 100, stax_bp: 500, charge_option: 'option1' };

test('lrMoneySql = lrAmounts for every case, a new row and an old one with charges and tax set', () => {
  const db = freshDb();
  const m = lrMoneySql();
  CASES.forEach((c, i) => insertLr(db, { ...c, ...(i % 2 === 0 ? OLD : {}) }));
  const rows = db.prepare(`SELECT *, ${m.freight} AS sFreight, ${m.hamali} AS sHamali, ${m.total} AS sTotal FROM lrs ORDER BY id`).all() as (LrMoney & { sFreight: number; sHamali: number; sTotal: number })[];
  assert.equal(rows.length, CASES.length);
  for (const r of rows) {
    const a = lrAmounts(r);
    assert.deepEqual({ freight: r.sFreight, hamali: r.sHamali, total: r.sTotal }, a);
    assert.equal(a.total, a.freight + a.hamali);
  }
});

test('lrMoneySql with the table alias reads the same columns', () => {
  const db = freshDb();
  insertLr(db, { topay_paise: 100000, hamali_paise: 3000, ...OLD });
  const m = lrMoneySql('l.');
  assert.deepEqual(db.prepare(`SELECT ${m.freight} AS freight, ${m.hamali} AS hamali, ${m.total} AS total FROM lrs l`).get(), { freight: 100000, hamali: 3000, total: 103000 });
});

test('lrSumsSql adds up count, quantity, to pay, paid and hamali; an old row adds only its hamali', () => {
  const db = freshDb();
  CASES.forEach((c, i) => insertLr(db, { ...c, qty: i + 1, ...(i % 2 === 0 ? OLD : {}) }));
  const sums = db.prepare(`SELECT ${lrSumsSql()} FROM lrs`).get() as Record<string, number>;
  assert.deepEqual(sums, {
    lrs: CASES.length,
    qty: CASES.length * (CASES.length + 1) / 2,
    toPayPaise: CASES.reduce((t, c) => t + c.topay_paise, 0),
    paidPaise: CASES.reduce((t, c) => t + c.paid_paise, 0),
    hamaliPaise: CASES.reduce((t, c) => t + c.hamali_paise, 0),
  });
});

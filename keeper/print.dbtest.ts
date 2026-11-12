// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Printing (3.3): what a memo and an LR print, the company lines, and the audit row of every print.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STATEMENT_PRINT_ROWS, type KeeperResult, type PrintCompany } from '../shared';
import { inr, lrAmounts, type LrMoney } from './money';
import { makeFirmAccounts } from './firmAccounts';
import { ADMIN, SYSTEM, book, create, now, refused, saved, setUp, type Set } from './memoTesting';
import { makePrint } from './print';
import { makeReports } from './reports';
import { fastest, insertLr } from './testing';

const got = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${r.detail ?? ''}`);
  return r.value;
};
const n = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const setup = () => {
  const s = setUp();
  return { s, print: makePrint(s.pins, s.memos, makeFirmAccounts(now), makeReports()) };
};
const audits = (s: Set, action: string) =>
  s.db.prepare('SELECT seat, entity, entity_id AS entityId, after_json AS after FROM audit_log WHERE action = ? ORDER BY id').all(action) as {
    seat: string; entity: string; entityId: string; after: string | null;
  }[];

// ---- the memo ----

test('print.memo: the header, the rows in LR-number order and the totals frozen at the save, all as formatted text', () => {
  const { s, print } = setup();
  const a = book(s, { qty: '4', toPay: '1,800', paid: '', particular: 'Cloth bales' });
  const b = book(s, { qty: '2', toPay: '', paid: '2,500.50', particular: 'Steel pipes', consignor: { firmId: s.patil, name: '', addToFirms: false } });
  const m = saved(create(s, [b.id, a.id], { truckHire: '4,500', loadingHamali: '250.75' }));
  const p = got(print.memo(s.db, m.id));

  assert.equal(p.challanNo, m.challanNo);
  assert.equal(p.challanYear, 2026);
  assert.equal(p.date, '31-10-2026');
  assert.deepEqual([p.truck, p.driver, p.from, p.to], ['MH 29 BE 1234', 'Ramesh Pawar', 'Yavatmal', 'Nagpur']);
  assert.deepEqual([p.truckHire, p.loadingHamali], ['4,500.00', '250.75']);
  assert.deepEqual([p.cancelled, p.differs], [false, false]);
  assert.deepEqual(p.rows.map((r) => [r.sr, r.lrNo]), [[1, a.no], [2, b.no]]);
  assert.deepEqual(p.rows[0], {
    sr: 1, lrNo: a.no, consignor: 'Shree Ganesh Traders', consignee: 'Patil Hardware', destination: 'Nagpur', particular: 'Cloth bales', qty: 4, toPay: '1,800.00', paid: '–',
  });
  assert.deepEqual([p.rows[1].toPay, p.rows[1].paid, p.rows[1].consignor], ['–', '2,500.50', 'Patil Hardware']);
  assert.deepEqual(p.totals, { lrs: 2, qty: 6, toPay: '1,800.00', paid: '2,500.50' });
});

test('print.memo: rows go by LR number (year, then number), not by date or by the order the memo was ticked', () => {
  const { s, print } = setup();
  const today = book(s); // 2026, number 1
  const backdated = book(s, { date: '2026-10-01' }); // 2026, number 2, but an earlier date
  const lastYear = book(s, { date: '2025-12-30', consignor: { firmId: s.patil, name: '', addToFirms: false } }); // 2025, number 1
  const m = saved(create(s, [backdated.id, today.id, lastYear.id]));
  const rows = got(print.memo(s.db, m.id)).rows;
  assert.deepEqual(rows.map((r) => r.lrNo), [1, 1, 2]);
  assert.equal(rows[0].consignor, 'Patil Hardware', 'the 2025 LR 1 comes before the 2026 LR 1');
  assert.equal(rows[2].lrNo, backdated.no);
});

test('print.memo: after an LR changes the rows show the LR now but the totals stay the frozen ones, and the memo says it differs', () => {
  const { s, print } = setup();
  const a = book(s, { toPay: '1,000' });
  const b = book(s, { toPay: '500' });
  const m = saved(create(s, [a.id, b.id]));
  s.db.prepare('UPDATE lrs SET topay_paise = 120000 WHERE id = ?').run(a.id); // 1,000 -> 1,200 after the memo was saved
  const p = got(print.memo(s.db, m.id));
  assert.equal(p.differs, true);
  assert.equal(p.rows[0].toPay, '1,200.00');
  assert.equal(p.totals.toPay, '1,500.00');
  assert.equal(p.totals.lrs, 2);
});

test('print.memo: a cancelled memo prints with its frozen totals, no rows (its LRs are pending again) and the cancelled flag', () => {
  const { s, print } = setup();
  const a = book(s, { toPay: '1,000' });
  const m = saved(create(s, [a.id]));
  got(s.memos.cancel(s.db, 'seat-1', m.id, 1, 'wrong truck', ADMIN));
  const p = got(print.memo(s.db, m.id));
  assert.equal(p.cancelled, true);
  assert.equal(p.differs, false);
  assert.deepEqual(p.rows, []);
  assert.deepEqual(p.totals, { lrs: 1, qty: 3, toPay: '1,000.00', paid: '0.00' });
});

test('print.memo: a memo that is not there is refused and writes nothing', () => {
  const { s, print } = setup();
  const before = n(s, 'audit_log');
  assert.equal(refused(print.memo(s.db, 999)).code, 'memo-missing');
  assert.equal(n(s, 'audit_log'), before);
});

test('print.memo: a 500-LR memo is read in well under 100 ms', () => {
  const { s, print } = setup();
  const ids = Array.from({ length: 500 }, () => book(s).id);
  const m = saved(create(s, ids));
  assert.equal(got(print.memo(s.db, m.id)).rows.length, 500);
  assert.ok(fastest(5, () => print.memo(s.db, m.id)) < 100);
});

// ---- the LR ----

test('print.lr: every amount is lrAmounts, formatted, for a to-pay LR with hamali; no charge or tax lines', () => {
  const { s, print } = setup();
  const lr = book(s, { toPay: '1,800', hamali: '12.50', qty: '7' });
  const p = got(print.lr(s.db, lr.id));
  const row = s.db.prepare('SELECT * FROM lrs WHERE id = ?').get(lr.id) as LrMoney;
  const a = lrAmounts(row);
  assert.equal(p.mode, 'topay');
  assert.equal(p.freight, inr(a.freight));
  assert.equal(p.hamali, inr(a.hamali));
  assert.equal(p.total, inr(a.total));
  // the same, worked by hand: 1,800 + 12.50
  assert.deepEqual([p.freight, p.hamali, p.total], ['1,800.00', '12.50', '1,812.50']);
  assert.deepEqual(Object.keys(p).filter((k) => /godown|delivery|stax|tax/i.test(k)), [], 'the paper has no charge or tax fields');
  assert.deepEqual([p.lrNo, p.lrYear, p.date, p.from, p.to, p.qty, p.cancelled], [lr.no, 2026, '31-10-2026', 'Yavatmal', 'Nagpur', 7, false]);
  assert.deepEqual([p.consignor, p.consignee, p.particular], ['Shree Ganesh Traders', 'Patil Hardware', 'Cloth bales']);
});

test('print.lr: a paid LR says Paid and its total is freight + hamali, the same as for to pay', () => {
  const { s, print } = setup();
  const lr = book(s, { toPay: '', paid: '2,000', hamali: '40' });
  const p = got(print.lr(s.db, lr.id));
  assert.equal(p.mode, 'paid');
  assert.deepEqual([p.freight, p.hamali, p.total], ['2,000.00', '40.00', '2,040.00']);
});

test('print.lr: an LR with no freight says so, a walk-in is printed as typed, and a cancelled LR carries the flag', () => {
  const { s, print } = setup();
  const lr = book(s, { toPay: '', paid: '', consignor: { firmId: null, name: '  Ravi   Kale ', addToFirms: false } });
  const p = got(print.lr(s.db, lr.id));
  assert.equal(p.mode, 'none');
  assert.equal(p.freight, '0.00');
  assert.equal(p.consignor, 'Ravi Kale', 'as it was saved: the keeper trimmed the typed name when the LR was booked');
  got(s.lrs.cancel(s.db, 'seat-1', lr.id, 1, 'duplicate', SYSTEM));
  assert.equal(got(print.lr(s.db, lr.id)).cancelled, true);
});

test('print.lr: an LR that is not there is refused', () => {
  const { s, print } = setup();
  assert.equal(refused(print.lr(s.db, 999)).code, 'lr-missing');
});

// ---- a firm statement ----

const party = (firmId: number) => ({ firmId, name: '', addToFirms: false });
const OCT = { from: '2026-10-01', to: '2026-10-31' };
/** A = Shree Ganesh Traders, B = Patil Hardware. Worked by hand: a 1,810.50 · b 2,012.75 · c 333.33 (B to A, wasuli 500) · d 100.00. */
function firmWorld() {
  const w = setup();
  const [A, B] = [w.s.ganesh, w.s.patil];
  const a = book(w.s, { date: '2026-10-05', qty: '3', toPay: '1,800', hamali: '10.50', consignor: party(A), consignee: party(B) });
  const b = book(w.s, { date: '2026-10-10', qty: '2', toPay: '', paid: '2,000.50', hamali: '12.25', consignor: party(A), consignee: party(B) });
  const c = book(w.s, { date: '2026-10-12', qty: '5', toPay: '333.33', wasuli: '500', consignor: party(B), consignee: party(A) });
  const d = book(w.s, { date: '2026-10-15', qty: '1', toPay: '100', consignor: party(A), consignee: party(B) });
  return { ...w, A, B, a, b, c, d };
}

test('print.firmStatement: the firm, the period and the LRs by date, every amount as formatted text (a dash for nothing)', () => {
  const { s, print, A, a, b, c, d } = firmWorld();
  const p = got(print.firmStatement(s.db, { firmId: A, role: 'both', ...OCT }));
  assert.deepEqual([p.firm, p.role, p.from, p.to], ['Shree Ganesh Traders', 'both', '01-10-2026', '31-10-2026']);
  assert.equal(p.company.name, 'Sundeep Freight Movers');
  assert.deepEqual(p.rows.map((r) => r.lrNo), [a.no, b.no, c.no, d.no]);
  assert.deepEqual(p.rows[0], { lrNo: a.no, date: '05-10-2026', party: 'Patil Hardware', to: 'Nagpur', qty: 3, toPay: '1,800.00', paid: '–', hamali: '10.50', total: '1,810.50' });
  assert.deepEqual([p.rows[1].toPay, p.rows[1].paid, p.rows[1].hamali, p.rows[1].total], ['–', '2,000.50', '12.25', '2,012.75']);
  assert.deepEqual([p.rows[2].party, p.rows[2].hamali, p.rows[2].total], ['Patil Hardware', '–', '333.33'], 'LR c: the other party is its consignor');
  assert.deepEqual([p.rows[3].hamali, p.rows[3].total], ['–', '100.00'], 'no hamali');
  assert.deepEqual(p.totals, {
    lrs: 4, qty: 11, toPay: '2,233.33', paid: '2,000.50', hamali: '22.75', total: '4,256.58', wasuliOwed: '500.00', wasuliCollected: '0.00', hasWasuli: true,
  });
});

test('print.firmStatement: each row is lrAmounts formatted, and the printed totals are the sums of the unrounded rows', () => {
  const { s, print, A } = firmWorld();
  const p = got(print.firmStatement(s.db, { firmId: A, role: 'both', ...OCT }));
  const lrs = s.db.prepare("SELECT * FROM lrs WHERE lr_date BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY lr_date, lr_no").all() as (LrMoney & { lr_no: number })[];
  p.rows.forEach((r, i) => {
    const m = lrAmounts(lrs[i]);
    assert.equal(r.total, inr(m.total), `LR ${r.lrNo}`);
    assert.equal(r.hamali, m.hamali > 0 ? inr(m.hamali) : '–');
  });
  const sum = lrs.reduce((t, l) => t + lrAmounts(l).total, 0);
  assert.equal(p.totals.total, inr(sum));
});

test('print.firmStatement: the role narrows it, and a statement with nothing owed has no wasuli line', () => {
  const { s, print, A, B } = firmWorld();
  const consignor = got(print.firmStatement(s.db, { firmId: A, role: 'consignor', ...OCT }));
  assert.equal(consignor.rows.length, 3);
  assert.deepEqual([consignor.totals.hasWasuli, consignor.totals.wasuliOwed], [false, '0.00']);
  const consignee = got(print.firmStatement(s.db, { firmId: A, role: 'consignee', ...OCT }));
  assert.deepEqual(consignee.rows.map((r) => r.total), ['333.33']);
  assert.equal(consignee.totals.hasWasuli, true);
  const empty = got(print.firmStatement(s.db, { firmId: B, role: 'both', from: '2026-02-01', to: '2026-02-28' }));
  assert.deepEqual([empty.rows.length, empty.totals.lrs, empty.totals.total, empty.totals.toPay], [0, 0, '0.00', '0.00']);
});

test('print.firmStatement: the whole period is read, not one page of 100; 1,000 LRs print and 1,001 are refused with their number', () => {
  const { s, print, A } = firmWorld();
  const extra = MAX_STATEMENT_PRINT_ROWS - 4;
  for (let i = 0; i < extra; i++) insertLr(s.db, { consignor_id: A, lr_date: '2026-10-20', lr_no: 7000 + i, topay_paise: 100 });
  const p = got(print.firmStatement(s.db, { firmId: A, role: 'consignor', ...OCT }));
  assert.equal(p.rows.length, MAX_STATEMENT_PRINT_ROWS - 1, 'a, b, d and the extra ones (c is the other side)');
  insertLr(s.db, { consignor_id: A, lr_date: '2026-10-20', lr_no: 9000, topay_paise: 100 });
  const exactly = got(print.firmStatement(s.db, { firmId: A, role: 'consignor', ...OCT }));
  assert.equal(exactly.rows.length, MAX_STATEMENT_PRINT_ROWS);
  assert.equal(exactly.totals.lrs, MAX_STATEMENT_PRINT_ROWS);
  const lastNo = exactly.rows[exactly.rows.length - 1].lrNo;
  assert.equal(lastNo, 9000, 'by date, then number');
  insertLr(s.db, { consignor_id: A, lr_date: '2026-10-20', lr_no: 9001, topay_paise: 100 });
  const tooLong = refused(print.firmStatement(s.db, { firmId: A, role: 'consignor', ...OCT }));
  assert.deepEqual([tooLong.code, tooLong.detail], ['print-too-long', String(MAX_STATEMENT_PRINT_ROWS + 1)]);
  assert.equal(got(print.firmStatement(s.db, { firmId: A, role: 'consignor', from: '2026-10-21', to: '2026-10-31' })).rows.length, 0, 'a shorter period prints');
});

test('print.firmStatement: a firm that is not there is refused and nothing is written', () => {
  const { s, print } = firmWorld();
  const before = n(s, 'audit_log');
  assert.equal(refused(print.firmStatement(s.db, { firmId: 999, role: 'both', ...OCT })).code, 'master-missing');
  assert.equal(n(s, 'audit_log'), before);
});

test('print.firmStatement: 1,000 LRs are read in well under 300 ms', () => {
  const { s, print, A } = firmWorld();
  for (let i = 0; i < MAX_STATEMENT_PRINT_ROWS - 4; i++) insertLr(s.db, { consignor_id: A, lr_date: '2026-10-20', lr_no: 7000 + i, topay_paise: 100 });
  assert.equal(got(print.firmStatement(s.db, { firmId: A, role: 'both', ...OCT })).rows.length, MAX_STATEMENT_PRINT_ROWS);
  assert.ok(fastest(5, () => print.firmStatement(s.db, { firmId: A, role: 'both', ...OCT })) < 300);
});

// ---- the audit row ----

test('done: a firm statement writes print.firm with the firm, how, the period and the role; none for a firm that is not there', () => {
  const { s, print, A } = firmWorld();
  got(print.done(s.db, 'PC02', { kind: 'firm', id: A, how: 'pdf', ...OCT, role: 'consignee' }));
  got(print.done(s.db, 'PC03', { kind: 'firm', id: A, how: 'print', from: '2026-10-05', to: '2026-10-05', role: 'both' }));
  assert.deepEqual(audits(s, 'print.firm').map((r) => [r.seat, r.entity, r.entityId, JSON.parse(r.after as string)]), [
    ['PC02', 'firms', String(A), { how: 'pdf', ...OCT, role: 'consignee' }],
    ['PC03', 'firms', String(A), { how: 'print', from: '2026-10-05', to: '2026-10-05', role: 'both' }],
  ]);
  const before = n(s, 'audit_log');
  assert.equal(refused(print.done(s.db, 'PC02', { kind: 'firm', id: 999, how: 'print', ...OCT, role: 'both' })).code, 'master-missing');
  assert.equal(n(s, 'audit_log'), before);
});

test('done: one audit row per print or saved PDF, with the seat, the id and how; none for a memo or LR that is not there', () => {
  const { s, print } = setup();
  const lr = book(s);
  const m = saved(create(s, [lr.id]));
  got(print.done(s.db, 'PC02', { kind: 'memo', id: m.id, how: 'print' }));
  got(print.done(s.db, 'PC02', { kind: 'memo', id: m.id, how: 'pdf' }));
  got(print.done(s.db, 'PC03', { kind: 'lr', id: lr.id, how: 'pdf' }));
  const memoRows = audits(s, 'print.memo');
  assert.deepEqual(memoRows.map((r) => [r.seat, r.entity, r.entityId, JSON.parse(r.after as string)]), [
    ['PC02', 'memos', String(m.id), { how: 'print' }],
    ['PC02', 'memos', String(m.id), { how: 'pdf' }],
  ]);
  assert.deepEqual(audits(s, 'print.lr').map((r) => [r.seat, r.entity, r.entityId, JSON.parse(r.after as string)]), [['PC03', 'lrs', String(lr.id), { how: 'pdf' }]]);

  const before = n(s, 'audit_log');
  assert.equal(refused(print.done(s.db, 'PC02', { kind: 'memo', id: 999, how: 'print' })).code, 'memo-missing');
  assert.equal(refused(print.done(s.db, 'PC02', { kind: 'lr', id: 999, how: 'print' })).code, 'lr-missing');
  assert.equal(n(s, 'audit_log'), before);
});

test('done: printing leaves the LR and memo histories as they were', () => {
  const { s, print } = setup();
  const lr = book(s);
  const m = saved(create(s, [lr.id]));
  const lrHistory = got(s.lrs.history(s.db, lr.id)).length;
  const memoHistory = got(s.memos.history(s.db, m.id)).length;
  got(print.done(s.db, 'PC02', { kind: 'lr', id: lr.id, how: 'print' }));
  got(print.done(s.db, 'PC02', { kind: 'memo', id: m.id, how: 'print' }));
  assert.equal(got(s.lrs.history(s.db, lr.id)).length, lrHistory);
  assert.equal(got(s.memos.history(s.db, m.id)).length, memoHistory);
});

test('done: 60 prints do not push the created / edited entries out of the 50 a history shows', () => {
  const { s, print } = setup();
  const lr = book(s);
  const m = saved(create(s, [lr.id]));
  for (let i = 0; i < 60; i++) {
    got(print.done(s.db, 'PC02', { kind: 'lr', id: lr.id, how: 'print' }));
    got(print.done(s.db, 'PC02', { kind: 'memo', id: m.id, how: i % 2 ? 'pdf' : 'print' }));
  }
  assert.deepEqual(got(s.lrs.history(s.db, lr.id)).map((h) => h.action), ['created']);
  assert.deepEqual(got(s.memos.history(s.db, m.id)).map((h) => h.action), ['created']);
  assert.equal(audits(s, 'print.lr').length + audits(s, 'print.memo').length, 120, 'every print is still in the audit log');
});

// ---- the company lines ----

const company = (over: Partial<PrintCompany> = {}): PrintCompany => ({ name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal 445001', phone: 'Ph 07232 245678', gstin: 'GSTIN 27ABCDE1234F1Z5', ...over });

test('company: until it is set the name is Sundeep Freight Movers and the other lines are empty', () => {
  const { s, print } = setup();
  assert.deepEqual(print.company(s.db), { name: 'Sundeep Freight Movers', address: '', phone: '', gstin: '' });
  // and the printouts carry it
  const lr = book(s);
  assert.equal(got(print.lr(s.db, lr.id)).company.name, 'Sundeep Freight Movers');
});

test('company: the Admin PIN saves it, trimmed with inner runs of spaces made one; the printouts carry it; one audit row has before and after', () => {
  const { s, print } = setup();
  const saved1 = got(print.setCompany(s.db, 'PC02', company({ name: '  Sundeep   Freight  Movers ', address: ' Station Road ' }), ADMIN));
  assert.deepEqual(saved1, company({ address: 'Station Road' }));
  assert.deepEqual(print.company(s.db), company({ address: 'Station Road' }));
  const lr = book(s);
  assert.deepEqual(got(print.lr(s.db, lr.id)).company, company({ address: 'Station Road' }));
  const rows = audits(s, 'settings.company');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seat, 'PC02');
  assert.equal(rows[0].entityId, 'company');
  const after = JSON.parse(rows[0].after as string);
  assert.equal(after.address, 'Station Road');
  assert.ok(!JSON.stringify(rows).includes(ADMIN), 'the PIN is never written');
});

test('company: a wrong PIN or the System PIN writes nothing; the PIN is checked before the boxes', () => {
  const { s, print } = setup();
  const before = { settings: n(s, 'settings'), audit: n(s, 'audit_log') };
  assert.equal(refused(print.setCompany(s.db, 'PC02', company(), '9999')).code, 'wrong-pin');
  assert.equal(refused(print.setCompany(s.db, 'PC02', company(), SYSTEM)).code, 'wrong-pin');
  assert.equal(refused(print.setCompany(s.db, 'PC02', company({ name: '' }), '9999')).code, 'wrong-pin');
  assert.deepEqual({ settings: n(s, 'settings'), audit: n(s, 'audit_log') }, before);
});

test('company: an empty name or a line over 100 characters is refused naming the box, and nothing is written', () => {
  const { s, print } = setup();
  const before = { settings: n(s, 'settings'), audit: n(s, 'audit_log') };
  for (const [over, box] of [
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(101) }, 'name'],
    [{ address: 'y'.repeat(101) }, 'address'],
    [{ phone: 'z'.repeat(101) }, 'phone'],
    [{ gstin: 'g'.repeat(101) }, 'gstin'],
  ] as const) {
    const r = refused(print.setCompany(s.db, 'PC02', company(over), ADMIN));
    assert.equal(r.code, 'company-invalid');
    assert.equal(r.detail, box);
  }
  assert.deepEqual({ settings: n(s, 'settings'), audit: n(s, 'audit_log') }, before);
  got(print.setCompany(s.db, 'PC02', company({ name: 'x'.repeat(100), address: '', phone: '', gstin: '' }), ADMIN)); // exactly 100 is fine, and the optional lines may be empty
});

test('company: saving the same lines again writes no new audit row', () => {
  const { s, print } = setup();
  got(print.setCompany(s.db, 'PC02', company(), ADMIN));
  got(print.setCompany(s.db, 'PC02', company(), ADMIN));
  assert.equal(audits(s, 'settings.company').length, 1);
});

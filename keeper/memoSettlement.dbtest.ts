// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Memo settlement (4.6, "Details of report"): the rate and % typed with the memo, the figures frozen with it, the System-PIN edit behind a saved memo,
// recalculate keeping the rate and %, "differs" counting wasuli, the live preview and the history lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeeperResult, LrInput } from '../shared';
import { memoSettlement } from './memoSettlement';
import { ADMIN, SYSTEM, book, create, lrInput, memoInput, refused, saved, setUp, type Set } from './memoTesting';

const got = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.memoFields ?? r.taken ?? r.fields ?? '')}`);
  return r.value;
};
const n = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
/** What the settlement stores on a memo row. */
const stored = (s: Set, id: number) =>
  s.db
    .prepare(
      `SELECT version, hamali_rate_paise AS rate, commission_bp AS bp, frozen_qty AS qty, frozen_topay_paise AS toPay, frozen_paid_paise AS paid,
         frozen_wasuli_paise AS wasuli, frozen_net_paise AS net, round_rupees AS round FROM memos WHERE id = ?`,
    )
    .get(id) as { version: number; rate: number | null; bp: number | null; qty: number; toPay: number; paid: number; wasuli: number; net: number | null; round: number | null };
/** Everything a refused change may not touch. */
const footprint = (s: Set) =>
  JSON.stringify({
    memos: s.db.prepare('SELECT * FROM memos ORDER BY id').all(),
    audit: n(s, 'audit_log'),
    counters: s.db.prepare('SELECT name, year, last FROM counters ORDER BY name, year').all(),
    lrs: s.db.prepare('SELECT id, status, memo_id, version FROM lrs ORDER BY id').all(),
  });
const lastAudit = (s: Set) =>
  s.db.prepare('SELECT seat, action, entity_id AS entityId, before_json AS before, after_json AS after FROM audit_log ORDER BY id DESC LIMIT 1').get() as {
    seat: string; action: string; entityId: string; before: string | null; after: string | null;
  };
/** The sums of a memo's LRs, added up here in JS from the rows (independent of the keeper's SQL). */
const lrSums = (s: Set, memoId: number) => {
  const rows = s.db.prepare('SELECT qty, topay_paise AS t, paid_paise AS p, wasuli_paise AS w FROM lrs WHERE memo_id = ?').all(memoId) as { qty: number; t: number; p: number; w: number }[];
  return { qty: rows.reduce((a, r) => a + r.qty, 0), toPayPaise: rows.reduce((a, r) => a + r.t, 0), paidPaise: rows.reduce((a, r) => a + r.p, 0), wasuliPaise: rows.reduce((a, r) => a + r.w, 0) };
};
/** A memo of two booked LRs with round amounts: 10 + 5 articles, to pay 1,000 and paid 500, wasuli 300. */
function twoLrs(s: Set, over: Parameters<typeof create>[2] = {}) {
  const a = book(s, { qty: '10', toPay: '1,000', wasuli: '300' });
  const b = book(s, { qty: '5', toPay: '', paid: '500' });
  const made = saved(create(s, [a.id, b.id], over));
  return { id: made.id, lrs: [a, b], get: () => got(s.memos.get(s.db, made.id)) };
}
const editLr = (s: Set, id: number, over: Partial<LrInput>) => {
  const cur = got(s.lrs.get(s.db, id));
  return got(s.lrs.update(s.db, 'seat-1', id, cur.version, lrInput(s, over), SYSTEM));
};

// ---- create ----

test('the old paper\'s example through a real save: 177 articles, paid 220, to pay 6,953, wasuli 4,076, rate 0.40, 10 % -> net 10,240.90, round figure 10,241', () => {
  const s = setUp();
  const a = book(s, { qty: '100', toPay: '6,953', wasuli: '4,076' });
  const b = book(s, { qty: '77', toPay: '', paid: '220' });
  const m = saved(create(s, [a.id, b.id], { hamaliRate: '0.40', commission: '10' }));
  assert.deepEqual(stored(s, m.id), { version: 1, rate: 40, bp: 1000, qty: 177, toPay: 695300, paid: 22000, wasuli: 407600, net: 1024090, round: 10241 });
  const d = got(s.memos.get(s.db, m.id));
  assert.deepEqual([d.hamaliRatePaise, d.commissionBp], [40, 1000]);
  assert.deepEqual(d.frozen, { lrs: 2, qty: 177, toPayPaise: 695300, paidPaise: 22000, hamaliPaise: 0, wasuliPaise: 407600 });
  assert.deepEqual(d.settlement, {
    articles: 177, paidPaise: 22000, toPayPaise: 695300, wasuliPaise: 407600, ratePaise: 40, commissionBp: 1000,
    commissionBasePaise: 717300, hamaliLessPaise: 7080, total1Paise: 688220, commissionLessPaise: 71730, total2Paise: 616490, netPaise: 1024090, roundRupees: 10241,
  });
});

test('what is stored equals memoSettlement of the LRs, over odd amounts and odd rates', () => {
  const s = setUp();
  const odd: Partial<LrInput>[] = [
    { qty: '7', toPay: '1,234.57', wasuli: '11.11', hamali: '1.01' },
    { qty: '13', toPay: '', paid: '999.99', hamali: '3.33' },
    { qty: '1', toPay: '0.05' },
    { qty: '2', toPay: '', paid: '0.01', wasuli: '0.99' },
  ];
  for (const [rate, commission] of [['0.37', '7.5'], ['0', '0'], ['12.5', '100'], ['0.01', '0.01'], ['3', '33.33'], ['0.40', '10']]) {
    const m = saved(create(s, odd.map((o) => book(s, o).id), { hamaliRate: rate, commission }));
    const sums = lrSums(s, m.id);
    const row = stored(s, m.id);
    const want = memoSettlement(sums, row.rate as number, row.bp as number);
    assert.ok(want, 'within the limit');
    assert.deepEqual([row.qty, row.toPay, row.paid, row.wasuli], [sums.qty, sums.toPayPaise, sums.paidPaise, sums.wasuliPaise], `${rate} / ${commission}: frozen sums`);
    assert.deepEqual([row.net, row.round], [want.netPaise, want.roundRupees], `${rate} / ${commission}: net and round figure`);
    assert.equal(row.bp, Math.round(Number(commission) * 100));
    assert.equal(row.rate, Math.round(Number(rate) * 100));
  }
});

test('a negative net is saved as a negative net, with its round figure', () => {
  const s = setUp();
  const a = book(s, { qty: '100', toPay: '10' }); // to pay 10.00, no wasuli
  const m = saved(create(s, [a.id], { hamaliRate: '0.20', commission: '0' })); // 100 x 0.20 = 20.00 off
  assert.deepEqual([stored(s, m.id).net, stored(s, m.id).round], [-1000, -10]);
  assert.equal(got(s.memos.get(s.db, m.id)).settlement?.total1Paise, -1000);
});

test('a save needs both boxes typed; nothing is written, no number is used, the LRs stay booked', () => {
  const s = setUp();
  const a = book(s);
  const before = footprint(s);
  for (const [over, fields] of [
    [{ hamaliRate: '', commission: '10' }, { hamaliRate: 'required' }],
    [{ hamaliRate: '0.40', commission: '' }, { commission: 'required' }],
    [{ hamaliRate: '0.405', commission: '101' }, { hamaliRate: 'amount', commission: 'percent' }],
    [{ hamaliRate: 'abc', commission: '-1' }, { hamaliRate: 'amount', commission: 'amount' }],
  ] as const) {
    const r = refused(create(s, [a.id], over));
    assert.deepEqual([r.code, r.memoFields], ['memo-invalid', fields]);
    assert.equal(footprint(s), before);
  }
  assert.ok(saved(create(s, [a.id], { hamaliRate: '0', commission: '0' })), '0 and 0 are allowed when typed');
});

test('a rate no memo could settle is refused as an amount, never stored: the number is not used and the LRs stay booked', () => {
  const s = setUp();
  const a = book(s, { qty: '999999' });
  const before = footprint(s);
  // 999,999 articles at Rs 1 crore each: inside the rate limit, but past what 500 LRs can add up to, so the refusal comes from inside the saving transaction
  const r = refused(create(s, [a.id], { hamaliRate: '1,00,00,000', commission: '1' }));
  assert.deepEqual([r.code, r.memoFields], ['memo-invalid', { hamaliRate: 'amount' }]);
  assert.equal(footprint(s), before, 'nothing written, no challan number used, the LR still booked');
  assert.equal(saved(create(s, [a.id], { hamaliRate: '1', commission: '1' })).challanNo, 1, 'the first number is still free');
});

test('a retry of a save that went through: the same values are the first memo again; another rate or % is refused and writes nothing (O3)', () => {
  const s = setUp();
  const a = book(s);
  const input = memoInput(s, [a.id], { uid: 'retry-1', hamaliRate: '0.40', commission: '10' });
  const first = saved(s.memos.create(s.db, 'seat-1', input));
  const again = saved(s.memos.create(s.db, 'seat-1', input));
  assert.deepEqual([again.again, again.id], [true, first.id]);
  const before = footprint(s);
  for (const over of [{ hamaliRate: '0.50' }, { commission: '11' }, { hamaliRate: '0.4', commission: '10.5' }]) {
    const r = refused(s.memos.create(s.db, 'seat-1', { ...input, ...over }));
    assert.equal(r.code, 'memo-already-saved');
    assert.equal(r.memo?.id, first.id);
  }
  assert.equal(footprint(s), before);
  assert.equal(saved(s.memos.create(s.db, 'seat-1', { ...input, hamaliRate: '0.4' })).again, true, '0.4 is the same rate as 0.40');
});

test('the save is audited with the rate, the % and the round figure', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  const a = lastAudit(s);
  assert.deepEqual([a.action, a.entityId], ['memos.create', String(m.id)]);
  const after = JSON.parse(a.after ?? '');
  assert.deepEqual([after.hamaliRatePaise, after.commissionBp, after.roundRupees], [40, 1000, m.get().settlement?.roundRupees]);
  assert.equal(after.netPaise, m.get().settlement?.netPaise);
  assert.equal(after.frozen.wasuliPaise, 30000);
});

test('the live preview: the ticked LRs that are still booked, the steps, or the field errors', () => {
  const s = setUp();
  const a = book(s, { qty: '10', toPay: '1,000', wasuli: '300' });
  const b = book(s, { qty: '5', toPay: '', paid: '500' });
  const taken = book(s, { qty: '99', toPay: '9,999' });
  saved(create(s, [taken.id])); // loaded elsewhere: it is not counted
  const ids = [a.id, b.id, taken.id];

  const ok = got(s.memos.settlement(s.db, ids, '0.40', '10'));
  assert.deepEqual(ok.totals, { lrs: 2, qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 30000 });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.settlement, memoSettlement({ qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 30000 }, 40, 1000));

  const half = got(s.memos.settlement(s.db, ids, '', '10'));
  assert.deepEqual([half.errors, half.settlement, half.totals.lrs], [{ hamaliRate: 'required' }, null, 2]);
  assert.deepEqual(got(s.memos.settlement(s.db, ids, '0.40', '150')).errors, { commission: 'percent' });
  assert.deepEqual(got(s.memos.settlement(s.db, ids, 'x', 'y')).errors, { hamaliRate: 'amount', commission: 'amount' });
  assert.deepEqual(got(s.memos.settlement(s.db, [], '0.40', '10')).totals, { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, wasuliPaise: 0 });
  const before = footprint(s);
  got(s.memos.settlement(s.db, ids, '0.40', '10'));
  assert.equal(footprint(s), before, 'a preview writes nothing');
});

test('the live preview of a SAVED memo (Edit rate / commission) is worked from its frozen totals, not from the LRs now; an unknown memo is refused', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  editLr(s, m.lrs[0].id, { qty: '40', toPay: '1,000', wasuli: '300' }); // the LRs now add up to 45 articles; the memo was printed with 15
  const p = got(s.memos.settlement(s.db, [], '0.50', '8', m.id));
  assert.deepEqual(p.totals, { lrs: 2, qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 30000 });
  assert.deepEqual(p.settlement, memoSettlement({ qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 30000 }, 50, 800));
  assert.deepEqual(got(s.memos.settlement(s.db, [], '', '8', m.id)).errors, { hamaliRate: 'required' });
  assert.equal(refused(s.memos.settlement(s.db, [], '0.50', '8', 9999)).code, 'memo-missing');
});

test('the live totals of the ticked LRs now carry wasuli', () => {
  const s = setUp();
  const a = book(s, { wasuli: '12.34' });
  assert.equal(got(s.memos.totals(s.db, [a.id])).wasuliPaise, 1234);
});

// ---- edit the rate / commission of a saved memo ----

test('editSettlement: the System PIN first, then the version; a refusal writes nothing', () => {
  const s = setUp();
  const m = twoLrs(s);
  const v = m.get().version;
  const before = footprint(s);
  assert.equal(refused(s.memos.editSettlement(s.db, 'seat-1', m.id, v, '0.50', '8', '0000')).code, 'wrong-pin');
  assert.equal(refused(s.memos.editSettlement(s.db, 'seat-1', m.id, v, '0.50', '8', ADMIN)).code, 'wrong-pin', 'the Admin PIN is not the System PIN');
  const stale = refused(s.memos.editSettlement(s.db, 'seat-1', m.id, v - 1, '0.50', '8', SYSTEM));
  assert.deepEqual([stale.code, stale.memo?.id], ['memo-stale', m.id]);
  assert.equal(refused(s.memos.editSettlement(s.db, 'seat-1', 9999, v, '0.50', '8', SYSTEM)).code, 'memo-missing');
  const bad = refused(s.memos.editSettlement(s.db, 'seat-1', m.id, v, '', '101', SYSTEM));
  assert.deepEqual([bad.code, bad.memoFields], ['memo-invalid', { hamaliRate: 'required', commission: 'percent' }]);
  assert.equal(footprint(s), before);
});

test('editSettlement: recomputed from the memo\'s FROZEN totals, one version up, one audit row old -> new', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  const d0 = m.get();
  const r = got(s.memos.editSettlement(s.db, 'seat-2', m.id, d0.version, '0.50', '8', SYSTEM));
  assert.equal(r.changed, true);
  assert.equal(r.memo.version, d0.version + 1);
  const want = memoSettlement({ qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 30000 }, 50, 800);
  assert.ok(want);
  assert.deepEqual(r.memo.settlement, want);
  assert.deepEqual(stored(s, m.id), { version: 2, rate: 50, bp: 800, qty: 15, toPay: 100000, paid: 50000, wasuli: 30000, net: want.netPaise, round: want.roundRupees });
  const a = lastAudit(s);
  assert.deepEqual([a.action, a.seat, a.entityId], ['memos.settlement', 'seat-2', String(m.id)]);
  assert.deepEqual(JSON.parse(a.before ?? ''), { hamaliRatePaise: 40, commissionBp: 1000, netPaise: d0.settlement?.netPaise, roundRupees: d0.settlement?.roundRupees });
  assert.deepEqual(JSON.parse(a.after ?? ''), { hamaliRatePaise: 50, commissionBp: 800, netPaise: want.netPaise, roundRupees: want.roundRupees });
});

test('editSettlement: the same values write nothing; a cancelled memo cannot be changed', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  const before = footprint(s);
  const same = got(s.memos.editSettlement(s.db, 'seat-1', m.id, m.get().version, '0.4', '10.00', SYSTEM));
  assert.equal(same.changed, false);
  assert.equal(footprint(s), before);
  got(s.memos.cancel(s.db, 'seat-1', m.id, m.get().version, 'wrong truck', ADMIN));
  assert.equal(refused(s.memos.editSettlement(s.db, 'seat-1', m.id, m.get().version, '0.50', '8', SYSTEM)).code, 'memo-cancelled');
});

test('editSettlement uses what was printed: an LR edited since does not change the figures, the memo still differs', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  editLr(s, m.lrs[0].id, { qty: '40', toPay: '1,000', wasuli: '300' });
  const d = m.get();
  assert.equal(d.differs, true);
  const r = got(s.memos.editSettlement(s.db, 'seat-1', m.id, d.version, '0.50', '8', SYSTEM));
  assert.equal(r.memo.frozen.qty, 15, 'frozen totals untouched');
  assert.equal(r.memo.settlement?.articles, 15);
  assert.equal(r.memo.differs, true);
});

test('a memo saved before v5 has no settlement; its first one is given through editSettlement', () => {
  const s = setUp();
  const m = twoLrs(s);
  s.db.prepare('UPDATE memos SET hamali_rate_paise = NULL, commission_bp = NULL, frozen_net_paise = NULL, round_rupees = NULL WHERE id = ?').run(m.id); // as a v4 memo looks after the migration
  const old = m.get();
  assert.deepEqual([old.hamaliRatePaise, old.commissionBp, old.settlement], [null, null, null]);
  const r = got(s.memos.editSettlement(s.db, 'seat-1', m.id, old.version, '0.40', '10', SYSTEM));
  assert.equal(r.changed, true);
  assert.equal(r.memo.settlement?.ratePaise, 40);
  assert.deepEqual(JSON.parse(lastAudit(s).before ?? ''), { hamaliRatePaise: null, commissionBp: null, netPaise: null, roundRupees: null });
});

// ---- recalculate and "differs" ----

test('differs: an LR edit that changes only the wasuli makes the memo differ; recalculate keeps the rate and %, refreshes wasuli, net and round figure', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  const d0 = m.get();
  assert.equal(d0.differs, false);
  editLr(s, m.lrs[0].id, { qty: '10', toPay: '1,000', wasuli: '450' }); // only the wasuli moves
  const d = m.get();
  assert.equal(d.differs, true, 'wasuli alone is enough');
  assert.equal(d.now.wasuliPaise, 45000);
  assert.equal(d.frozen.wasuliPaise, 30000);

  const r = got(s.memos.recalculate(s.db, 'seat-1', m.id, d.version, ADMIN));
  assert.equal(r.changed, true);
  assert.equal(r.memo.differs, false);
  assert.deepEqual([r.memo.hamaliRatePaise, r.memo.commissionBp], [40, 1000], 'the same rate and %');
  const want = memoSettlement({ qty: 15, toPayPaise: 100000, paidPaise: 50000, wasuliPaise: 45000 }, 40, 1000);
  assert.ok(want);
  assert.deepEqual([stored(s, m.id).wasuli, stored(s, m.id).net, stored(s, m.id).round], [45000, want.netPaise, want.roundRupees]);
  assert.equal(want.netPaise, (d0.settlement?.netPaise as number) + 15000, 'net moved by the 150.00 of wasuli');
  const a = lastAudit(s);
  assert.equal(JSON.parse(a.before ?? '').netPaise, d0.settlement?.netPaise);
  assert.equal(JSON.parse(a.after ?? '').netPaise, want.netPaise);
  assert.equal(JSON.parse(a.after ?? '').wasuliPaise, 45000);
});

test('recalculate of a memo saved before v5 refreshes its totals and leaves the settlement empty', () => {
  const s = setUp();
  const m = twoLrs(s);
  s.db.prepare('UPDATE memos SET hamali_rate_paise = NULL, commission_bp = NULL, frozen_net_paise = NULL, round_rupees = NULL WHERE id = ?').run(m.id);
  editLr(s, m.lrs[0].id, { qty: '10', toPay: '1,000', wasuli: '450' });
  const r = got(s.memos.recalculate(s.db, 'seat-1', m.id, m.get().version, ADMIN));
  assert.equal(r.changed, true);
  assert.deepEqual([stored(s, m.id).wasuli, stored(s, m.id).net, stored(s, m.id).round, r.memo.settlement], [45000, null, null, null]);
});

test('a saved-memos list row differs when only the wasuli changed (the SQL twin of the check above)', () => {
  const s = setUp();
  const m = twoLrs(s);
  editLr(s, m.lrs[0].id, { qty: '10', toPay: '1,000', wasuli: '450' });
  const page = got(s.memos.list(s.db, { from: null, to: null, truckId: null, toStationId: null }, null));
  assert.equal(page.rows[0].differs, true);
});

// ---- history ----

test('history: a save says the rate, the % and the round figure; an edit says old -> new', () => {
  const s = setUp();
  const m = twoLrs(s, { hamaliRate: '0.40', commission: '10' });
  const d = m.get();
  got(s.memos.editSettlement(s.db, 'seat-1', m.id, d.version, '0.50', '8', SYSTEM));
  const h = got(s.memos.history(s.db, m.id));
  assert.deepEqual(h.map((e) => e.action), ['settlement', 'created']);
  const edit = h[0].changes;
  assert.deepEqual(edit.map((c) => [c.field, c.from, c.to]), [
    ['hamaliRate', 40, 50],
    ['commission', 1000, 800],
    ['roundFigure', d.settlement?.roundRupees, got(s.memos.get(s.db, m.id)).settlement?.roundRupees],
  ]);
  assert.deepEqual(h[1].changes.map((c) => [c.field, c.from, c.to]), [
    ['hamaliRate', null, 40],
    ['commission', null, 1000],
    ['roundFigure', null, d.settlement?.roundRupees],
  ]);
});

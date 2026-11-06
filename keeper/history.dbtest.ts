// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// History (4.2): the audit log, read. Every row here comes from the real saves (so the shapes are the real ones), then is read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoryCursor, HistoryFilters, HistoryRow, KeeperResult, WasuliChanged, WasuliRow, WasuliSeen } from '../shared';
import { writeAudit } from './audit';
import { makeFirmAccounts } from './firmAccounts';
import { utcBounds } from './historyRules';
import { makeHistory, pageSql } from './history';
import { ADMIN, SYSTEM, book, create, lrInput, now, saved, setUp, type Set } from './memoTesting';
import { makePrint } from './print';
import { makeReports } from './reports';
import { fastest } from './testing';
import { makeWasuli } from './wasuli';

const ALL: HistoryFilters = {
  from: '2000-01-01', to: '2999-12-31', seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: false,
};
const history = makeHistory(now);
const got = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.fields ?? r.memoFields ?? r.wasuliFields ?? r.detail ?? '')}`);
  return r.value;
};
const seen = (r: WasuliRow): WasuliSeen => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
const one = (r: KeeperResult<WasuliChanged>): WasuliRow => got(r).rows[0];

/** Every page of a filter, until there is no next one. */
function everything(s: Pick<Set, 'db'>, f: Partial<HistoryFilters> = {}): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let cursor: HistoryCursor | null = null;
  for (let i = 0; i < 1000; i++) {
    const page: { rows: HistoryRow[]; next: HistoryCursor | null } = got(history.list(s.db, { ...ALL, ...f }, cursor));
    rows.push(...page.rows);
    if (!page.next) return rows;
    cursor = page.next;
  }
  throw new Error('a history that never ends');
}
const of = (rows: HistoryRow[], action: string): HistoryRow[] => rows.filter((r) => r.action === action);
const raw = (s: Pick<Set, 'db'>, at: string, over: Partial<{ seat: string; action: string; entity: string; entityId: string; before: string | null; after: string | null }> = {}) =>
  s.db
    .prepare('INSERT INTO audit_log (at, seat, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(at, over.seat ?? 'PC09', over.action ?? 'pins.change-admin', over.entity ?? 'settings', over.entityId ?? 'pins', over.before ?? null, over.after ?? null);

/**
 * One book of everything: LRs (booked, edited, cancelled and restored, with wasuli), two memos (edited, LRs off / on / moved, recalculated,
 * cancelled), the whole wasuli road, masters, settings, PINs and prints, on three seats. Ids overlap on purpose: LR 1, memo 1, firm 1, station 1.
 */
function world() {
  const s = setUp();
  const wasuli = makeWasuli(s.pins, now);
  const print = makePrint(s.pins, s.memos, makeFirmAccounts(now), makeReports());
  const ramesh = got(s.masters.create(s.db, 'seat-1', 'agents', { name: 'Ramesh' })).id;
  const suresh = got(s.masters.create(s.db, 'seat-1', 'agents', { name: 'Suresh' })).id;

  const a = book(s, { wasuli: '500', qty: '3', toPay: '1,800' });
  const b = book(s, { toPay: '900' });
  const c = book(s);
  const lrVersion = (id: number) => got(s.lrs.get(s.db, id)).version;
  got(s.lrs.cancel(s.db, 'PC03', c.id, lrVersion(c.id), 'duplicate entry', SYSTEM));
  got(s.lrs.restore(s.db, 'PC03', c.id, lrVersion(c.id), SYSTEM));
  const m1 = saved(create(s, [a.id, b.id], {}, 'seat-1'));
  const m2 = saved(create(s, [c.id], {}, 'PC02'));

  // The booking changes after it was loaded: the memo now differs from its frozen totals.
  got(s.lrs.update(s.db, 'PC02', a.id, lrVersion(a.id), lrInput(s, { wasuli: '500', qty: '5', toPay: '2,000', toStationId: s.amravati }), SYSTEM));
  const d1 = got(s.memos.get(s.db, m1.id));
  got(
    s.memos.editHeader(s.db, 'PC02', m1.id, d1.version, {
      date: d1.date, truckId: s.truck2, driverId: d1.driverId, fromStationId: d1.fromStationId, toStationId: d1.toStationId,
      truckHire: '5,000', loadingHamali: String(d1.loadingHamaliPaise / 100),
    }, SYSTEM),
  );
  got(s.memos.removeLrs(s.db, 'PC02', m1.id, [b.id], SYSTEM));
  got(s.memos.addLrs(s.db, 'PC02', m2.id, [b.id], SYSTEM));
  got(s.memos.moveLrs(s.db, 'PC03', m2.id, [b.id], m1.id, SYSTEM));
  got(s.memos.recalculate(s.db, 'PC02', m1.id, got(s.memos.get(s.db, m1.id)).version, ADMIN));
  got(s.memos.cancel(s.db, 'PC02', m2.id, got(s.memos.get(s.db, m2.id)).version, 'wrong truck', ADMIN));

  // The wasuli road of LR a, then a collection that comes and goes with LR d's amount.
  const w0 = got(wasuli.find(s.db, a.no));
  const w1 = one(wasuli.assign(s.db, 'PC02', [seen(w0)], ramesh));
  const w2 = one(wasuli.reassign(s.db, 'PC02', seen(w1), suresh));
  const w3 = one(wasuli.toPool(s.db, 'PC02', seen(w2)));
  const w4 = one(wasuli.assign(s.db, 'PC02', [seen(w3)], ramesh));
  const w5 = one(wasuli.collect(s.db, 'PC03', seen(w4), { amount: '500', mode: 'cash', remark: 'in full' }));
  const w6 = one(wasuli.uncollect(s.db, 'PC03', seen(w5), SYSTEM));
  const w7 = one(wasuli.collect(s.db, 'PC03', seen(w6), { amount: '300', mode: 'upi', remark: '' }));
  one(wasuli.remark(s.db, 'PC03', seen(w7), 'rest next week', SYSTEM));
  const d = book(s, { wasuli: '300' });
  got(s.lrs.update(s.db, 'PC02', d.id, lrVersion(d.id), lrInput(s, { wasuli: '400' }), SYSTEM));
  got(s.lrs.update(s.db, 'PC02', d.id, lrVersion(d.id), lrInput(s, { wasuli: '' }), SYSTEM));

  // Masters: a firm renamed and given a station, a truck out and back, a station, a driver and an agent renamed.
  const firm = s.masters.all(s.db).firms.find((f) => f.id === s.ganesh);
  got(s.masters.update(s.db, 'PC02', 'firms', s.ganesh, firm?.version ?? 0, { name: 'Shree Ganesh Traders Pvt', stationId: s.yavatmal, phone: '9822011223' }, SYSTEM));
  const truck = s.masters.all(s.db).trucks.find((t) => t.id === s.truck2);
  const off = got(s.masters.setActive(s.db, 'PC02', 'trucks', s.truck2, truck?.version ?? 0, false, SYSTEM));
  got(s.masters.setActive(s.db, 'PC02', 'trucks', s.truck2, off.version, true, SYSTEM));
  got(s.masters.update(s.db, 'PC02', 'stations', s.amravati, 1, { name: 'Amravati Camp' }, SYSTEM));
  got(s.masters.update(s.db, 'PC02', 'drivers', 1, 1, { name: 'Ramesh Pawar Sr', phone: '' }, SYSTEM));
  got(s.masters.update(s.db, 'PC02', 'agents', suresh, 1, { name: 'Suresh Kale', phone: '' }, SYSTEM));

  got(s.lrs.setDefaults(s.db, 'PC02', { bookingStationId: s.yavatmal, chargeOption: 'option2', staxPercent: '2.5' }, ADMIN));
  got(print.setCompany(s.db, 'PC02', { name: 'Sundeep Freight Movers', address: 'Station Road', phone: '', gstin: '' }, ADMIN));
  got(print.done(s.db, 'PC03', { kind: 'lr', id: a.id, how: 'print' }));
  got(print.done(s.db, 'PC03', { kind: 'memo', id: m1.id, how: 'pdf' }));
  got(print.done(s.db, 'PC03', { kind: 'firm', id: s.ganesh, how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'consignee' }));
  got(print.done(s.db, 'PC03', { kind: 'report', id: 0, how: 'print', report: 'dateWise', from: '2026-10-01', to: '2026-10-31', filters: { toStationId: null, text: '', truckId: null, agentId: null } }));
  got(s.pins.changeSystem(s.db, 'PC02', ADMIN, '4444'));
  // What the keeper's own routes write (4.2): the shapes the rows are read by.
  s.db.transaction(() => {
    writeAudit(s.db, { seat: 'PC02', action: 'pins.locked', entity: 'settings', entityId: 'pins', after: { kind: 'system' } });
    writeAudit(s.db, { seat: 'PC02', action: 'settings.backup-dir', entity: 'settings', entityId: 'backup-dir', before: { dir: 'D:\\BookingManagerBackups' }, after: { dir: 'E:\\BM' } });
    writeAudit(s.db, { seat: 'PC02', action: 'seat.rename', entity: 'seats', entityId: 'PC02', before: { name: 'PC02' }, after: { name: 'Counter 2' } });
    writeAudit(s.db, { seat: 'Counter 2', action: 'app.update', entity: 'settings', entityId: 'app', before: { version: '0.2.1' }, after: { version: '0.3.0' } });
    writeAudit(s.db, { seat: 'Counter 2', action: 'backup.restore', entity: 'backup', entityId: 'booking-20261030-0900.db', after: { file: 'booking-20261030-0900.db', savedAs: 'booking-before-restore-20261106-1010.db' } });
  })();
  return { s, a, b, c, d, m1, m2, ramesh, suresh };
}

test('every action the keeper writes is known to the filters, and no row breaks the page', () => {
  const { s } = world();
  const rows = everything(s, { showPrints: true });
  assert.ok(rows.length > 60, `${rows.length} rows`);
  const codes = new Set(rows.map((r) => r.action));
  assert.deepEqual(rows.filter((r) => r.kind === 'other' || r.verb === 'other').map((r) => r.action), [], 'a code the table does not know');
  for (const must of [
    'lrs.create', 'lrs.update', 'lrs.cancel', 'lrs.restore', 'lrs.memo-remove', 'lrs.memo-move', 'lrs.memo-add', 'lrs.memo-cancel',
    'memos.create', 'memos.edit', 'memos.remove-lrs', 'memos.move-out', 'memos.move-in', 'memos.add-lrs', 'memos.recalculate', 'memos.cancel',
    'wasuli.create', 'wasuli.update', 'wasuli.remove', 'wasuli.assign', 'wasuli.reassign', 'wasuli.to-pool', 'wasuli.collect', 'wasuli.uncollect', 'wasuli.remark',
    'masters.create', 'masters.update', 'masters.activate', 'masters.deactivate', 'pins.setup', 'pins.change-system', 'pins.locked',
    'settings.lr-defaults', 'settings.company', 'settings.backup-dir', 'seat.rename', 'app.update', 'backup.restore',
    'print.lr', 'print.memo', 'print.firm', 'print.report',
  ]) assert.ok(codes.has(must), `the world never wrote ${must}`);
});

test('LR rows: the number, what was booked, what an edit changed (stations by name, money in paise), the reason of a cancel', () => {
  const { s, a } = world();
  const rows = everything(s);
  const created = of(rows, 'lrs.create').find((r) => r.lrNo === a.no);
  assert.ok(created);
  assert.deepEqual([created.kind, created.verb, created.record, created.openId, created.lrYear, created.seat], ['lr', 'created', 'lr', a.id, 2026, 'seat-1']);
  assert.deepEqual(created.facts, { consignor: 'Shree Ganesh Traders', consignee: 'Patil Hardware', station: 'Nagpur', qty: 3 });

  const edited = of(rows, 'lrs.update').find((r) => r.lrNo === a.no);
  assert.deepEqual(edited?.changes, [
    { field: 'toStation', from: 'Nagpur', to: 'Amravati Camp' }, // a station is named by its current name: it was renamed after this edit
    { field: 'qty', from: 3, to: 5 },
    { field: 'toPay', from: 180000, to: 200000, unit: 'paise' },
  ]);
  assert.equal(edited?.seat, 'PC02');

  const cancelled = of(rows, 'lrs.cancel')[0];
  assert.deepEqual([cancelled.verb, cancelled.facts.reason, cancelled.seat], ['cancelled', 'duplicate entry', 'PC03']);
  assert.equal(of(rows, 'lrs.restore')[0].verb, 'restored');
});

test('memo rows: the challan, the truck / driver / stations by name, the LR numbers, the other challan of a move, the recalculated totals', () => {
  const { s, a, b, c, m1, m2 } = world();
  const rows = everything(s);
  const made = of(rows, 'memos.create').find((r) => r.challanNo === m1.challanNo);
  assert.deepEqual([made?.record, made?.openId, made?.challanYear], ['memo', m1.id, 2026]);
  assert.deepEqual(made?.facts, { truck: 'MH 29 BE 1234', driver: 'Ramesh Pawar Sr', fromStation: 'Yavatmal', toStation: 'Nagpur', lrCount: 2 });

  assert.deepEqual(of(rows, 'memos.edit')[0].changes, [
    { field: 'truck', from: 'MH 29 BE 1234', to: 'MH 29 AB 1' },
    { field: 'truckHire', from: 0, to: 500000, unit: 'paise' },
  ]);
  assert.deepEqual(of(rows, 'memos.remove-lrs')[0].facts.lrNos, [b.no]);
  assert.deepEqual(of(rows, 'memos.add-lrs')[0].facts.lrNos, [b.no]);
  const out = of(rows, 'memos.move-out')[0];
  assert.deepEqual([out.challanNo, out.facts.otherChallanNo, out.facts.lrNos], [m2.challanNo, m1.challanNo, [b.no]]);
  assert.deepEqual([of(rows, 'memos.move-in')[0].challanNo, of(rows, 'memos.move-in')[0].facts.otherChallanNo], [m1.challanNo, m2.challanNo]);
  assert.deepEqual(of(rows, 'memos.recalculate')[0].changes, [
    { field: 'qty', from: 6, to: 8 },
    { field: 'toPay', from: 270000, to: 290000, unit: 'paise' },
  ]);
  const cancel = of(rows, 'memos.cancel')[0];
  assert.deepEqual([cancel.challanNo, cancel.facts.reason, cancel.facts.lrNos], [m2.challanNo, 'wrong truck', [c.no]]);

  // The same LR's own rows for the moves carry the challan numbers.
  const lrMoves = rows.filter((r) => r.action.startsWith('lrs.memo-') && r.lrNo === b.no);
  assert.deepEqual(lrMoves.map((r) => [r.action, r.facts.challanNo, r.facts.otherChallanNo]).sort(), [
    ['lrs.memo-add', m2.challanNo, undefined],
    ['lrs.memo-move', m2.challanNo, m1.challanNo],
    ['lrs.memo-remove', m1.challanNo, undefined],
  ]);
  assert.equal(rows.filter((r) => r.action === 'lrs.memo-cancel')[0].lrNo, c.no);
  assert.ok(a.no > 0);
});

test('wasuli rows: the LR, the agents by name, what was collected of what was owed, the remark; a removed collection still knows its LR', () => {
  const { s, a, d } = world();
  const rows = everything(s);
  const w = (action: string, lrNo: number) => of(rows, action).find((r) => r.lrNo === lrNo);
  assert.deepEqual([w('wasuli.create', a.no)?.facts, w('wasuli.create', a.no)?.record], [{ amountPaise: 50000 }, 'wasuli']);
  assert.deepEqual(w('wasuli.assign', a.no)?.facts, { agent: 'Ramesh' });
  assert.deepEqual(w('wasuli.reassign', a.no)?.facts, { fromAgent: 'Ramesh', agent: 'Suresh Kale' });
  assert.deepEqual(w('wasuli.to-pool', a.no)?.facts, { fromAgent: 'Suresh Kale' });
  const collects = of(rows, 'wasuli.collect').filter((r) => r.lrNo === a.no);
  assert.deepEqual(collects.map((r) => r.facts).reverse(), [
    { agent: 'Ramesh', amountPaise: 50000, owedPaise: 50000, mode: 'cash', remark: 'in full' },
    { agent: 'Ramesh', amountPaise: 30000, owedPaise: 50000, mode: 'upi' },
  ]);
  assert.deepEqual(w('wasuli.uncollect', a.no)?.facts, { agent: 'Ramesh', amountPaise: 50000 });
  assert.deepEqual(w('wasuli.remark', a.no)?.changes, [{ field: 'remark', from: '', to: 'rest next week' }]);
  assert.deepEqual(w('wasuli.update', d.no)?.changes, [{ field: 'amount', from: 30000, to: 40000, unit: 'paise' }]);
  const removed = w('wasuli.remove', d.no);
  assert.ok(removed, 'the removed collection is found by its LR, which is read from the row that was kept');
  assert.deepEqual([removed.facts.amountPaise, removed.record, removed.lrYear], [40000, 'wasuli', 2026]);
});

test('master rows: the name as it was in the row, a changed station by name, the current record to open; a renamed firm keeps its old rows', () => {
  const { s } = world();
  const rows = everything(s);
  const firm = (action: string) => rows.filter((r) => r.action === action && r.record === 'firm');
  const created = firm('masters.create').find((r) => r.name === 'Shree Ganesh Traders');
  const renamed = firm('masters.update').find((r) => r.name === 'Shree Ganesh Traders Pvt');
  assert.ok(created, 'the older row still says the old name');
  assert.ok(renamed);
  assert.equal(created.openId, renamed.openId, 'both lead to the one current firm');
  assert.deepEqual(renamed.changes, [
    { field: 'name', from: 'Shree Ganesh Traders', to: 'Shree Ganesh Traders Pvt' },
    { field: 'phone', from: '', to: '9822011223' },
    { field: 'station', from: null, to: 'Yavatmal' },
  ]);
  const truck = rows.filter((r) => r.record === 'truck');
  assert.deepEqual(truck.map((r) => [r.action, r.verb, r.name]).filter(([a]) => a !== 'masters.create'), [
    ['masters.activate', 'activated', 'MH 29 AB 1'],
    ['masters.deactivate', 'deactivated', 'MH 29 AB 1'],
  ]);
  assert.deepEqual(rows.filter((r) => r.record === 'station' && r.action === 'masters.update').map((r) => r.changes), [[{ field: 'name', from: 'Amravati', to: 'Amravati Camp' }]]);
  assert.deepEqual(rows.filter((r) => r.record === 'driver' && r.action === 'masters.update')[0].changes[0].to, 'Ramesh Pawar Sr');
  assert.deepEqual(rows.filter((r) => r.record === 'agent' && r.action === 'masters.update')[0].changes[0], { field: 'name', from: 'Suresh', to: 'Suresh Kale' });
});

test('ids that are the same number in different tables never meet: LR 1, memo 1, firm 1, station 1, truck 1, wasuli 1', () => {
  const { s, a, m1 } = world();
  const rows = everything(s);
  const first = (record: string) => rows.find((r) => r.record === record && r.openId === 1);
  assert.equal(first('lr')?.lrNo, a.no);
  assert.equal(first('memo')?.challanNo, m1.challanNo);
  const madeFirst = (record: string) => rows.find((r) => r.record === record && r.openId === 1 && r.action === 'masters.create');
  assert.equal(madeFirst('firm')?.name, 'Shree Ganesh Traders');
  assert.equal(madeFirst('station')?.name, 'Yavatmal');
  assert.equal(madeFirst('truck')?.name, 'MH 29 BE 1234');
  assert.equal(madeFirst('driver')?.name, 'Ramesh Pawar');
  assert.ok(first('firm') && first('station'), 'and the newer rows of the same ids are there');
  // A memo's row has no LR number and an LR's row has no challan number: nothing was borrowed from the other table.
  assert.ok(rows.filter((r) => r.record === 'memo').every((r) => r.lrNo === null && r.challanNo !== null));
  assert.ok(rows.filter((r) => r.record === 'lr').every((r) => r.challanNo === null && r.lrNo !== null));
});

test('the settings, PIN, backup, seat and update rows: what changed, old -> new', () => {
  const { s } = world();
  const rows = everything(s);
  assert.deepEqual(of(rows, 'settings.lr-defaults')[0].changes, [
    { field: 'bookingStation', from: null, to: 'Yavatmal' },
    { field: 'chargeOption', from: 'blank', to: 'option2', unit: 'option' },
    { field: 'staxPercent', from: '0', to: '2.5', unit: 'percent' },
  ]);
  assert.deepEqual(of(rows, 'settings.company')[0].changes.map((c) => c.field), ['address']);
  assert.deepEqual(of(rows, 'settings.backup-dir')[0].changes, [{ field: 'backupDir', from: 'D:\\BookingManagerBackups', to: 'E:\\BM' }]);
  assert.deepEqual(of(rows, 'seat.rename')[0].changes, [{ field: 'seatName', from: 'PC02', to: 'Counter 2' }]);
  assert.deepEqual(of(rows, 'app.update')[0].changes, [{ field: 'version', from: '0.2.1', to: '0.3.0' }]);
  assert.deepEqual(of(rows, 'backup.restore')[0].facts, { file: 'booking-20261030-0900.db', savedAs: 'booking-before-restore-20261106-1010.db' });
  const locked = of(rows, 'pins.locked')[0];
  assert.deepEqual([locked.facts.pin, locked.seat, locked.verb, locked.record], ['system', 'PC02', 'lockedOut', null]);
  assert.deepEqual(of(rows, 'pins.change-system').map((r) => [r.seat, r.record]), [['PC02', null]]);
});

test('prints are left out unless asked for, and then they say what was printed and how', () => {
  const { s, a, m1 } = world();
  assert.equal(everything(s).filter((r) => r.kind === 'print').length, 0);
  assert.equal(everything(s, { showPrints: true }).filter((r) => r.kind === 'print').length, 4);
  const prints = everything(s, { kind: 'print' });
  assert.equal(prints.length, 4, 'choosing the kind shows them without the switch');
  assert.equal(everything(s, { verb: 'printed' }).length, 4);
  const lr = of(prints, 'print.lr')[0];
  assert.deepEqual([lr.record, lr.openId, lr.lrNo, lr.facts.how], ['lr', a.id, a.no, 'print']);
  assert.deepEqual([of(prints, 'print.memo')[0].challanNo, of(prints, 'print.memo')[0].facts.how], [m1.challanNo, 'pdf']);
  const firm = of(prints, 'print.firm')[0];
  assert.deepEqual([firm.record, firm.name, firm.facts], ['firm', 'Shree Ganesh Traders Pvt', { how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'consignee' }]);
  const report = of(prints, 'print.report')[0];
  assert.deepEqual([report.record, report.name, report.facts.report], [null, 'dateWise', 'dateWise']);
  assert.equal(of(everything(s, { showPrints: true, kind: 'lr' }), 'print.lr').length, 0, 'a print of an LR is a print, not an LR change');
});

test('filters: seat, kind, verb, and kind with verb', () => {
  const { s } = world();
  const bySeat = everything(s, { seat: 'pc03' });
  assert.ok(bySeat.length > 0 && bySeat.every((r) => r.seat === 'PC03'), 'a part of the name, any case');
  assert.equal(everything(s, { seat: 'PC0' }).every((r) => r.seat.startsWith('PC0')), true);
  assert.equal(everything(s, { seat: 'no-such-seat' }).length, 0);

  assert.ok(everything(s, { kind: 'wasuli' }).every((r) => r.kind === 'wasuli'));
  assert.ok(everything(s, { kind: 'firm' }).every((r) => r.record === 'firm' && r.kind === 'firm'));
  const cancelled = everything(s, { verb: 'cancelled' });
  assert.deepEqual(cancelled.map((r) => r.action).sort(), ['lrs.cancel', 'memos.cancel']);
  assert.deepEqual(everything(s, { kind: 'memo', verb: 'cancelled' }).map((r) => r.action), ['memos.cancel']);
  assert.deepEqual(everything(s, { kind: 'lr', verb: 'collected' }), []);
  assert.deepEqual(everything(s, { verb: 'lockedOut' }).map((r) => r.action), ['pins.locked']);
  assert.deepEqual(everything(s, { kind: 'backup' }).map((r) => r.action).sort(), ['backup.restore', 'settings.backup-dir']);
  const edited = everything(s, { verb: 'edited' });
  assert.ok(edited.some((r) => r.record === 'firm') && edited.some((r) => r.record === 'agent') && edited.some((r) => r.action === 'lrs.update'));
  assert.ok(edited.every((r) => r.verb === 'edited'));
});

test('LR no.: that LR\'s own rows and its wasuli rows, this year unless a year is given; the memo that loaded it is found by challan no.', () => {
  const { s, a, b, m1 } = world();
  const rows = everything(s, { lrNo: a.no });
  assert.ok(rows.length >= 9);
  assert.ok(rows.every((r) => r.lrNo === a.no), 'only LR a');
  assert.ok(rows.some((r) => r.kind === 'wasuli') && rows.some((r) => r.action === 'lrs.update') && rows.some((r) => r.action === 'lrs.create'));
  assert.equal(rows.some((r) => r.kind === 'print'), false);
  assert.ok(everything(s, { lrNo: a.no, showPrints: true }).some((r) => r.action === 'print.lr'));
  assert.deepEqual(everything(s, { lrNo: a.no, lrYear: 2026 }), rows);
  assert.deepEqual(everything(s, { lrNo: a.no, lrYear: 2025 }), [], 'no LR of that number in that year');
  assert.deepEqual(everything(s, { lrNo: 9999 }), []);
  assert.deepEqual(everything(s, { lrNo: b.no, kind: 'wasuli' }), [], 'b has no collection');
  assert.ok(everything(s, { lrNo: b.no }).some((r) => r.action === 'lrs.memo-move'));

  const memo = everything(s, { challanNo: m1.challanNo });
  assert.ok(memo.length >= 5 && memo.every((r) => r.challanNo === m1.challanNo && r.record === 'memo'));
  assert.deepEqual(everything(s, { challanNo: m1.challanNo, challanYear: 2025 }), []);
  assert.deepEqual(everything(s, { challanNo: 9999 }), []);
});

test('the period: whole local days, both included, in the stored time', () => {
  const s = setUp();
  const at = (day: string, h: number, mi: number, sec = 0) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, mi, sec, 500).toISOString();
  raw(s, at('2026-10-29', 23, 59, 59));
  raw(s, at('2026-10-30', 0, 0, 0));
  raw(s, at('2026-10-30', 12, 0));
  raw(s, at('2026-11-01', 23, 59, 59));
  raw(s, at('2026-11-02', 0, 0, 0));
  const days = (from: string, to: string) => everything(s, { from, to, kind: 'settings' }).map((r) => r.at);
  assert.equal(days('2026-10-30', '2026-11-01').length, 3, 'first moment of the first day to the last second of the last');
  assert.equal(days('2026-10-30', '2026-10-30').length, 2);
  assert.equal(days('2026-11-02', '2026-11-02').length, 1);
  assert.equal(days('2026-10-01', '2026-10-29').length, 1);
  assert.deepEqual(days('2026-10-30', '2026-11-01'), [...days('2026-10-30', '2026-11-01')].sort().reverse(), 'newest first');
  const { fromAt, toAt } = utcBounds('2026-10-30', '2026-11-01');
  assert.ok(fromAt < toAt);
});

test('paging: 100, 101 and 250 rows come in pages of 100, none twice, none lost, newest first, ties by id', () => {
  for (const n of [0, 1, 100, 101, 250]) {
    const s = setUp();
    const base = Date.UTC(2026, 9, 15, 8, 0, 0);
    s.db.transaction(() => {
      // Three rows to every second: the order inside a second is the id's.
      for (let i = 0; i < n; i++) raw(s, new Date(base + Math.floor(i / 3) * 1000).toISOString(), { action: 'settings.company', entityId: 'company' });
    })();
    const f = { from: '2026-10-14', to: '2026-10-16', kind: 'settings' as const, seat: 'PC09' };
    const sizes: number[] = [];
    const ids: number[] = [];
    let cursor: HistoryCursor | null = null;
    do {
      const page: { rows: HistoryRow[]; next: HistoryCursor | null } = got(history.list(s.db, { ...ALL, ...f }, cursor));
      sizes.push(page.rows.length);
      ids.push(...page.rows.map((r) => r.id));
      assert.equal(page.next !== null, page.rows.length === 100 && ids.length < n, `${n}: a next page only when there is more`);
      cursor = page.next;
    } while (cursor);
    assert.equal(ids.length, n);
    assert.equal(new Set(ids).size, n, 'none twice');
    assert.deepEqual(ids, [...ids].sort((x, y) => y - x), 'the newest first: later rows have the higher id');
    assert.deepEqual(sizes, n === 0 ? [0] : n <= 100 ? [n] : n === 101 ? [100, 1] : [100, 100, 50]);
  }
});

test('an unknown action, an unreadable row and a row of a table that is gone are listed, never a broken page', () => {
  const { s } = world();
  raw(s, new Date().toISOString(), { action: 'future.thing', entity: 'gadgets', entityId: '7', before: '{"a":1}', after: 'not json' });
  raw(s, new Date().toISOString(), { action: 'lrs.update', entity: 'lrs', entityId: '99999', before: '[1,2]', after: '{"qty":5}' });
  raw(s, new Date().toISOString(), { action: 'wasuli.collect', entity: 'wasuli', entityId: '99999', before: null, after: null });
  raw(s, new Date().toISOString(), { action: 'masters.update', entity: 'planets', entityId: '1', before: null, after: null });
  const rows = everything(s);
  const unknown = rows.find((r) => r.action === 'future.thing');
  assert.deepEqual([unknown?.kind, unknown?.verb, unknown?.record, unknown?.changes, unknown?.facts], ['other', 'other', null, [], {}]);
  assert.equal(rows.find((r) => r.action === 'masters.update' && r.record === null)?.kind, 'other');
  const orphan = rows.find((r) => r.action === 'lrs.update' && r.openId === 99999);
  assert.deepEqual([orphan?.lrNo, orphan?.changes], [null, [{ field: 'qty', from: null, to: 5 }]], 'an LR that is not there has no number; the unreadable side is nothing');
  assert.equal(rows.find((r) => r.action === 'wasuli.collect' && r.id > 0 && r.lrNo === null)?.record, null, 'no LR to open');
  assert.equal(everything(s, { kind: 'lr' }).some((r) => r.action === 'future.thing'), false, 'an unknown action is never matched by a kind');
});

// ---- plans and speed ----

const plan = (s: Pick<Set, 'db'>, f: Partial<HistoryFilters>, scope = { lrId: null as number | null, memoId: null as number | null }, cursor: HistoryCursor | null = null) => {
  const q = pageSql({ ...ALL, from: '2026-10-30', to: '2026-11-06', ...f }, scope, cursor);
  return (s.db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.args) as { detail: string }[]).map((r) => r.detail);
};
const noScan = (lines: string[], what: string) => assert.ok(!lines.some((l) => /^SCAN (a|audit_log)\b/.test(l)), `${what}: ${lines.join(' | ')}`);

test('EXPLAIN: no page of the History ever scans the audit log (the default week, a seat, a kind, an LR, a challan, after a cursor)', () => {
  const { s } = world();
  const cursor = { at: '2026-11-05T10:00:00.000Z', id: 50 };
  noScan(plan(s, {}), 'the default week');
  noScan(plan(s, {}, undefined, cursor), 'after a cursor');
  noScan(plan(s, { seat: 'pc02' }), 'a seat');
  noScan(plan(s, { kind: 'lr', verb: 'edited' }), 'a kind and a verb');
  noScan(plan(s, { verb: 'edited' }), 'a verb');
  noScan(plan(s, { showPrints: true }), 'prints shown');
  noScan(plan(s, {}, { lrId: 1, memoId: null }), 'an LR');
  noScan(plan(s, {}, { lrId: null, memoId: 1 }), 'a challan');
  assert.ok(plan(s, {}).some((l) => /audit_by_at/.test(l)), plan(s, {}).join(' | '));
});

test('speed: the first page of the default week out of 200,000 audit rows is under 100 ms', () => {
  const { s } = world();
  const insert = s.db.prepare('INSERT INTO audit_log (at, seat, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const end = Date.now();
  const kinds: [string, string][] = [['lrs.update', 'lrs'], ['wasuli.collect', 'wasuli'], ['memos.edit', 'memos'], ['pins.change-admin', 'settings']];
  s.db.transaction(() => {
    for (let i = 0; i < 200000; i++) {
      const [action, entity] = kinds[i % 4];
      insert.run(new Date(end - (200000 - i) * 39000).toISOString(), `PC0${i % 5}`, action, entity, entity === 'settings' ? 'pins' : String(1 + (Math.floor(i / 4) % 5000)), '{"qty":1}', '{"qty":2}');
    }
  })();
  const f = { ...ALL, from: new Date(end - 6 * 86400000).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) };
  const first = got(history.list(s.db, f, null));
  assert.equal(first.rows.length, 100);
  assert.ok(first.next);
  const ms = fastest(5, () => void history.list(s.db, f, null));
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
  const seatMs = fastest(5, () => void history.list(s.db, { ...f, seat: 'pc03', kind: 'lr' }, null));
  assert.ok(seatMs < 100, `${seatMs.toFixed(1)} ms with a seat and a kind`);
  const lrMs = fastest(5, () => void history.list(s.db, { ...f, from: '2000-01-01', lrNo: 1 }, null));
  assert.ok(lrMs < 100, `${lrMs.toFixed(1)} ms for an LR number over everything`);
});

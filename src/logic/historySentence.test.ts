import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_ACTIONS, type HistoryRow } from '../../shared';
import { strings } from '../strings';
import { changeLine, changeValue, jumpOf, openLabel, sentence } from './historySentence';

const t = strings.history;
const row = (action: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  id: 1, at: '2026-11-06T09:12:33.456Z', seat: 'PC03', action, kind: 'other', verb: 'other', record: null, openId: null,
  lrNo: null, lrYear: null, challanNo: null, challanYear: null, name: null, changes: [], facts: {}, ...over,
});
const lr = { record: 'lr', openId: 5, lrNo: 1248, lrYear: 2026 } as const;
const memo = { record: 'memo', openId: 3, challanNo: 13, challanYear: 2026 } as const;
const wasuli = { record: 'wasuli', openId: 9, lrNo: 77, lrYear: 2026 } as const;

// One sentence for every action the keeper writes, as a person reads it.
const SAID: [string, Partial<HistoryRow>, string][] = [
  ['lrs.create', { ...lr, facts: { consignor: 'Shree Ganesh', consignee: 'Patil', station: 'Nagpur', qty: 3 } }, 'LR 1248 booked: Shree Ganesh → Patil, to Nagpur'],
  ['lrs.update', lr, 'LR 1248 edited'],
  ['lrs.cancel', { ...lr, facts: { reason: 'duplicate' } }, 'LR 1248 cancelled — duplicate'],
  ['lrs.restore', lr, 'LR 1248 restored'],
  ['lrs.memo-remove', { ...lr, facts: { challanNo: 13 } }, 'LR 1248 taken off challan 13'],
  ['lrs.memo-move', { ...lr, facts: { challanNo: 13, otherChallanNo: 14 } }, 'LR 1248 moved from challan 13 to challan 14'],
  ['lrs.memo-add', { ...lr, facts: { challanNo: 13 } }, 'LR 1248 added to challan 13'],
  ['lrs.memo-cancel', { ...lr, facts: { challanNo: 13 } }, 'LR 1248 back to booked: challan 13 was cancelled'],
  ['memos.create', { ...memo, facts: { lrCount: 12, truck: 'MH 29 AB 1', fromStation: 'Yavatmal', toStation: 'Nagpur' } }, 'Challan 13 made: 12 LRs, truck MH 29 AB 1, Yavatmal → Nagpur'],
  ['memos.edit', memo, 'Challan 13 edited'],
  ['memos.remove-lrs', { ...memo, facts: { lrNos: [245] } }, 'Challan 13: LR 245 taken off'],
  ['memos.add-lrs', { ...memo, facts: { lrNos: [245, 246] } }, 'Challan 13: LR 245, 246 added'],
  ['memos.move-out', { ...memo, facts: { lrNos: [245], otherChallanNo: 14 } }, 'Challan 13: LR 245 moved to challan 14'],
  ['memos.move-in', { ...memo, facts: { lrNos: [245], otherChallanNo: 14 } }, 'Challan 13: LR 245 moved in from challan 14'],
  ['memos.recalculate', memo, 'Challan 13 totals recalculated'],
  ['memos.cancel', { ...memo, facts: { reason: 'wrong truck' } }, 'Challan 13 cancelled — wrong truck'],
  ['wasuli.create', { ...wasuli, facts: { amountPaise: 50000 } }, 'Wasuli LR 77: ₹500 to collect'],
  ['wasuli.update', wasuli, 'Wasuli LR 77: amount changed'],
  ['wasuli.remove', { ...wasuli, facts: { amountPaise: 40000 } }, 'Wasuli LR 77 removed (₹400)'],
  ['wasuli.assign', { ...wasuli, facts: { agent: 'Ramesh' } }, 'Wasuli LR 77 assigned to Ramesh'],
  ['wasuli.reassign', { ...wasuli, facts: { fromAgent: 'Ramesh', agent: 'Suresh' } }, 'Wasuli LR 77 moved from Ramesh to Suresh'],
  ['wasuli.to-pool', { ...wasuli, facts: { fromAgent: 'Ramesh' } }, 'Wasuli LR 77 taken back from Ramesh'],
  ['wasuli.collect', { ...wasuli, facts: { agent: 'Ramesh', amountPaise: 50000, owedPaise: 50000, mode: 'cash' } }, 'Wasuli LR 77 collected ₹500 cash by Ramesh'],
  ['wasuli.collect', { ...wasuli, facts: { agent: 'Ramesh', amountPaise: 30000, owedPaise: 50000, mode: 'upi' } }, 'Wasuli LR 77 collected ₹300 UPI by Ramesh (part of ₹500)'],
  ['wasuli.uncollect', { ...wasuli, facts: { agent: 'Ramesh', amountPaise: 50000 } }, 'Wasuli LR 77 collection undone (₹500, Ramesh)'],
  ['wasuli.remark', wasuli, 'Wasuli LR 77 remark edited'],
  ['masters.create', { record: 'firm', name: 'Shree Ganesh' }, 'Firm Shree Ganesh added'],
  ['masters.update', { record: 'station', name: 'Nagpur City' }, 'Station Nagpur City edited'],
  ['masters.activate', { record: 'truck', name: 'MH 29 AB 1' }, 'Truck MH 29 AB 1 reactivated'],
  ['masters.deactivate', { record: 'agent', name: 'Suresh' }, 'Agent Suresh deactivated'],
  ['pins.setup', {}, 'Admin and System PIN set up'],
  ['pins.change-system', {}, 'System PIN changed'],
  ['pins.change-admin', {}, 'Admin PIN changed'],
  ['pins.recover', {}, 'PINs reset with the recovery code'],
  ['pins.locked', { facts: { pin: 'system' } }, 'System PIN locked after 5 wrong tries'],
  ['pins.locked', { facts: { pin: 'recovery' } }, 'Recovery code locked after 5 wrong tries'],
  ['settings.lr-defaults', {}, 'LR defaults changed'],
  ['settings.company', {}, 'Company lines on printouts changed'],
  ['settings.backup-dir', { changes: [{ field: 'backupDir', from: 'D:\\BookingManagerBackups', to: 'E:\\BM' }] }, 'Backup folder changed to E:\\BM'],
  ['seat.rename', { changes: [{ field: 'seatName', from: 'PC02', to: 'Counter 2' }] }, 'Seat PC02 renamed Counter 2'],
  ['app.update', { changes: [{ field: 'version', from: '0.2.1', to: '0.3.0' }] }, 'Software update to 0.3.0 started (from 0.2.1)'],
  ['backup.restore', { facts: { file: 'booking-20261030-0900.db' } }, 'Database restored from backup booking-20261030-0900.db'],
  ['print.lr', { ...lr, facts: { how: 'pdf' } }, 'LR 1248 saved as PDF'],
  ['print.memo', { ...memo, facts: { how: 'print' } }, 'Challan 13 printed'],
  ['print.firm', { record: 'firm', name: 'Shree Ganesh', facts: { how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'both' } }, 'Statement of Shree Ganesh saved as PDF (01-10-2026 to 31-10-2026)'],
  ['print.report', { name: 'dateWise', facts: { how: 'print', report: 'dateWise', from: '2026-10-01', to: '2026-10-31' } }, 'Date-wise report printed (01-10-2026 to 31-10-2026)'],
];

test('one sentence for every action the keeper writes', () => {
  for (const [action, over, want] of SAID) assert.equal(sentence(row(action, over), t), want, action);
});

test('every action in the filters\' table has a sentence', () => {
  for (const key of Object.keys(HISTORY_ACTIONS)) {
    const action = key.split(':')[0];
    assert.equal(typeof t.say[action], 'function', `${action} has no sentence`);
  }
  const said = new Set(SAID.map(([a]) => a));
  for (const key of Object.keys(HISTORY_ACTIONS)) assert.ok(said.has(key.split(':')[0]), `${key} is not in the sentence test`);
});

test('an action nobody wrote a sentence for shows its raw code; a name from Object.prototype is not a sentence', () => {
  assert.equal(sentence(row('future.thing'), t), 'future.thing');
  assert.equal(sentence(row('constructor'), t), 'constructor');
  assert.equal(sentence(row('__proto__'), t), '__proto__');
});

test('what is missing from a row shows as a gap, not as "null" or "undefined"', () => {
  assert.equal(sentence(row('lrs.update'), t), 'An LR edited');
  assert.equal(sentence(row('memos.edit'), t), 'A challan edited');
  assert.equal(sentence(row('wasuli.assign'), t), 'Wasuli assigned to ?');
  assert.equal(sentence(row('memos.remove-lrs', memo), t), 'Challan 13: LRs taken off');
  for (const [action] of SAID) assert.doesNotMatch(sentence(row(action), t), /null|undefined|NaN/, action);
});

test('a long name stays in the sentence whole (the table cuts it, the details show it)', () => {
  const name = 'Shree Ganesh Traders and Brothers Transport Company Private Limited of Yavatmal';
  assert.equal(sentence(row('masters.update', { record: 'firm', name }), t), `Firm ${name} edited`);
});

test('a changed field in words: rupees, dates, percentages, a charge option\'s name, a dash for nothing', () => {
  assert.equal(changeLine({ field: 'toPay', from: 180000, to: 200000, unit: 'paise' }, t), 'To pay: ₹1,800 → ₹2,000');
  assert.equal(changeLine({ field: 'qty', from: 3, to: 5 }, t), 'Quantity: 3 → 5');
  assert.equal(changeLine({ field: 'toStation', from: 'Nagpur', to: 'Amravati' }, t), 'To: Nagpur → Amravati');
  assert.equal(changeLine({ field: 'date', from: '2026-10-25', to: '2026-10-26', unit: 'date' }, t), 'Date: 25-10-2026 → 26-10-2026');
  assert.equal(changeLine({ field: 'staxPercent', from: '0', to: '2.5', unit: 'percent' }, t), 'Service tax: 0% → 2.5%');
  assert.equal(changeLine({ field: 'chargeOption', from: 'blank', to: 'option2', unit: 'option' }, t), 'Charge option: Blank → Option 2');
  assert.equal(changeLine({ field: 'godownBhada', from: 0, to: 500, unit: 'paise' }, t), 'Godown bhada: ₹0 → ₹5');
  assert.equal(changeLine({ field: 'station', from: null, to: 'Yavatmal' }, t), 'Station: — → Yavatmal');
  assert.equal(changeLine({ field: 'remark', from: '', to: 'paid' }, t), 'Remark: — → paid');
  assert.equal(changeLine({ field: 'somethingNew', from: 1, to: 2 }, t), 'somethingNew: 1 → 2', 'a field without a label shows its code');
  assert.equal(changeValue({ field: 'x', from: 0, to: 5, unit: 'paise' }, 'from', t), '₹0');
});

test('where a row leads, and the button\'s words', () => {
  const cases: [Partial<HistoryRow>, unknown, string | null][] = [
    [{ ...lr }, { to: 'lr', id: 5 }, 'Open LR 1248'],
    [{ ...memo }, { to: 'memo', id: 3 }, 'Open challan 13'],
    [{ ...wasuli }, { to: 'wasuli', no: 77, year: 2026 }, 'Open the collection of LR 77'],
    [{ record: 'firm', openId: 2, name: 'Shree Ganesh' }, { to: 'account', id: 2 }, "Open Shree Ganesh's account"],
    [{ record: 'station', openId: 1, name: 'Yavatmal' }, { to: 'master', kind: 'stations', id: 1 }, 'Open station Yavatmal'],
    [{ record: 'truck', openId: 1, name: 'MH 29 AB 1' }, { to: 'master', kind: 'trucks', id: 1 }, 'Open truck MH 29 AB 1'],
    [{ record: 'driver', openId: 1, name: 'Ramesh' }, { to: 'master', kind: 'drivers', id: 1 }, 'Open driver Ramesh'],
    [{ record: 'agent', openId: 1, name: 'Suresh' }, { to: 'master', kind: 'agents', id: 1 }, 'Open agent Suresh'],
    [{}, null, null],
    [{ record: 'wasuli', openId: 9 }, null, null],
    [{ record: 'lr', openId: null }, null, null],
  ];
  for (const [over, jump, label] of cases) {
    const r = row('x', over);
    assert.deepEqual(jumpOf(r), jump, JSON.stringify(over));
    assert.equal(openLabel(r, t), label, JSON.stringify(over));
  }
});

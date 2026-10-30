import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LrInput } from '../shared';
import { asLrInput, changesOf, cleanLr, cleanReason, diffLr, isDate, localDate, parseNumbers } from './lrRules';

const good: LrInput = {
  uid: 'u1',
  date: null,
  fromStationId: 1,
  toStationId: 2,
  consignor: { firmId: 10, name: '', addToFirms: false },
  consignee: { firmId: null, name: '  Kale   Brothers ', addToFirms: false },
  particular: 'Cloth bales',
  qty: '12',
  toPay: '1,800',
  paid: '',
  chargeOption: 'option1',
  godownBhada: '5',
  godownInsurance: '5',
  deliveryCharges: '2',
  hamali: '120',
  wasuli: '',
  staxPercent: '5',
};
const today = '2026-10-29';
const with_ = (over: Partial<LrInput>): LrInput => ({ ...good, ...over });

test('cleanLr: a complete LR has no errors and the numbers are parsed', () => {
  const r = cleanLr(good, today);
  assert.deepEqual(r.errors, {});
  assert.equal(r.date, today);
  assert.equal(r.particular, 'Cloth bales');
  assert.equal(r.consignorName, null, 'a picked firm has no typed name');
  assert.equal(r.consigneeName, 'Kale Brothers', 'a walk-in name is trimmed and its spaces collapsed');
  assert.deepEqual(r.n, { qty: 12, toPay: 180000, paid: 0, godownBhada: 500, godownInsurance: 500, deliveryCharges: 200, hamali: 12000, wasuli: 0, staxBp: 500 });
});

test('cleanLr: consignor, consignee and particular are required', () => {
  const r = cleanLr(with_({ consignor: { firmId: null, name: '  ', addToFirms: false }, consignee: { firmId: null, name: '', addToFirms: true }, particular: ' ' }), today);
  assert.equal(r.errors.consignor, 'required');
  assert.equal(r.errors.consignee, 'required');
  assert.equal(r.errors.particular, 'required');
});

test('cleanLr: to station is required and must differ from the from station', () => {
  assert.equal(cleanLr(with_({ toStationId: null }), today).errors.toStation, 'required');
  assert.equal(cleanLr(with_({ fromStationId: null }), today).errors.fromStation, 'required');
  assert.equal(cleanLr(with_({ toStationId: 1 }), today).errors.toStation, 'same');
});

test('cleanLr: quantity is a whole number of at least 1', () => {
  assert.equal(cleanLr(with_({ qty: '' }), today).errors.qty, 'required');
  for (const bad of ['0', '-1', '1.5', 'abc', '12 ', '1e3', '1234567']) {
    const want = bad === '12 ' ? undefined : 'whole';
    assert.equal(cleanLr(with_({ qty: bad }), today).errors.qty, want, JSON.stringify(bad));
  }
});

test('cleanLr: to pay and paid are never both above zero; either alone is fine, zero and empty are zero', () => {
  assert.equal(cleanLr(with_({ toPay: '10', paid: '5' }), today).errors.paid, 'both');
  assert.deepEqual(cleanLr(with_({ toPay: '', paid: '5' }), today).errors, {});
  assert.deepEqual(cleanLr(with_({ toPay: '0', paid: '0' }), today).errors, {});
});

test('cleanLr: every money box and the tax box name themselves when malformed', () => {
  const r = cleanLr(with_({ toPay: 'x', paid: '1.234', godownBhada: '-1', godownInsurance: '1e2', deliveryCharges: '₹5', hamali: '1,2,3', wasuli: 'abc', staxPercent: '101' }), today);
  assert.deepEqual(r.errors, {
    toPay: 'amount', paid: 'amount', godownBhada: 'amount', godownInsurance: 'amount', deliveryCharges: 'amount', hamali: 'amount', wasuli: 'amount', staxPercent: 'percent',
  });
});

test('cleanLr: an absurdly large amount is refused by name, not left to blow up in the money maths', () => {
  assert.equal(cleanLr(with_({ toPay: '1,00,00,00,000' }), today).errors.toPay, undefined, 'Rs 100 crore is the limit');
  assert.equal(cleanLr(with_({ toPay: '100000000001' }), today).errors.toPay, 'amount');
  const r = cleanLr(with_({ hamali: '9999999999999999' }), today);
  assert.equal(r.errors.hamali, 'amount');
  assert.equal(r.n.hamali, 0, 'and it counts as 0 in a preview');
});

test('cleanLr: the date is today, a past date, but never a future or an impossible one', () => {
  assert.equal(cleanLr(with_({ date: '2026-10-28' }), today).date, '2026-10-28');
  assert.equal(cleanLr(with_({ date: today }), today).errors.date, undefined);
  assert.equal(cleanLr(with_({ date: '2026-10-30' }), today).errors.date, 'future');
  assert.equal(cleanLr(with_({ date: '2026-02-30' }), today).errors.date, 'date');
  assert.equal(cleanLr(with_({ date: '29-10-2026' }), today).errors.date, 'date');
});

test('parseNumbers: an empty form is all zeros and no errors (a preview can run on it)', () => {
  const { n, errors } = parseNumbers({ qty: '', toPay: '', paid: '', godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '', wasuli: '', staxPercent: '' });
  assert.deepEqual(errors, {});
  assert.ok(Object.values(n).every((v) => v === 0));
});

test('asLrInput: needs a uid; a wrongly typed value becomes an empty one that the rules then refuse by name', () => {
  assert.equal(asLrInput(null), null);
  assert.equal(asLrInput([]), null);
  assert.equal(asLrInput({ qty: '1' }), null);
  assert.equal(asLrInput({ uid: 'x'.repeat(65) }), null);
  assert.deepEqual(asLrInput(good), { ...good, systemPin: '', confirmSimilar: false });
  const odd = asLrInput({ uid: 'u', qty: 12, toPay: ['1'], fromStationId: '1', toStationId: 2.5, consignor: 'x', particular: { a: 1 } });
  assert.ok(odd);
  assert.equal(odd.qty, '');
  assert.equal(odd.toPay, '');
  assert.equal(odd.fromStationId, null);
  assert.equal(odd.toStationId, null);
  assert.deepEqual(odd.consignor, { firmId: null, name: '', addToFirms: false });
  const errors = cleanLr(odd, today).errors;
  assert.equal(errors.qty, 'required');
  assert.equal(errors.consignor, 'required');
  assert.equal(errors.particular, 'required');
  assert.equal(errors.fromStation, 'required');
});

test('cleanReason: trimmed, inner spaces collapsed, 1-200 characters', () => {
  assert.equal(cleanReason('  wrong   consignee '), 'wrong consignee');
  assert.equal(cleanReason(''), null);
  assert.equal(cleanReason('  \n '), null);
  assert.equal(cleanReason('x'.repeat(200)), 'x'.repeat(200));
  assert.equal(cleanReason('x'.repeat(201)), null);
  assert.equal(cleanReason(undefined), null);
  assert.equal(cleanReason(5), null);
});

test('diffLr: only the columns that differ, before and after', () => {
  const was = { lr_date: '2026-10-29', qty: 3, topay_paise: 180000, paid_paise: 0, consignee_name: 'Kale Brothers', consignee_id: null, status: 'booked' };
  const now = { ...was, topay_paise: 0, paid_paise: 180000, consignee_name: 'Patil Hardware', consignee_id: 7 };
  assert.deepEqual(diffLr(was, now), {
    before: { topay_paise: 180000, paid_paise: 0, consignee_name: 'Kale Brothers', consignee_id: null },
    after: { topay_paise: 0, paid_paise: 180000, consignee_name: 'Patil Hardware', consignee_id: 7 },
  });
  assert.equal(diffLr(was, { ...was }), null, 'nothing differs: nothing to write');
  assert.equal(diffLr(was, { ...was, status: 'cancelled' }), null, 'only the edit columns are compared');
});

test('changesOf: the audit pair as History lines, in form order; a firm that kept its name shows no line', () => {
  const lines = changesOf(
    { consignee_name: 'Kale Brothers', consignee_id: null, topay_paise: 180000, to_station_id: 2, lr_date: '2026-10-29' },
    { consignee_name: 'Patil Hardware', consignee_id: 7, topay_paise: 0, to_station_id: 3, lr_date: '2026-10-28' },
    (id) => ({ 2: 'Nagpur', 3: 'Pune' })[id as 2 | 3],
  );
  assert.deepEqual(lines, [
    { field: 'date', from: '2026-10-29', to: '2026-10-28' },
    { field: 'toStation', from: 'Nagpur', to: 'Pune' },
    { field: 'consignee', from: 'Kale Brothers', to: 'Patil Hardware' },
    { field: 'toPay', from: 180000, to: 0 },
  ]);
  assert.deepEqual(changesOf({ consignee_id: null, consignee_name: 'Patil' }, { consignee_id: 7, consignee_name: 'Patil' }, () => ''), []);
  assert.deepEqual(changesOf({ stax_bp: 500 }, { stax_bp: 250 }, () => ''), [{ field: 'staxPercent', from: '5', to: '2.5' }]);
});

test('localDate is the local calendar date, isDate rejects dates that roll over', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 3, 0)), '2026-01-05');
  assert.equal(localDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(isDate('2024-02-29'), true);
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2026-13-01'), false);
});

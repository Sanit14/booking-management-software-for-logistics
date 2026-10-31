import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LrDetail } from '../../shared';
import { applyDefaults } from './chargeFill';
import { formFromLr } from './lrOpen';

const lr: LrDetail = {
  id: 7, version: 3, status: 'booked', lrNo: 245, lrYear: 2026, date: '2026-10-29', memoNo: null, memoId: null,
  fromStationId: 1, toStationId: 2, consignorId: 10, consignor: 'Shree Ganesh Traders', consigneeId: null, consignee: 'Kale Brothers',
  particular: 'Cloth bales', qty: 12, toPayPaise: 180000, paidPaise: 0, chargeOption: 'option1',
  godownBhadaPaise: 500, godownInsurancePaise: 250, deliveryChargesPaise: 0, hamaliPaise: 12010, wasuliPaise: 0, staxPercent: '2.5',
  amounts: { freight: 180000, charges: 12760, stax: 4500, total: 197260 },
};
const name = (id: number) => ({ 1: 'Yavatmal', 2: 'Nagpur' })[id as 1 | 2] ?? '';

test('formFromLr: every box shows what was saved, money as the text a clerk would type', () => {
  const f = formFromLr(lr, name);
  assert.deepEqual(f.from, { text: 'Yavatmal', id: 1 });
  assert.deepEqual(f.to, { text: 'Nagpur', id: 2 });
  assert.deepEqual(f.consignor, { text: 'Shree Ganesh Traders', firmId: 10, add: false });
  assert.deepEqual(f.consignee, { text: 'Kale Brothers', firmId: null, add: false }, 'a walk-in stays a walk-in');
  assert.equal(f.particular, 'Cloth bales');
  assert.equal(f.qty, '12');
  assert.equal(f.toPay, '1800');
  assert.equal(f.paid, '', 'zero is an empty box');
  assert.equal(f.option, 'option1');
  assert.deepEqual(f.charges, { godownBhada: '5', godownInsurance: '2.5', deliveryCharges: '', hamali: '120.1' });
  assert.equal(f.wasuli, '');
  assert.equal(f.stax, '2.5');
});

test('formFromLr: all four charge boxes belong to the clerk, so the charge option cannot overwrite a saved amount or a saved 0', () => {
  const f = formFromLr(lr, name);
  assert.deepEqual([...f.manual].sort(), ['deliveryCharges', 'godownBhada', 'godownInsurance', 'hamali']);
  // The first preview of an opened LR brings the option's amounts: none of them lands.
  const same = applyDefaults(f.charges, f.manual, { godownBhada: 999, godownInsurance: 999, deliveryCharges: 999, hamali: 999 });
  assert.deepEqual(same, f.charges);
});

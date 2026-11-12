import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoSettlement, SettlementPreview } from '../../shared';
import { blankLines, percentText, previewReady, roundText, saveKeyWanted, settlementLines, settlementRefusal, windowErrors } from './memoDetails';

// The old paper's example, as the keeper sends it.
const PAPER: MemoSettlement = {
  articles: 177, paidPaise: 22000, toPayPaise: 695300, wasuliPaise: 407600, ratePaise: 40, commissionBp: 1000,
  commissionBasePaise: 717300, hamaliLessPaise: 7080, total1Paise: 688220, commissionLessPaise: 71730, total2Paise: 616490, netPaise: 1024090, roundRupees: 10241,
};
const TOTALS = { lrs: 23, qty: 177, toPayPaise: 695300, paidPaise: 22000, wasuliPaise: 407600 };
const answer = (rate: string, commission: string, over: Partial<SettlementPreview> = {}) => ({
  rate, commission, preview: { totals: TOTALS, errors: {}, settlement: PAPER, ...over } as SettlementPreview,
});

test('settlementLines: the steps of the old paper, in its order, with how hamali and commission were worked out', () => {
  assert.deepEqual(settlementLines(PAPER).map((l) => [l.label, l.how, l.value]), [
    ['To pay', null, '6,953.00'],
    ['− Hamali less', '177 × 0.40', '70.80'],
    ['Total', null, '6,882.20'],
    ['− Commission less', '10 %', '717.30'],
    ['Total', null, '6,164.90'],
    ['+ Wasuli', null, '4,076.00'],
    ['Net amount', null, '10,240.90'],
  ]);
  assert.equal(roundText(PAPER), '10,241');
});

test('settlementLines: a negative total or net shows its minus sign, and so does the round figure', () => {
  const negative: MemoSettlement = { ...PAPER, total1Paise: -1000, total2Paise: -1000, netPaise: -1000, roundRupees: -10, hamaliLessPaise: 2000, toPayPaise: 1000 };
  const lines = settlementLines(negative);
  assert.deepEqual([lines[2].value, lines[4].value, lines[6].value], ['-10.00', '-10.00', '-10.00']);
  assert.equal(roundText(negative), '-10');
  assert.equal(roundText({ ...PAPER, roundRupees: 0 }), '0');
  assert.equal(roundText({ ...PAPER, roundRupees: -1234567 }), '-12,34,567');
});

test('percentText: the % as typed, no trailing zeros (the keeper has the same rule for paper and History)', () => {
  assert.deepEqual([1000, 825, 850, 5, 0, 10000].map(percentText), ['10', '8.25', '8.5', '0.05', '0', '100']);
});

test('previewReady: only an answer for exactly what is typed now, with no errors and a settlement, lets a memo be saved', () => {
  assert.equal(previewReady(answer('0.40', '10'), '0.40', '10'), true);
  assert.equal(previewReady(null, '0.40', '10'), false, 'nothing came back yet');
  assert.equal(previewReady(answer('0.4', '10'), '0.40', '10'), false, 'the answer is for an older text');
  assert.equal(previewReady(answer('0.40', '1'), '0.40', '10'), false);
  assert.equal(previewReady(answer('0.40', '10', { errors: { commission: 'percent' }, settlement: null }), '0.40', '10'), false);
  assert.equal(previewReady(answer('0.40', '10', { settlement: null }), '0.40', '10'), false);
});

test('windowErrors: a wrong value is told at once, an empty box only after the clerk tried to save; an old answer says nothing', () => {
  const empty = answer('', '', { errors: { hamaliRate: 'required', commission: 'required' }, settlement: null });
  assert.deepEqual(windowErrors(empty, '', '', false), {}, 'a box not touched yet is not an error');
  assert.deepEqual(windowErrors(empty, '', '', true), { hamaliRate: 'Type the hamali rate (0 is allowed)', commission: 'Type the commission % (0 is allowed)' });
  const wrong = answer('0.405', '101', { errors: { hamaliRate: 'amount', commission: 'percent' }, settlement: null });
  assert.deepEqual(windowErrors(wrong, '0.405', '101', false), { hamaliRate: 'Type a smaller amount with at most 2 decimals, like 0.40', commission: 'At most 100 %' });
  assert.deepEqual(windowErrors(wrong, '0.4', '10', true), {}, 'the answer is for other text: no error is shown for what is typed now');
  assert.deepEqual(windowErrors(null, 'x', 'y', true), {});
  assert.deepEqual(windowErrors(answer('0.40', '10'), '0.40', '10', true), {});
});

test('saveKeyWanted: the save key tries once per press, only from this window and not while a save is on its way', () => {
  const press = { isSaveKey: true, repeat: false, topmost: true, saving: false };
  assert.equal(saveKeyWanted(press), true);
  assert.equal(saveKeyWanted({ ...press, repeat: true }), false, 'a held key does not save twice');
  assert.equal(saveKeyWanted({ ...press, saving: true }), false, 'one save in flight');
  assert.equal(saveKeyWanted({ ...press, topmost: false }), false, 'a PIN or another dialog is in front');
  assert.equal(saveKeyWanted({ ...press, isSaveKey: false }), false);
});

test('settlementRefusal: the words for a refused rate (first) or commission', () => {
  assert.equal(settlementRefusal({ hamaliRate: 'amount' }), 'Type a smaller amount with at most 2 decimals, like 0.40');
  assert.equal(settlementRefusal({ commission: 'percent' }), 'At most 100 %');
  assert.equal(settlementRefusal({ hamaliRate: 'required', commission: 'percent' }), 'Type the hamali rate (0 is allowed)');
  assert.equal(settlementRefusal(undefined), 'Type a number with at most 2 decimals, like 10 or 8.25');
});

test('blankLines: before the figures come, To pay and Wasuli are known and every step is a dash', () => {
  assert.deepEqual(blankLines(TOTALS).map((l) => [l.label, l.value]), [
    ['To pay', '6,953.00'], ['− Hamali less', '—'], ['Total', '—'], ['− Commission less', '—'], ['Total', '—'], ['+ Wasuli', '4,076.00'], ['Net amount', '—'],
  ]);
});

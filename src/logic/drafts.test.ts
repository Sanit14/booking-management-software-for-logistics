import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearDraft, hasTyped, keepDraft, loadDraft } from './drafts';
import type { LrFormState } from './lrOpen';

const blank = (): LrFormState => ({
  from: { text: 'Yavatmal', id: 1 },
  to: { text: '', id: null },
  consignor: { text: '', firmId: null, add: false },
  consignee: { text: '', firmId: null, add: false },
  particular: '',
  qty: '',
  toPay: '',
  paid: '',
  option: 'blank',
  charges: { godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '' },
  manual: new Set(),
  wasuli: '',
  stax: '0',
});
const typed = (over: Partial<LrFormState>): LrFormState => ({ ...blank(), ...over });

// Node 16 has no beforeEach: every test that keeps a draft starts with reset().
const reset = () => {
  clearDraft('lrEntry');
  clearDraft('quick');
};

test('only what the clerk typed makes a draft: From station, the option and the tax % alone do not', () => {
  assert.equal(hasTyped(blank()), false);
  assert.equal(hasTyped(typed({ from: { text: 'Pune', id: 2 }, stax: '5', option: 'option1' })), false);
  assert.equal(hasTyped(typed({ qty: '3' })), true);
  assert.equal(hasTyped(typed({ consignee: { text: 'Patil', firmId: null, add: false } })), true);
  assert.equal(hasTyped(typed({ particular: '   ' })), false);
});

test('a typed form is kept and comes back as it was, with its uid', () => {
  reset();
  const state = typed({ qty: '3', particular: 'Rice' });
  keepDraft('lrEntry', { state, uid: 'u-1' });
  assert.deepEqual(loadDraft('lrEntry'), { state, uid: 'u-1' });
});

test('a form emptied again removes its draft', () => {
  reset();
  keepDraft('lrEntry', { state: typed({ qty: '3' }), uid: 'u-1' });
  keepDraft('lrEntry', { state: blank(), uid: 'u-1' });
  assert.equal(loadDraft('lrEntry'), undefined);
});

test('clearing (an LR saved, or New LR pressed) removes the draft', () => {
  reset();
  keepDraft('quick', { state: typed({ qty: '3' }), uid: 'u-2' });
  clearDraft('quick');
  assert.equal(loadDraft('quick'), undefined);
});

test('LR Entry and Quick LR keep separate drafts', () => {
  reset();
  keepDraft('lrEntry', { state: typed({ qty: '3' }), uid: 'a' });
  keepDraft('quick', { state: typed({ qty: '9' }), uid: 'b' });
  clearDraft('lrEntry');
  assert.equal(loadDraft('quick')?.state.qty, '9');
  assert.equal(loadDraft('lrEntry'), undefined);
});

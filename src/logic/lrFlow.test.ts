import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LR_ENTER_ORDER, LR_SKIPPED } from './lrFlow';
import { nextIndex, type FieldInfo } from './nextField';

test('Enter walks the LR form in the card\'s order, past the date and From station, and ends on the last field', () => {
  const ids: string[] = [...LR_SKIPPED, ...LR_ENTER_ORDER];
  const fields: FieldInfo[] = ids.map((id) => ({ disabled: false, readOnly: false, hidden: false, tabIndex: 0, skipEnter: (LR_SKIPPED as readonly string[]).includes(id) }));

  const visited: string[] = [];
  for (let at = nextIndex(fields, -1); at !== null; at = nextIndex(fields, at)) visited.push(ids[at]);
  assert.deepEqual(visited, [
    'consignor', 'consignee', 'toStation', 'particular', 'qty', 'toPay', 'paid', 'chargeOption',
    'godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali', 'wasuli', 'staxPercent',
  ]);
  assert.equal(nextIndex(fields, ids.indexOf('staxPercent')), null, 'Enter on the last field saves');
});

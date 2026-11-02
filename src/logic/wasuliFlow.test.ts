import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WasuliRow } from '../../shared';
import { agentChoice, quickOutcome, seenOf } from './wasuliFlow';

const row = (over: Partial<WasuliRow> = {}): WasuliRow => ({
  id: 4, version: 3, status: 'assigned', lrId: 9, lrNo: 12, lrYear: 2026, lrDate: '2026-10-24', consignor: 'A', consignee: 'B', toStation: 'Nagpur', challanNo: null,
  amountPaise: 50000, agentId: 2, agent: 'Ramesh', assignedDate: '2026-10-30', collectedDate: null, collectedPaise: null, mode: null, remark: '', seat: 'PC01', days: 1, ...over,
});

test('seenOf is the four things the keeper compares, nothing more', () => {
  assert.deepEqual(seenOf(row()), { id: 4, status: 'assigned', agentId: 2, version: 3 });
  assert.deepEqual(Object.keys(seenOf(row({ status: 'unassigned', agentId: null, agent: null }))).sort(), ['agentId', 'id', 'status', 'version']);
});

test('a typed LR number opens the collect dialog only for a row assigned to the agent picked', () => {
  assert.equal(quickOutcome(row(), 2), 'collect');
  assert.equal(quickOutcome(row(), 3), 'otherAgent');
  assert.equal(quickOutcome(row(), null), 'otherAgent');
  assert.equal(quickOutcome(row({ status: 'unassigned', agentId: null }), 2), 'unassigned');
  assert.equal(quickOutcome(row({ status: 'collected' }), 2), 'collected');
  assert.equal(quickOutcome(row({ status: 'collected' }), 3), 'collected', 'already collected wins over whose it was');
});

test('the agent shown: the first active one until the clerk touches the box, then what was picked or typed in full', () => {
  const agents = [{ id: 1, name: 'Anil Kale' }, { id: 2, name: 'Ramesh Pawar' }];
  assert.deepEqual(agentChoice(null, agents), agents[0]);
  assert.equal(agentChoice(null, []), null);
  assert.deepEqual(agentChoice({ text: 'Ramesh Pawar', id: 2 }, agents), agents[1]);
  assert.deepEqual(agentChoice({ text: ' ramesh  pawar ', id: null }, agents), agents[1]);
  assert.equal(agentChoice({ text: 'ram', id: null }, agents), null, 'half a name is not an agent');
  assert.equal(agentChoice({ text: '', id: null }, agents), null, 'a cleared box means no agent, not the first');
  assert.equal(agentChoice({ text: 'Gone', id: 9 }, agents), null, 'an agent that is no longer active');
});

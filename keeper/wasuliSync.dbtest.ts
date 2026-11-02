// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// An LR save, edit, cancel or restore keeps its wasuli row in step, in the same transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LrInput } from '../shared';
import { book, lrInput, SYSTEM, setUp, type Set } from './memoTesting';

const row = (s: Set, lrId: number) => s.db.prepare('SELECT * FROM wasuli WHERE lr_id = ?').get(lrId) as Record<string, unknown> | undefined;
const count = (s: Set) => (s.db.prepare('SELECT COUNT(*) AS n FROM wasuli').get() as { n: number }).n;
const audits = (s: Set) =>
  s.db.prepare("SELECT action, seat, before_json AS before, after_json AS after FROM audit_log WHERE entity = 'wasuli' ORDER BY id").all() as { action: string; seat: string; before: string | null; after: string | null }[];
const lrRow = (s: Set, id: number) => s.db.prepare('SELECT version, wasuli_paise AS wasuli, status FROM lrs WHERE id = ?').get(id) as { version: number; wasuli: number; status: string };

/** Edit the LR with the same boxes it was booked with, `over` changed. */
const edit = (s: Set, id: number, over: Partial<LrInput>, seat = 'seat-2') => {
  const { version } = lrRow(s, id);
  return s.lrs.update(s.db, seat, id, version, lrInput(s, over), SYSTEM);
};
const cancel = (s: Set, id: number) => s.lrs.cancel(s.db, 'seat-2', id, lrRow(s, id).version, 'wrong goods', SYSTEM);
const restore = (s: Set, id: number) => s.lrs.restore(s.db, 'seat-2', id, lrRow(s, id).version, SYSTEM);

function agent(s: Set, name = 'Ramesh'): number {
  return s.made(s.masters.create(s.db, 'seat-1', 'agents', { name })).id;
}
const assignRow = (s: Set, lrId: number, agentId: number) =>
  s.db.prepare("UPDATE wasuli SET status = 'assigned', agent_id = ?, assigned_date = '2026-10-30' WHERE lr_id = ?").run(agentId, lrId);
const collectRow = (s: Set, lrId: number, agentId: number) =>
  s.db
    .prepare("UPDATE wasuli SET status = 'collected', agent_id = ?, assigned_date = '2026-10-30', collected_date = '2026-10-31', collected_paise = amount_paise, mode = 'cash' WHERE lr_id = ?")
    .run(agentId, lrId);

test('a saved LR with a wasuli amount makes one unassigned row; without an amount, none', () => {
  const s = setUp();
  const a = book(s, { wasuli: '1,250.50' });
  const b = book(s, { wasuli: '' });
  const c = book(s, { wasuli: '0' });
  assert.equal(count(s), 1);
  assert.equal(row(s, b.id), undefined);
  assert.equal(row(s, c.id), undefined);
  const w = row(s, a.id) as Record<string, unknown>;
  assert.deepEqual([w.amount_paise, w.status, w.agent_id, w.assigned_date, w.collected_date, w.seat, w.version], [125050, 'unassigned', null, null, null, 'seat-1', 1]);
  const [created] = audits(s);
  assert.deepEqual([created.action, created.seat, created.before], ['wasuli.create', 'seat-1', null]);
  assert.equal(JSON.parse(created.after ?? '').amount_paise, 125050);
});

test('the same save sent twice makes one row; a refused save makes none', () => {
  const s = setUp();
  const input = lrInput(s, { wasuli: '500' });
  assert.ok(s.lrs.create(s.db, 'seat-1', input).ok);
  const again = s.lrs.create(s.db, 'seat-1', input);
  assert.ok(again.ok && again.value.again && !again.value.wasuli);
  assert.equal(count(s), 1);
  assert.equal(s.lrs.create(s.db, 'seat-1', lrInput(s, { wasuli: '500', qty: '' })).ok, false);
  assert.equal(count(s), 1);
});

test('editing the amount follows: up, down, to nothing, and back from nothing', () => {
  const s = setUp();
  const lr = book(s, { wasuli: '500' });
  const up = edit(s, lr.id, { wasuli: '700' });
  assert.ok(up.ok && up.value.wasuli);
  assert.equal(row(s, lr.id)?.amount_paise, 70000);
  assert.equal(row(s, lr.id)?.version, 2);

  const down = edit(s, lr.id, { wasuli: '0.50' });
  assert.ok(down.ok && down.value.wasuli);
  assert.equal(row(s, lr.id)?.amount_paise, 50);

  const gone = edit(s, lr.id, { wasuli: '' });
  assert.ok(gone.ok && gone.value.wasuli);
  assert.equal(row(s, lr.id), undefined);

  const back = edit(s, lr.id, { wasuli: '300' });
  assert.ok(back.ok && back.value.wasuli);
  const w = row(s, lr.id) as Record<string, unknown>;
  assert.deepEqual([w.amount_paise, w.status, w.seat], [30000, 'unassigned', 'seat-2']);
  assert.deepEqual(audits(s).map((a) => a.action), ['wasuli.create', 'wasuli.update', 'wasuli.update', 'wasuli.remove', 'wasuli.create']);
  const removed = audits(s)[3];
  assert.equal(JSON.parse(removed.before ?? '').amount_paise, 50, 'the audit row keeps the row that was removed');
  assert.equal(removed.after, null);
});

test('an assigned row keeps its agent when the amount changes; an edit of anything else leaves the row and its audit alone', () => {
  const s = setUp();
  const lr = book(s, { wasuli: '500' });
  const ramesh = agent(s);
  assignRow(s, lr.id, ramesh);
  const rowVersion = row(s, lr.id)?.version;

  const other = edit(s, lr.id, { wasuli: '500', particular: 'Steel pipes' });
  assert.ok(other.ok && other.value.changed && !other.value.wasuli, 'the LR changed, the wasuli did not');
  assert.equal(row(s, lr.id)?.version, rowVersion);
  assert.equal(audits(s).length, 1, 'only the create');

  const amount = edit(s, lr.id, { wasuli: '650', particular: 'Steel pipes' });
  assert.ok(amount.ok && amount.value.wasuli);
  const w = row(s, lr.id) as Record<string, unknown>;
  assert.deepEqual([w.amount_paise, w.status, w.agent_id, w.assigned_date], [65000, 'assigned', ramesh, '2026-10-30']);

  const nothing = edit(s, lr.id, { wasuli: '650', particular: 'Steel pipes' });
  assert.ok(nothing.ok && !nothing.value.changed && !nothing.value.wasuli, 'an edit that changes nothing writes nothing');
});

test('a collected row blocks an edit that changes its amount, and writes nothing', () => {
  const s = setUp();
  const lr = book(s, { wasuli: '500' });
  collectRow(s, lr.id, agent(s));
  const auditBefore = audits(s).length;
  const lrBefore = lrRow(s, lr.id);
  const wasuliBefore = JSON.stringify(row(s, lr.id));

  for (const wasuli of ['600', '', '0']) {
    const r = edit(s, lr.id, { wasuli, particular: 'Steel pipes' });
    assert.equal(r.ok, false, wasuli);
    if (!r.ok) assert.deepEqual([r.code, r.detail], ['lr-wasuli-collected', '1']);
  }
  assert.deepEqual(lrRow(s, lr.id), lrBefore, 'the LR was not touched, not even its other boxes');
  assert.equal(JSON.stringify(row(s, lr.id)), wasuliBefore);
  assert.equal(audits(s).length, auditBefore);
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'lrs.update'").get() as { n: number }).n, 0);

  // A refused edit leaves nothing behind, not even a walk-in firm that was ticked "Add to firms".
  const count = (table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const [firms, trail] = [count('firms'), count('audit_log')];
  const walkIn = edit(s, lr.id, { wasuli: '600', consignee: { firmId: null, name: 'Brand New Traders', addToFirms: true } });
  assert.equal(walkIn.ok, false);
  assert.deepEqual([count('firms'), count('audit_log')], [firms, trail], 'the new firm and its audit row were undone with the refused edit');

  // Anything else on the LR can still be corrected: the collected money is not touched.
  const fixed = edit(s, lr.id, { wasuli: '500', particular: 'Steel pipes' });
  assert.ok(fixed.ok && fixed.value.changed && !fixed.value.wasuli);
  assert.equal(row(s, lr.id)?.status, 'collected');
});

test('cancel removes an unassigned or assigned row; restore brings it back unassigned; a collected one refuses the cancel', () => {
  const s = setUp();
  const free = book(s, { wasuli: '500' });
  const mine = book(s, { wasuli: '800' });
  const done = book(s, { wasuli: '900' });
  const none = book(s);
  const ramesh = agent(s);
  assignRow(s, mine.id, ramesh);
  collectRow(s, done.id, ramesh);

  assert.ok(cancel(s, free.id).ok);
  assert.ok(cancel(s, mine.id).ok);
  assert.ok(cancel(s, none.id).ok, 'an LR with no wasuli cancels as before');
  assert.equal(row(s, free.id), undefined);
  assert.equal(row(s, mine.id), undefined);
  const removed = audits(s).filter((a) => a.action === 'wasuli.remove');
  assert.equal(removed.length, 2);
  assert.equal(JSON.parse(removed[1].before ?? '').agent_id, ramesh, 'the audit row remembers who it was assigned to');

  const refused = cancel(s, done.id);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.deepEqual([refused.code, refused.detail], ['lr-wasuli-collected', '3']);
  assert.equal(lrRow(s, done.id).status, 'booked', 'the LR was not cancelled');
  assert.equal(row(s, done.id)?.status, 'collected');

  assert.ok(restore(s, mine.id).ok);
  const back = row(s, mine.id) as Record<string, unknown>;
  assert.deepEqual([back.amount_paise, back.status, back.agent_id, back.assigned_date, back.seat], [80000, 'unassigned', null, null, 'seat-2']);
  assert.ok(restore(s, none.id).ok);
  assert.equal(row(s, none.id), undefined, 'no amount, no row');
  assert.equal(count(s), 2, 'the restored one and the collected one');
});

test('a loaded LR keeps following its wasuli; a cancelled LR cannot be edited so its row stays out', () => {
  const s = setUp();
  const lr = book(s, { wasuli: '500' });
  const memo = s.memos.create(s.db, 'seat-1', {
    uid: 'm1', date: null, truckId: s.truck, driverId: s.driver, fromStationId: s.yavatmal, toStationId: s.nagpur, truckHire: '', loadingHamali: '', lrIds: [lr.id],
  });
  assert.ok(memo.ok);
  assert.equal(lrRow(s, lr.id).status, 'loaded');
  assert.ok(edit(s, lr.id, { wasuli: '550' }).ok);
  assert.equal(row(s, lr.id)?.amount_paise, 55000);
  assert.equal(cancel(s, lr.id).ok, false, 'a loaded LR still has to come off its memo first');
  assert.equal(row(s, lr.id)?.amount_paise, 55000);
});

test('the wasuli change and the LR change are one transaction', () => {
  const s = setUp();
  const lr = book(s, { wasuli: '500' });
  s.db.exec("CREATE TRIGGER fail_wasuli BEFORE INSERT ON audit_log WHEN NEW.action = 'wasuli.update' BEGIN SELECT RAISE(ABORT, 'audit down'); END");
  const before = lrRow(s, lr.id);
  assert.throws(() => edit(s, lr.id, { wasuli: '900', particular: 'Steel pipes' }), /audit down/);
  assert.deepEqual(lrRow(s, lr.id), before, 'the LR edit went back with it');
  assert.equal(row(s, lr.id)?.amount_paise, 50000);
});

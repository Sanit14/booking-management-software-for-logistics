import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DashboardSummary } from '../../shared';
import { ADMIN_PAGES, MAIN_PAGES, badgesOf } from './sidebar';

const summary: DashboardSummary = {
  date: '2026-11-13', booked: 40, loaded: 12, cancelled: 1, qty: 300, pending: 575, pendingQty: 4000, oldestPending: '2026-11-01', pendingStations: 9, memos: 9, trucksOut: 7, wasuliUnassigned: 19,
};

test('the sidebar follows DM: Main is Dashboard, LR Entry, Loading Memo, Saved Memos, Wasuli; Admin is Firm Accounts, Reports, Master Data, History, Settings', () => {
  assert.deepEqual(MAIN_PAGES, ['dashboard', 'lrEntry', 'loadingMemo', 'savedMemos', 'wasuli']);
  assert.deepEqual(ADMIN_PAGES, ['firmAccounts', 'reports', 'masters', 'history', 'settings']);
  assert.equal(new Set([...MAIN_PAGES, ...ADMIN_PAGES]).size, 10, 'no page twice');
});

test('badges: pending LRs, memos saved today and unassigned wasuli, as counts; none before the keeper has answered', () => {
  assert.deepEqual(badgesOf(summary), { loadingMemo: 575, savedMemos: 9, wasuli: 19 });
  assert.equal(badgesOf(null), undefined);
  assert.deepEqual(badgesOf({ ...summary, pending: 0, memos: 0, wasuliUnassigned: 0 }), { loadingMemo: 0, savedMemos: 0, wasuli: 0 });
});

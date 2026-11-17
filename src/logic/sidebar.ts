// The sidebar's pages in DM's order, and the counts on them (4.7). Pure: no React, so a test can hold the order and the badges.
import type { DashboardSummary } from '../../shared';

export type PageId = 'dashboard' | 'lrEntry' | 'loadingMemo' | 'savedMemos' | 'wasuli' | 'firmAccounts' | 'reports' | 'masters' | 'history' | 'settings';

export const MAIN_PAGES: PageId[] = ['dashboard', 'lrEntry', 'loadingMemo', 'savedMemos', 'wasuli'];
export const ADMIN_PAGES: PageId[] = ['firmAccounts', 'reports', 'masters', 'history', 'settings'];

/** Counts only, never money: pending LRs on Loading Memo, the memos saved today on Saved Memos, the collections nobody has on Wasuli. Nothing until the keeper has answered. */
export function badgesOf(s: DashboardSummary | null): Partial<Record<PageId, number>> | undefined {
  return s ? { loadingMemo: s.pending, savedMemos: s.memos, wasuli: s.wasuliUnassigned } : undefined;
}

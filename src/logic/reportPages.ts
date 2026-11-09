import type { ReportCursor } from '../../shared';

/** What the keeper answered for the first page of a report: its rows, the way on, and the totals of the whole filter. `key` says which report, period and filters. */
export interface FirstPage {
  key: string;
  rows: unknown[];
  next: ReportCursor | null;
  totals: unknown;
}

/** The rows on screen: the first page, then every page the clerk asked for with Load more. */
export interface Paged extends FirstPage {
  /** How many of `rows` are the first page. */
  firstLen: number;
  /** A change came in after the pages below the first were loaded: they are as they were and may be out of date. */
  stale: boolean;
}

export const NO_PAGES: Paged = { key: '', rows: [], next: null, totals: null, firstLen: 0, stale: false };

/** Only the first page (Refresh, a new report, a new period, a new filter). */
export const startPages = (first: FirstPage): Paged => ({ ...first, firstLen: first.rows.length, stale: false });

/**
 * A change on any seat: the keeper's new first page and totals replace the old ones, and the pages loaded below the first stay exactly as they were,
 * marked out of date. Re-reading every loaded page on every save cost the keeper a full report per page for each LR any seat saved. A different report starts over.
 */
export function withFirstPage(old: Paged, first: FirstPage, keyOf: (row: unknown) => string): Paged {
  if (old.key !== first.key || old.rows.length === old.firstLen) return startPages(first);
  // A row taken out of the first page pulls the first row of the next one up into it: that row is not shown twice.
  const inFirst = new Set(first.rows.map(keyOf));
  const below = old.rows.slice(old.firstLen).filter((r) => !inFirst.has(keyOf(r)));
  return { key: first.key, rows: [...first.rows, ...below], next: old.next, totals: first.totals, firstLen: first.rows.length, stale: true };
}

/**
 * Load more: one more page after the last one on screen. `outdated`: the first page was replaced while this page was on its way, so the cursor it was
 * asked with was the old one (a row can be missing or twice): the pages below are marked out of date, as after any change.
 */
export const withMorePage = (old: Paged, page: { rows: unknown[]; next: ReportCursor | null }, outdated = false): Paged => ({
  ...old,
  rows: [...old.rows, ...page.rows],
  next: page.next,
  stale: old.stale || outdated,
});

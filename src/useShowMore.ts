import { useState } from 'react';
import { FIRST_ROWS, firstRows } from './logic/showMore';

/** A long list drawn in pages: the first FIRST_ROWS, then FIRST_ROWS more for each "Show more". Another list (`listKey`: another day, another tab) starts at the first page again. */
export function useShowMore<T>(rows: T[], listKey: string) {
  const [state, setState] = useState({ listKey, limit: FIRST_ROWS });
  if (state.listKey !== listKey) setState({ listKey, limit: FIRST_ROWS });
  const limit = state.listKey === listKey ? state.limit : FIRST_ROWS;
  const { rows: shown, hidden } = firstRows(rows, limit);
  return { shown, hidden, showMore: () => setState({ listKey, limit: limit + FIRST_ROWS }) };
}

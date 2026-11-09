/** A long list draws this many rows first; "Show more" adds this many again. Measured in the real window (docs/bench/*-ui*.md): 400 rows cost over 100 ms a keystroke. */
export const FIRST_ROWS = 200;

/** The first `limit` rows, and how many are left out. The same array comes back when nothing is left out. */
export function firstRows<T>(rows: T[], limit: number): { rows: T[]; hidden: number } {
  return rows.length > limit ? { rows: rows.slice(0, limit), hidden: rows.length - limit } : { rows, hidden: 0 };
}

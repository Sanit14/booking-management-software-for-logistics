import type { Db } from './db';

export type Series = 'lr' | 'challan';

/**
 * The next LR or challan number of the year the record is dated in (not today's year), restarting from 1 each
 * 1 January. Must run inside the transaction that saves the record: if that rolls back, the number is not used.
 * Safe because the keeper is the only writer and runs one statement at a time.
 * ponytail: db.transaction() begins deferred; if a second writer process ever appears (an external tool, a
 * backup that writes), take the write lock up front with `.immediate`.
 */
export function nextNumber(db: Db, name: Series, date: string): { year: number; no: number } {
  if (!db.inTransaction) throw new Error('nextNumber must be called inside the saving transaction');
  const parsed = new Date(`${date}T00:00:00Z`);
  // The round trip catches impossible dates such as 2026-02-30, which Date would silently roll into March.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`invalid date: ${JSON.stringify(date)}`);
  }
  const year = parsed.getUTCFullYear();
  // One statement: create the year's counter at 1 or add 1, and hand the new value back.
  const row = db
    .prepare('INSERT INTO counters (name, year, last) VALUES (?, ?, 1) ON CONFLICT (name, year) DO UPDATE SET last = last + 1 RETURNING last')
    .get(name, year) as { last: number };
  return { year, no: row.last };
}

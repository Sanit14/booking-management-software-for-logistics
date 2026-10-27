import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface Column<R> {
  key: string;
  header: string;
  /** Number column: right-aligned, tabular figures. */
  num?: boolean;
  width?: number;
  render: (row: R) => ReactNode;
}

interface Props<R> {
  /** Names the table for screen readers. */
  label: string;
  columns: Column<R>[];
  /** The rows to show. The caller (via the keeper) has already filtered, sorted and limited them. */
  rows: R[];
  rowKey: (row: R) => string;
  /** Row keys to tint as ticked / selected. */
  ticked?: ReadonlySet<string>;
  /** Totals row by column key; absent columns stay blank. Computed by the keeper, never summed here. */
  totals?: Record<string, ReactNode>;
  /** Shown instead of the body when there are no rows. */
  empty: string;
  /** Height of the scroll box; the header and totals stay in view. Omit to size to the rows. */
  maxHeight?: number;
}

export default function Table<R>({ label, columns, rows, rowKey, ticked, totals, empty, maxHeight }: Props<R>) {
  const align = (c: Column<R>) => (c.num ? styles.num : undefined);
  return (
    // A scroll box is not keyboard-focusable in Chrome 108 unless it says so; the header stays in view while it scrolls.
    <div
      className={styles.scroll}
      style={maxHeight ? { maxHeight } : undefined}
      {...(maxHeight ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}
    >
      <table className={styles.table} aria-label={label}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={align(c)} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} className={ticked?.has(key) ? styles.ticked : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={align(c)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {totals && rows.length > 0 && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={align(c)}>
                  {totals[c.key]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

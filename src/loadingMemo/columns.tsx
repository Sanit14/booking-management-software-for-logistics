import type { MemoLrRow } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import { formatPaise } from '../logic/rupees';
import { strings } from '../strings';
import type { Column } from '../ui/Table';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;
const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);
const money = (paise: number) => (paise > 0 ? formatPaise(paise) : t.none);
/** A total with its sign: 150000 → "₹1,500". */
export const rupees = (paise: number) => `${strings.ui.rupee}${formatPaise(paise)}`;

/** An LR in the pending list and on a saved memo: the same columns, the list adds its tick box in front. */
export const lrColumns: Column<MemoLrRow>[] = [
  { key: 'lr', header: t.columns.lr, width: 56, num: true, render: (r) => r.lrNo },
  { key: 'date', header: t.columns.date, width: 110, render: (r) => isoToDisplay(r.date) },
  { key: 'consignor', header: t.columns.consignor, render: (r) => text(r.consignor) },
  { key: 'consignee', header: t.columns.consignee, render: (r) => text(r.consignee) },
  { key: 'to', header: t.columns.to, width: 96, render: (r) => text(r.toStation) },
  { key: 'qty', header: t.columns.qty, width: 54, num: true, render: (r) => r.qty },
  { key: 'toPay', header: t.columns.toPay, width: 84, num: true, render: (r) => money(r.toPayPaise) },
  { key: 'paid', header: t.columns.paid, width: 84, num: true, render: (r) => money(r.paidPaise) },
];

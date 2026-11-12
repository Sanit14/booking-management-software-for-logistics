import { ArrowLeft } from 'lucide-react';
import type { KeeperResult, ReportLrCursor, ReportLrRow, ReportLrsFor, ReportLrsPage, ReportQuery } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import { rupees } from '../loadingMemo/columns';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import { useState } from 'react';
import { money } from './defs';
import styles from './ReportsPage.module.css';

const t = strings.reports;
const c = t.lrColumns;
// An LR's amounts, its memo and its stations: any of those changing on any seat refetches the list.
const TABLES = ['lrs', 'memos', 'stations', 'firms'] as const;
const NO_PAGE: ReportLrsPage = { rows: [], next: null, totals: { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, hamaliPaise: 0, totalPaise: 0 } };

/** What the drill-down shows: the row clicked, under the period and filters it was added up with. */
export interface Drill {
  of: ReportLrsFor;
  title: string;
  query: ReportQuery;
}

const columns: Column<ReportLrRow>[] = [
  { key: 'lr', header: c.lr, width: 60, num: true, render: (r) => r.lrNo },
  { key: 'date', header: c.date, width: 112, render: (r) => isoToDisplay(r.date) },
  {
    key: 'parties',
    header: c.parties,
    render: (r) => (
      <>
        <span className={styles.cell} title={r.consignor}>
          {r.consignor}
        </span>
        <span className={styles.sub} title={`${r.consignee} · ${r.toStation}`}>
          {`→ ${r.consignee} · ${r.toStation}`}
        </span>
      </>
    ),
  },
  { key: 'qty', header: c.qty, width: 56, num: true, render: (r) => r.qty },
  { key: 'toPay', header: c.toPay, width: 118, num: true, render: (r) => money(r.toPayPaise) },
  { key: 'paid', header: c.paid, width: 118, num: true, render: (r) => money(r.paidPaise) },
  {
    key: 'total',
    header: c.total,
    width: 126,
    num: true,
    render: (r) => (
      <>
        {rupees(r.totalPaise)}
        <span className={styles.sub}>{r.status === 'booked' ? c.booked : ''}</span>
      </>
    ),
  },
];

/**
 * The LRs behind one row of Station-, Consignor- or Consignee-wise, under the same period and filters, so they add up to the row.
 * An LR opens in LR Entry. Read only.
 */
export default function ReportLrs({ drill, onBack, onPick }: { drill: Drill; onBack: () => void; onPick: (jump: Jump) => void }) {
  const key = JSON.stringify([drill.of, drill.query]);
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === key ? loaded.pages : 1;
  const list = useKeeperData<ReportLrsPage>(
    async () => {
      let cursor: ReportLrCursor | null = null;
      const rows: ReportLrRow[] = [];
      let last = NO_PAGE;
      for (let i = 0; i < pages; i++) {
        const r: KeeperResult<ReportLrsPage> = await window.bm.keeper.reports.lrs({ of: drill.of, query: drill.query }, cursor);
        if (!r.ok) return r;
        last = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { ...last, rows } };
    },
    TABLES,
    NO_PAGE,
    [key, pages],
  );
  const x = list.data.totals;
  const labels = strings.paper.report.kinds.dateWise.totals; // LRs, Qty, To pay, Paid, Hamali, Total
  const values = [String(x.lrs), String(x.qty), rupees(x.toPayPaise), rupees(x.paidPaise), rupees(x.hamaliPaise), rupees(x.totalPaise)];
  return (
    <div className={styles.drill}>
      <Card>
        <div className={styles.head}>
          <Button small variant="ghost" icon={<ArrowLeft size={18} aria-hidden="true" />} aria-label={t.backLabel} onClick={onBack}>
            {t.back}
          </Button>
          <h1 className={styles.title} title={drill.title}>
            {t.lrsHead(drill.title, isoToDisplay(drill.query.from), isoToDisplay(drill.query.to))}
          </h1>
        </div>
      </Card>
      <Card className={styles.listCard}>
        <div className={styles.tableBox}>
          <Table label={t.lrsLabel} columns={columns} rows={list.data.rows} rowKey={(r) => String(r.lrId)} empty={t.lrsEmpty} onRowActivate={(r) => onPick({ to: 'lr', id: r.lrId })} />
        </div>
        <div className={styles.totals}>
          {labels.map((label, i) => (
            <span key={label}>
              {label} <strong>{values[i]}</strong>
            </span>
          ))}
          {list.data.next && (
            <Button small variant="outline" onClick={() => setLoaded({ key, pages: pages + 1 })}>
              {t.loadMore}
            </Button>
          )}
          <span className={styles.hint}>{t.lrsOpenHint}</span>
        </div>
      </Card>
    </div>
  );
}


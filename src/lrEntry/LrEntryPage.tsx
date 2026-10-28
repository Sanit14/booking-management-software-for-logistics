import { useState } from 'react';
import type { ChangeTable, LrDay, LrDefaults, LrListRow, MastersAll } from '../../shared';
import { formatPaise } from '../logic/rupees';
import Page from '../shell/Page';
import { strings } from '../strings';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import LrForm, { isoToDisplay } from './LrForm';
import styles from './LrEntryPage.module.css';

const t = strings.lr;
const NONE: MastersAll = { stations: [], firms: [], trucks: [], drivers: [] };
const MASTER_TABLES: ChangeTable[] = ['stations', 'firms', 'trucks', 'drivers'];
const money = (paise: number) => (paise > 0 ? formatPaise(paise) : t.none);
const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

const columns: Column<LrListRow>[] = [
  { key: 'lr', header: t.columns.lr, width: 70, num: true, render: (r) => r.lrNo },
  { key: 'consignor', header: t.columns.consignor, render: (r) => text(r.consignor) },
  { key: 'consignee', header: t.columns.consignee, render: (r) => text(r.consignee) },
  { key: 'to', header: t.columns.to, width: 110, render: (r) => text(r.toStation) },
  { key: 'qty', header: t.columns.qty, width: 62, num: true, render: (r) => r.qty },
  { key: 'toPay', header: t.columns.toPay, width: 92, num: true, render: (r) => money(r.toPayPaise) },
  { key: 'paid', header: t.columns.paid, width: 92, num: true, render: (r) => money(r.paidPaise) },
  { key: 'status', header: t.columns.status, width: 112, render: (r) => <Chip kind={r.status} /> },
];

/**
 * LR Entry: the form on top, the day's LRs under it. Both refresh by themselves: the keeper announces every committed
 * LR and master, from this seat or any other, and only the parts that changed are fetched again.
 */
export default function LrEntryPage() {
  const [date, setDate] = useState<string | null>(null); // null = today; another date was unlocked with the System PIN
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const defaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(date), ['settings', 'lrs'], null, [date]);
  // The rows carry the To station's name, so a renamed station refreshes the list too.
  const day = useKeeperData<LrDay | null>(() => window.bm.keeper.lrs.byDate(date), ['lrs', 'stations'], null, [date]);
  const totals = day.data?.totals;

  return (
    <Page id="lrEntry">
      <div className={styles.page}>
        {defaults.data && masters.loaded ? (
          <LrForm stations={masters.data.stations} firms={masters.data.firms} defaults={defaults.data} date={date} onDate={setDate} />
        ) : null}
        <Card
          className={styles.listCard}
          title={day.data ? t.listTitle(date === null, isoToDisplay(day.data.date)) : t.listTitle(true, '')}
          aside={
            <span className={styles.listAside}>
              <Chip kind="booked" count={totals?.booked ?? 0} />
              <Chip kind="loaded" count={totals?.loaded ?? 0} />
              {t.newestFirst}
            </span>
          }
        >
          <div className={styles.tableBox}>
            <Table label={t.listLabel} columns={columns} rows={day.data?.rows ?? []} rowKey={(r) => String(r.id)} empty={t.empty} />
          </div>
          <div className={styles.totalsStrip}>
            <span>
              {t.totals.lrs} <strong>{totals?.count ?? 0}</strong>
            </span>
            <span>
              {t.totals.qty} <strong>{totals?.qty ?? 0}</strong>
            </span>
            <span>
              {t.totals.toPay} <strong>{formatPaise(totals?.toPayPaise ?? 0)}</strong>
            </span>
            <span>
              {t.totals.paid} <strong>{formatPaise(totals?.paidPaise ?? 0)}</strong>
            </span>
          </div>
        </Card>
      </div>
    </Page>
  );
}

import { Boxes, ClipboardList, FileText, Truck } from 'lucide-react';
import type { DashboardSummary, PendingStation, RecentLr } from '../../shared';
import { keyLabel } from '../logic/keymap';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import GlobalSearch from '../search/GlobalSearch';
import Page from '../shell/Page';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card, StatCard } from '../ui/Card';
import Chip from '../ui/Chip';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import { useKeys } from '../useKeys';
import styles from './DashboardPage.module.css';

const t = strings.dashboard;
const STATION_TABLES = ['lrs', 'stations'] as const;
const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

const pendingColumns: Column<PendingStation>[] = [
  { key: 'station', header: t.columns.station, render: (r) => text(r.station) },
  { key: 'lrs', header: t.columns.lrs, width: 80, num: true, render: (r) => r.lrs },
  { key: 'qty', header: t.columns.qty, width: 80, num: true, render: (r) => r.qty },
];
const recentColumns: Column<RecentLr>[] = [
  { key: 'lr', header: t.columns.lr, width: 64, num: true, render: (r) => r.lrNo },
  { key: 'consignee', header: t.columns.consignee, render: (r) => text(r.consignee) },
  { key: 'to', header: t.columns.to, width: 96, render: (r) => text(r.toStation) },
  { key: 'status', header: t.columns.status, width: 112, render: (r) => <Chip kind={r.status} /> },
];

/**
 * Home: how today is going, as counts only (never money), and the search box. The summary comes from App (the sidebar
 * badges use it too); the two lists refetch on the keeper's change events, nothing polls.
 */
export default function DashboardPage({ summary, onMakeMemo, onPick }: { summary: DashboardSummary | null; onMakeMemo: () => void; onPick: (jump: Jump) => void }) {
  const { keys } = useKeys();
  const pending = useKeeperData(() => window.bm.keeper.dashboard.pendingByStation(), STATION_TABLES, [] as PendingStation[]);
  const recent = useKeeperData(() => window.bm.keeper.dashboard.recentLrs(), STATION_TABLES, [] as RecentLr[]);
  const s = summary;
  const more = s ? s.pendingStations - pending.data.length : 0;

  return (
    <Page id="dashboard">
      <div className={styles.page}>
        <GlobalSearch floating keyCap={keyLabel(keys.globalSearch)} onPick={onPick} />
        <section className={styles.stats} aria-label={t.glance}>
          <StatCard
            icon={<FileText size={18} aria-hidden="true" />}
            tag={s && s.cancelled > 0 ? t.cancelledTag(s.cancelled) : t.today}
            value={s ? s.booked + s.loaded : t.none}
            label={t.lrsToday}
            lines={[
              [t.booked, s?.booked ?? 0],
              [t.loaded, s?.loaded ?? 0],
            ]}
          />
          <StatCard
            tone="orange"
            icon={<Boxes size={18} aria-hidden="true" />}
            tag={t.allDays}
            value={s ? s.pending : t.none}
            label={t.pending}
            lines={[
              [t.stations, s?.pendingStations ?? 0],
              [t.oldest, s?.oldestPending ? isoToDisplay(s.oldestPending) : t.none],
            ]}
          />
          <StatCard icon={<ClipboardList size={18} aria-hidden="true" />} tag={t.today} value={s ? s.memos : t.none} label={t.memosToday} lines={[[t.qtyToday, s?.qty ?? 0]]} />
          <StatCard icon={<Truck size={18} aria-hidden="true" />} tag={t.today} value={s ? s.trucksOut : t.none} label={t.trucksOut} />
        </section>
        <div className={styles.cards}>
          <Card className={styles.listCard} title={t.pendingTitle} aside={<span className={styles.aside}>{t.pendingTotal(s?.pending ?? 0, s?.pendingQty ?? 0)}</span>}>
            <div className={styles.tableBox}>
              <Table
                label={t.pendingList}
                columns={pendingColumns}
                rows={pending.data}
                rowKey={(r) => String(r.stationId)}
                empty={t.emptyPending}
                onRowActivate={(r) => onPick({ to: 'pending', stationId: r.stationId })}
              />
            </div>
            <div className={styles.foot}>
              <Button small variant="outline" onClick={onMakeMemo}>
                {t.makeMemo}
              </Button>
              <span className={styles.note}>{more > 0 ? t.moreStations(more) : t.stationHint}</span>
            </div>
          </Card>
          <Card className={styles.listCard} title={t.recentTitle}>
            <div className={styles.tableBox}>
              <Table label={t.recentList} columns={recentColumns} rows={recent.data} rowKey={(r) => String(r.id)} empty={t.emptyRecent} dimmed={new Set(recent.data.filter((r) => r.status === 'cancelled').map((r) => String(r.id)))} />
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

import { useMemo, useState } from 'react';
import type { MastersAll, SavedMemoCursor, SavedMemoFilters, SavedMemoPage, SavedMemoRow } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import { stationFilter, type Box } from '../logic/memoPick';
import { matchKey } from '../logic/typeAhead';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import Table, { type Column } from '../ui/Table';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeeperData } from '../useKeeperData';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;
const NO_PAGE: SavedMemoPage = { rows: [], next: null };
const noBox: Box = { text: '', id: null };

const columns: Column<SavedMemoRow>[] = [
  { key: 'no', header: t.savedColumns.challan, width: 76, num: true, render: (r) => r.challanNo },
  { key: 'date', header: t.savedColumns.date, width: 106, render: (r) => isoToDisplay(r.date) },
  { key: 'truck', header: t.savedColumns.truck, width: 130, render: (r) => <span className={styles.cell} title={r.truck}>{r.truck}</span> },
  { key: 'driver', header: t.savedColumns.driver, render: (r) => <span className={styles.cell} title={r.driver}>{r.driver}</span> },
  { key: 'to', header: t.savedColumns.to, width: 100, render: (r) => <span className={styles.cell} title={r.toStation}>{r.toStation}</span> },
  { key: 'lrs', header: t.savedColumns.lrs, width: 52, num: true, render: (r) => r.lrCount },
  { key: 'qty', header: t.savedColumns.qty, width: 54, num: true, render: (r) => r.qty },
  {
    key: 'status',
    header: t.savedColumns.status,
    width: 176,
    render: (r) => (
      <span className={styles.chips}>
        <Chip kind={r.status} />
        {r.differs && <Chip kind="differs" />}
      </span>
    ),
  },
];

interface Props {
  masters: MastersAll;
  today: string;
  /** The tab is showing: a hidden list is not refetched on every LR a seat saves. */
  active: boolean;
  onOpen: (id: number) => void;
}

/**
 * The saved memos, newest first: a day range (today until another is typed), a truck and a To station. A row opens the memo.
 * The keeper pages (100 a page) and says which memos differ from their LRs; this only draws.
 */
export default function SavedMemos({ masters, today, active, onOpen }: Props) {
  const enterToNext = useEnterToNext();
  // null = the default (today); '' = no bound.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [truck, setTruck] = useState<Box>(noBox);
  const [station, setStation] = useState<Box>(noBox);

  const truckId = useMemo(() => {
    const typed = truck.text.trim();
    return typed === '' ? null : (truck.id ?? masters.trucks.find((x) => matchKey(x.number) === matchKey(typed))?.id ?? null);
  }, [truck, masters.trucks]);
  const stationId = stationFilter(station.text, station.id, masters.stations);
  const filters = useMemo<SavedMemoFilters>(
    () => ({ from: (from ?? today) || null, to: (to ?? today) || null, truckId, toStationId: stationId }),
    [from, to, today, truckId, stationId],
  );
  const filtersKey = JSON.stringify(filters);

  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === filtersKey ? loaded.pages : 1;
  const list = useKeeperData<SavedMemoPage>(
    async () => {
      if (!active || today === '') return { ok: true as const, value: NO_PAGE }; // not before the keeper has said what today is
      let cursor: SavedMemoCursor | null = null;
      const rows: SavedMemoRow[] = [];
      let last = NO_PAGE;
      for (let i = 0; i < pages; i++) {
        const r = await window.bm.keeper.memos.list(filters, cursor);
        if (!r.ok) return r;
        last = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { rows, next: last.next } };
    },
    ['memos', 'lrs'], // an LR edited on any seat can make a memo differ
    NO_PAGE,
    [filtersKey, pages, active],
  );
  const { rows, next } = list.data;
  const dimmed = useMemo(() => new Set(rows.filter((r) => r.status === 'cancelled').map((r) => String(r.id))), [rows]);

  const trucks = useMemo<Option[]>(() => masters.trucks.filter((x) => x.active).map((x) => ({ id: String(x.id), label: x.number })), [masters.trucks]);
  const stations = useMemo<Option[]>(() => masters.stations.filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name })), [masters.stations]);
  const clear = () => {
    setFrom(null);
    setTo(null);
    setTruck(noBox);
    setStation(noBox);
  };

  return (
    <>
      <Card className={styles.filters}>
        <form className={styles.filterRow} aria-label={t.savedFiltersLabel} onKeyDown={enterToNext} onSubmit={(e) => e.preventDefault()} noValidate>
          <Field className={styles.dateBox} label={t.from} type="date" max={today} value={from ?? today} onChange={(e) => setFrom(e.target.value)} />
          <Field className={styles.dateBox} label={t.to} type="date" max={today} value={to ?? today} onChange={(e) => setTo(e.target.value)} />
          <TypeAhead
            className={styles.partyBox}
            label={t.truckFilter}
            listLabel={t.trucksList}
            placeholder={t.any}
            value={truck.text}
            options={trucks}
            onChange={(text) => setTruck({ text, id: null })}
            onPick={(o) => setTruck({ text: o.label, id: Number(o.id) })}
          />
          <TypeAhead
            className={styles.partyBox}
            label={t.station}
            listLabel={t.stationList}
            placeholder={t.any}
            value={station.text}
            options={stations}
            onChange={(text) => setStation({ text, id: null })}
            onPick={(o) => setStation({ text: o.label, id: Number(o.id) })}
          />
          <Button type="button" variant="outline" className={styles.clear} aria-label={t.clearLabel} title={t.clearLabel} onClick={clear}>
            {t.clear}
          </Button>
        </form>
      </Card>
      <Card className={styles.listCard} title={t.tabs.saved}>
        <div className={styles.tableBox}>
          <Table label={t.savedLabel} columns={columns} rows={rows} rowKey={(r) => String(r.id)} dimmed={dimmed} empty={t.savedEmpty} onRowActivate={(r) => onOpen(r.id)} />
        </div>
        {next && (
          <div className={styles.more}>
            <Button small variant="outline" onClick={() => setLoaded({ key: filtersKey, pages: pages + 1 })}>
              {t.loadMoreSaved}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

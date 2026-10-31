import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MemoCursor, MemoDefaults, MemoFilters, MemoLrRow, PendingPage } from '../../shared';
import { partyFilter, stationFilter, tickAll, toggle, untick, type Box, type Ticks } from '../logic/memoPick';
import type { Jump } from '../logic/searchResults';
import { MASTER_TABLES, NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import KeyCap from '../ui/KeyCap';
import Table, { type Column } from '../ui/Table';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeeperData } from '../useKeeperData';
import { lrColumns } from './columns';
import styles from './LoadingMemoPage.module.css';
import MemoPanel from './MemoPanel';
import MemoView from './MemoView';

const t = strings.memo;
const NO_PAGE: PendingPage = { rows: [], next: null, count: 0, qty: 0 };
const noop = () => undefined;

const noBox: Box = { text: '', id: null };

interface Props {
  jump: Jump | null;
  onJumpUsed: () => void;
  /** The oldest booked LR's date, shown in "Booked from" while the box is untouched. */
  oldestPending: string | null;
}

/**
 * Loading Memo: filter the pending LRs, tick the ones going on one truck, fill the memo and save. The filters and the
 * list come from the keeper (100 rows a page, newest answer wins, refetched when any seat changes an LR or a memo); the
 * ticks are kept here by LR id, so a filter that hides a ticked LR does not lose it.
 */
export default function LoadingMemoPage({ jump, onJumpUsed, oldestPending }: Props) {
  const enterToNext = useEnterToNext();
  const filterForm = useRef<HTMLFormElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const today = useKeeperData<MemoDefaults | null>(() => window.bm.keeper.memos.defaults(null), ['memos'], null).data?.today ?? '';

  // null in a date box = follows the default (the oldest pending LR, today); "no bound" is what the keeper is told.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [station, setStation] = useState<Box>(noBox);
  const [consignor, setConsignor] = useState<Box>(noBox);
  const [consignee, setConsignee] = useState<Box>(noBox);
  const [ticks, setTicks] = useState<Ticks>(new Set());
  const [view, setView] = useState<number | null>(null); // the saved memo shown read-only

  const stationId = stationFilter(station.text, station.id, masters.data.stations);
  const filters = useMemo<MemoFilters>(
    () => ({
      from,
      to,
      toStationId: stationId,
      consignor: partyFilter(consignor.text, consignor.id, masters.data.firms),
      consignee: partyFilter(consignee.text, consignee.id, masters.data.firms),
    }),
    [from, to, stationId, consignor, consignee, masters.data.firms],
  );
  const filtersKey = JSON.stringify(filters);

  // "Load more" asks for one more page; changing a filter starts again from the first.
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === filtersKey ? loaded.pages : 1;
  // The pages the clerk has opened, fetched one after the other, so a change event refreshes what they are looking at.
  const pending = useKeeperData<PendingPage>(
    async () => {
      let cursor: MemoCursor | null = null;
      const rows: MemoLrRow[] = [];
      let last = NO_PAGE;
      for (let i = 0; i < pages; i++) {
        const r = await window.bm.keeper.memos.pending(filters, cursor);
        if (!r.ok) return r;
        last = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { ...last, rows } };
    },
    ['lrs', 'memos'],
    NO_PAGE,
    [filtersKey, pages],
  );
  const { rows, next, count } = pending.data;

  // A pick from search or the Dashboard: a challan opens read-only; a station sets the To-station filter.
  const take = useRef(noop);
  useEffect(() => {
    take.current = () => {
      if (jump?.to === 'memo') setView(jump.id);
      else if (jump?.to === 'pending') {
        const s = masters.data.stations.find((x) => x.active && x.id === jump.stationId);
        if (s) setStation({ text: s.name, id: s.id });
      }
      onJumpUsed();
    };
  });
  useEffect(() => {
    if (jump?.to === 'memo' || (jump?.to === 'pending' && masters.loaded)) take.current();
  }, [jump, masters.loaded]);

  const stations = useMemo<Option[]>(() => masters.data.stations.filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name })), [masters.data.stations]);
  const firms = useMemo<Option[]>(
    () => masters.data.firms.filter((f) => f.active).map((f) => ({ id: String(f.id), label: f.name, hint: masters.data.stations.find((s) => s.id === f.stationId)?.name })),
    [masters.data.firms, masters.data.stations],
  );
  const filterStation = stationId !== null ? { id: stationId, name: masters.data.stations.find((s) => s.id === stationId)?.name ?? '' } : null;

  const clear = () => {
    setFrom(null);
    setTo(null);
    setStation(noBox);
    setConsignor(noBox);
    setConsignee(noBox);
  };

  // Enter walks the filter boxes; on the last one it goes down into the list, where Space ticks the row it is on.
  const onFilterKey = (e: KeyboardEvent<HTMLFormElement>) => {
    enterToNext(e);
    if (e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.altKey || e.shiftKey) return;
    const boxes = e.currentTarget.querySelectorAll('input');
    if (e.target !== boxes[boxes.length - 1]) return;
    e.preventDefault();
    listBox.current?.querySelector<HTMLElement>('tbody tr[tabindex="0"]')?.focus();
  };
  // Ctrl+A ticks every row shown, Ctrl+Shift+A takes every tick off (also those a filter hides).
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyA') return;
    e.preventDefault();
    setTicks(e.shiftKey ? new Set() : tickAll(ticks, rows.map((r) => r.id)));
  };

  const tickedKeys = useMemo(() => new Set([...ticks].map(String)), [ticks]);
  const columns = useMemo<Column<MemoLrRow>[]>(
    () => [
      {
        key: 'tick',
        header: t.columns.tick,
        width: 46,
        render: (r) => <input type="checkbox" className={styles.tick} tabIndex={-1} checked={ticks.has(r.id)} onChange={noop} aria-label={t.tickLabel(r.lrNo)} />,
      },
      ...lrColumns,
    ],
    [ticks],
  );
  const tickRow = (r: MemoLrRow) => setTicks((now) => toggle(now, r.id));

  return (
    <>
      <div className={styles.page}>
        <Card className={styles.filters}>
          <form ref={filterForm} className={styles.filterRow} aria-label={t.filtersLabel} onKeyDown={onFilterKey} onSubmit={(e) => e.preventDefault()} noValidate>
            <Field
              className={styles.dateBox}
              label={t.from}
              type="date"
              max={today}
              value={from ?? oldestPending ?? ''}
              onChange={(e) => setFrom(e.target.value || null)}
            />
            <Field className={styles.dateBox} label={t.to} type="date" max={today} value={to ?? today} onChange={(e) => setTo(e.target.value === today ? null : e.target.value || null)} />
            <TypeAhead
              className={styles.stationBox}
              label={t.station}
              listLabel={t.stationList}
              placeholder={t.any}
              value={station.text}
              options={stations}
              onChange={(text) => setStation({ text, id: null })}
              onPick={(o) => setStation({ text: o.label, id: Number(o.id) })}
            />
            <TypeAhead
              className={styles.partyBox}
              label={t.consignor}
              listLabel={t.firmList}
              placeholder={t.any}
              walkInLabel={t.walkIn}
              value={consignor.text}
              options={firms}
              onChange={(text) => setConsignor({ text, id: null })}
              onPick={(o) => setConsignor({ text: o.label, id: Number(o.id) })}
            />
            <TypeAhead
              className={styles.partyBox}
              label={t.consignee}
              listLabel={t.firmList}
              placeholder={t.any}
              walkInLabel={t.walkIn}
              value={consignee.text}
              options={firms}
              onChange={(text) => setConsignee({ text, id: null })}
              onPick={(o) => setConsignee({ text: o.label, id: Number(o.id) })}
            />
            <Button type="button" variant="outline" className={styles.clear} aria-label={t.clearLabel} title={t.clearLabel} onClick={clear}>
              {t.clear}
            </Button>
          </form>
        </Card>

        <Card
          className={styles.listCard}
          title={t.pendingTitle}
          aside={
            <span className={styles.listAside}>
              <span className={styles.tickedTag}>{t.ticked(ticks.size)}</span>
              <span>{t.shownOf(rows.length, count)}</span>
              <span className={styles.keyHint}>
                <KeyCap>{t.keySpace}</KeyCap>
                {t.keyTick}
              </span>
              <span className={styles.keyHint}>
                <KeyCap>{t.keyCtrlA}</KeyCap>
                {t.keyAll}
              </span>
            </span>
          }
        >
          <div ref={listBox} className={styles.tableBox} onKeyDown={onListKey}>
            <Table label={t.pendingLabel} columns={columns} rows={rows} rowKey={(r) => String(r.id)} ticked={tickedKeys} empty={t.empty} onRowActivate={tickRow} onRowToggle={tickRow} />
          </div>
          {next && (
            <div className={styles.more}>
              <Button small variant="outline" onClick={() => setLoaded({ key: filtersKey, pages: pages + 1 })}>
                {t.loadMore(count - rows.length)}
              </Button>
            </div>
          )}
        </Card>

        <MemoPanel
          masters={masters.data}
          ticks={ticks}
          filterStation={filterStation}
          onSaved={() => {
            setTicks(new Set());
            filterForm.current?.querySelector<HTMLElement>('input')?.focus();
          }}
          onTaken={(ids) => {
            setTicks((now) => untick(now, ids));
            pending.reload();
          }}
          onOpen={setView}
        />
      </div>
      <Dialog open={view !== null} wide title={t.viewTitle} cancelLabel={t.viewClose} onCancel={() => setView(null)}>
        {view !== null && <MemoView id={view} />}
      </Dialog>
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import type { MastersAll, MemoCursor, MemoFilters, MemoLrRow, PendingPage } from '../../shared';
import { partyFilter, stationFilter, tickAll, toggle, type Box, type Ticks } from '../logic/memoPick';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import KeyCap from '../ui/KeyCap';
import Table, { type Column } from '../ui/Table';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeeperData } from '../useKeeperData';
import { lrColumns } from './columns';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;
const NO_PAGE: PendingPage = { rows: [], next: null, count: 0, qty: 0 };
const noop = () => undefined;
const noBox: Box = { text: '', id: null };

interface Props {
  masters: MastersAll;
  mastersLoaded: boolean;
  /** The keeper's "today" (the newest date a filter may name). */
  today: string;
  /** The oldest booked LR's date, shown in "Booked from" while the box is untouched. */
  oldestPending: string | null;
  ticks: Ticks;
  onTicks: Dispatch<SetStateAction<Ticks>>;
  /** A To station to filter by (a pick from the Dashboard); `onStationUsed` says it has been taken. */
  stationJump?: number | null;
  onStationUsed?: () => void;
  /** The To-station filter as it is now, for the memo panel's To box. */
  onFilterStation?: (station: { id: number; name: string } | null) => void;
  /** Bumped by the page to refetch what is shown (an LR the clerk ticked was taken by another seat). */
  reloadSignal?: number;
}

/**
 * The filter bar and the pending list, with Space / Ctrl+A ticking: the Loading Memo page uses it for a new memo, and a
 * saved memo's "Add LRs" dialog uses it to pick the LRs to add. The filters and the list come from the keeper (100 rows a
 * page, newest answer wins, refetched when any seat changes an LR or a memo); the ticks live in the caller, by LR id, so a
 * filter that hides a ticked LR does not lose it.
 */
export default function PendingPicker({ masters, mastersLoaded, today, oldestPending, ticks, onTicks, stationJump = null, onStationUsed, onFilterStation, reloadSignal = 0 }: Props) {
  const enterToNext = useEnterToNext();
  const listBox = useRef<HTMLDivElement>(null);

  // null in a date box = follows the default (the oldest pending LR, today); "no bound" is what the keeper is told.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [station, setStation] = useState<Box>(noBox);
  const [consignor, setConsignor] = useState<Box>(noBox);
  const [consignee, setConsignee] = useState<Box>(noBox);

  const stationId = stationFilter(station.text, station.id, masters.stations);
  const filters = useMemo<MemoFilters>(
    () => ({
      from,
      to,
      toStationId: stationId,
      consignor: partyFilter(consignor.text, consignor.id, masters.firms),
      consignee: partyFilter(consignee.text, consignee.id, masters.firms),
    }),
    [from, to, stationId, consignor, consignee, masters.firms],
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
  // Effects call these through refs, so they always see the newest closures (and the lint rules about setState in effects stay satisfied).
  const act = useRef<{ reload: () => void; takeStation: () => void }>({ reload: noop, takeStation: noop });
  useEffect(() => {
    act.current = {
      reload: pending.reload,
      takeStation: () => {
        const s = masters.stations.find((x) => x.active && x.id === stationJump);
        if (s) setStation({ text: s.name, id: s.id });
        onStationUsed?.();
      },
    };
  });
  useEffect(() => {
    if (reloadSignal > 0) act.current.reload();
  }, [reloadSignal]);

  // A station picked on the Dashboard sets the To-station filter once the stations are known.
  useEffect(() => {
    if (stationJump !== null && mastersLoaded) act.current.takeStation();
  }, [stationJump, mastersLoaded]);

  const stations = useMemo<Option[]>(() => masters.stations.filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name })), [masters.stations]);
  const firms = useMemo<Option[]>(
    () => masters.firms.filter((f) => f.active).map((f) => ({ id: String(f.id), label: f.name, hint: masters.stations.find((s) => s.id === f.stationId)?.name })),
    [masters.firms, masters.stations],
  );
  const stationName = stationId !== null ? (masters.stations.find((s) => s.id === stationId)?.name ?? '') : '';
  useEffect(() => {
    onFilterStation?.(stationId !== null ? { id: stationId, name: stationName } : null);
    // the callback is a state setter of the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, stationName]);

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
    onTicks(e.shiftKey ? new Set() : tickAll(ticks, rows.map((r) => r.id)));
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
  const tickRow = (r: MemoLrRow) => onTicks((now) => toggle(now, r.id));

  return (
    <>
      <Card className={styles.filters}>
        <form className={styles.filterRow} aria-label={t.filtersLabel} onKeyDown={onFilterKey} onSubmit={(e) => e.preventDefault()} noValidate>
          <Field className={styles.dateBox} label={t.from} type="date" max={today} value={from ?? oldestPending ?? ''} onChange={(e) => setFrom(e.target.value || null)} />
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
    </>
  );
}

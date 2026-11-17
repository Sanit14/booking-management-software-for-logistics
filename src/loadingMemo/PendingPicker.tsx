import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react';
import type { MastersAll, MemoCursor, MemoLrRow, PendingPage, PendingStationCount } from '../../shared';
import {
  NOTHING_PICKED, chipsOf, dropPick, filtersOf, hasPicks, pickName, stationRows, tickAll, toggle, toggleStation, type Picked, type Ticks,
} from '../logic/memoPick';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import { money } from './columns';
import NameSearch from './NameSearch';
import styles from './PendingPicker.module.css';

const t = strings.memo;
const NO_PAGE: PendingPage = { rows: [], next: null, count: 0, qty: 0 };
const NO_STATIONS: PendingStationCount[] = [];
const noop = () => undefined;
const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

interface Props {
  masters: MastersAll;
  ticks: Ticks;
  onTicks: Dispatch<SetStateAction<Ticks>>;
  /** A To station to pick (a pick from the Dashboard); `onStationUsed` says it has been taken. */
  stationJump?: number | null;
  onStationUsed?: () => void;
  /** The filters as they are now (the new memo's To follows a single station). */
  onPicked?: (picked: Picked) => void;
  /** Bumped by the page to refetch what is shown (an LR the clerk ticked was taken by another seat). */
  reloadSignal?: number;
  /** The card at the foot of the right column (the new memo's "Next"). */
  footer?: ReactNode;
  /** The cursor starts on the first station when the page opens, so a clerk can go on by keyboard (the New memo page; not the Add LRs dialog). */
  focusFirst?: boolean;
}

/**
 * The pending LRs and their filters (4.7): the list on the left with Space / Ctrl+A ticking; on the right the filters in use as chips, a tick list of the
 * stations that have pending LRs, a search box each for Consignor and Consignee, and the caller's own card at the foot. Different filters must all match,
 * several values inside one mean any of them (the keeper decides). The list, the station counts and the names come from the keeper (a page of 100, at most 5
 * names), refetched when any seat changes an LR or a memo; the ticks live in the caller, by LR id, so a filter that hides a ticked LR does not lose it.
 */
export default function PendingPicker({ masters, ticks, onTicks, stationJump = null, onStationUsed, onPicked, reloadSignal = 0, footer, focusFirst = false }: Props) {
  const stationBox = useRef<HTMLDivElement>(null);
  const stationTitle = useId();
  const [roving, setRoving] = useState(0); // the one station that takes the Tab stop; the arrow keys move it
  const focused = useRef(false);
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const filters = useMemo(() => filtersOf(picked), [picked]);
  const filtersKey = JSON.stringify(filters);
  const stationName = (id: number) => masters.stations.find((s) => s.id === id)?.name ?? '';

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
  // The station list counts with the Consignor and Consignee filters only: ticking a station does not ask again.
  const nameFilters = JSON.stringify({ c: picked.consignors, e: picked.consignees });
  const stationCounts = useKeeperData<PendingStationCount[]>(() => window.bm.keeper.memos.pendingStations(filters), ['lrs', 'memos'], NO_STATIONS, [nameFilters]).data;
  const stations = useMemo(() => stationRows(stationCounts, picked, stationName), [stationCounts, picked, masters.stations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effects call these through a ref, so they always see the newest closures.
  const act = useRef<{ reload: () => void; takeStation: () => void; told: () => void }>({ reload: noop, takeStation: noop, told: noop });
  useEffect(() => {
    act.current = {
      reload: pending.reload,
      takeStation: () => {
        const s = masters.stations.find((x) => x.active && x.id === stationJump);
        if (s) setPicked((p) => (p.stations.includes(s.id) ? p : toggleStation(p, s.id)));
        onStationUsed?.();
      },
      told: () => onPicked?.(picked),
    };
  });
  useEffect(() => {
    if (reloadSignal > 0) act.current.reload();
  }, [reloadSignal]);
  // A station picked on the Dashboard is ticked once the stations are known.
  useEffect(() => {
    if (stationJump !== null && masters.stations.length > 0) act.current.takeStation();
  }, [stationJump, masters.stations.length]);
  useEffect(() => act.current.told(), [picked]);
  // The first time the stations are there, the cursor goes to the first one (only when asked to: the page, not the Add LRs dialog).
  useEffect(() => {
    if (!focusFirst || focused.current || stations.length === 0) return;
    focused.current = true;
    stationBox.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [focusFirst, stations.length]);

  // The stations are one Tab stop: the arrow keys walk the list (Space ticks, as on any check box).
  const walkStations = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const boxes = [...(stationBox.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
    const at = boxes.indexOf(e.target as HTMLInputElement);
    if (at < 0) return;
    e.preventDefault();
    boxes[Math.max(0, Math.min(boxes.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  // Ctrl+A ticks every row shown, Ctrl+Shift+A takes every tick off (also those a filter hides): anywhere on the page except in a box that has text in it.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyA') return;
    if (e.target instanceof HTMLInputElement && e.target.type === 'text' && e.target.value !== '') return; // there it selects the text
    e.preventDefault();
    onTicks(e.shiftKey ? new Set() : tickAll(ticks, rows.map((r) => r.id)));
  };

  const tickedKeys = useMemo(() => new Set([...ticks].map(String)), [ticks]);
  const columns = useMemo<Column<MemoLrRow>[]>(
    () => [
      {
        key: 'tick',
        header: <span className={styles.hidden}>{t.columns.tick}</span>,
        width: 32,
        render: (r) => <input type="checkbox" className={styles.tick} tabIndex={-1} checked={ticks.has(r.id)} onChange={noop} aria-label={t.tickLabel(r.lrNo)} />,
      },
      { key: 'lr', header: t.columns.lr, width: 48, num: true, render: (r) => r.lrNo },
      { key: 'consignor', header: t.columns.consignor, render: (r) => text(r.consignor) },
      { key: 'consignee', header: t.columns.consignee, render: (r) => text(r.consignee) },
      { key: 'to', header: t.columns.to, width: 74, render: (r) => text(r.toStation) },
      { key: 'qty', header: t.columns.qty, width: 40, num: true, render: (r) => r.qty },
      { key: 'toPay', header: t.columns.toPay, width: 66, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: t.columns.paid, width: 66, num: true, render: (r) => money(r.paidPaise) },
    ],
    [ticks],
  );
  const tickRow = (r: MemoLrRow) => onTicks((now) => toggle(now, r.id));
  const chips = chipsOf(picked, stationName);

  return (
    <div className={styles.picker} onKeyDown={onKeyDown}>
      <Card
        className={styles.listCard}
        title={t.pendingTitle}
        aside={
          <span className={styles.listAside}>
            <span className={styles.tickedTag}>{t.ticked(ticks.size)}</span>
            <span>{t.shownOf(rows.length, count)}</span>
            <Button small variant="outline" title={`${t.tickAll} (${t.keyCtrlA})`} onClick={() => onTicks(tickAll(ticks, rows.map((r) => r.id)))} disabled={rows.length === 0}>
              {t.tickAll}
            </Button>
            <Button small variant="outline" onClick={() => onTicks(new Set())} disabled={ticks.size === 0}>
              {t.untick}
            </Button>
          </span>
        }
      >
        <div className={styles.tableBox}>
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

      <div className={styles.side}>
        <div className={styles.sideScroll}>
          {hasPicks(picked) && (
            <div className={styles.chips} role="group" aria-label={t.filtersInUse}>
              {chips.map((c) => (
                <button key={c.key} type="button" className={styles.chip} aria-label={t.removeFilter(c.label)} title={c.label} onClick={() => setPicked((p) => dropPick(p, c.key))}>
                  <span>{c.label}</span> ×
                </button>
              ))}
              <button type="button" className={styles.clear} aria-label={t.clearLabel} onClick={() => setPicked(NOTHING_PICKED)}>
                {t.clear}
              </button>
            </div>
          )}
          <Card className={styles.group}>
            <div className={styles.groupTitle} id={stationTitle}>
              {t.station}
            </div>
            <div ref={stationBox} role="group" aria-labelledby={stationTitle} onKeyDown={walkStations}>
              {stations.map((s, i) => (
                <label key={s.stationId} className={styles.stationRow}>
                  <input type="checkbox" tabIndex={i === Math.min(roving, stations.length - 1) ? 0 : -1} onFocus={() => setRoving(i)} checked={s.on} onChange={() => setPicked((p) => toggleStation(p, s.stationId))} />
                  <span className={styles.stationName} title={s.station}>
                    {s.station}
                  </span>
                  <span className={styles.count}>{s.lrs}</span>
                </label>
              ))}
            </div>
          </Card>
          <NameSearch side="consignor" label={t.consignor} filters={filters} onPick={(n) => setPicked((p) => pickName(p, 'consignor', n))} />
          <NameSearch side="consignee" label={t.consignee} filters={filters} onPick={(n) => setPicked((p) => pickName(p, 'consignee', n))} />
        </div>
        {footer}
      </div>
    </div>
  );
}

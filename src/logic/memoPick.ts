// Ticking pending LRs and turning what the clerk picked into what the keeper is asked. Pure: no keeper, no React.
import type { MemoFilters, NameKey, PendingStationCount, Station } from '../../shared';
import { matchKey } from './typeAhead';

/** The ticked LRs by id, in the order they were ticked. An LR that a filter hides stays ticked (and stays counted by the keeper). */
export type Ticks = ReadonlySet<number>;

/** What a TypeAhead box holds: the text, and the master row it was picked as. */
export interface Box {
  text: string;
  id: number | null;
}

/** Tick the LR, or untick it when it is ticked. */
export function toggle(ticks: Ticks, id: number): Ticks {
  const next = new Set(ticks);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Tick every LR given (the rows shown); those already ticked stay where they are. */
export function tickAll(ticks: Ticks, ids: number[]): Ticks {
  return new Set([...ticks, ...ids]);
}

/** Take the ids off (the LRs another seat got first). */
export function untick(ticks: Ticks, ids: number[]): Ticks {
  const next = new Set(ticks);
  for (const id of ids) next.delete(id);
  return next;
}

/** The To-station box: the station picked, else a name typed in full that is exactly an open station; otherwise no filter yet. */
export function stationFilter(text: string, pickedId: number | null, stations: Station[]): number | null {
  const typed = text.trim();
  if (typed === '') return null;
  return pickedId ?? stations.find((s) => s.active && matchKey(s.name) === matchKey(typed))?.id ?? null;
}

// ---- the filters of the New memo page (4.7) ----

export type Side = 'consignor' | 'consignee';

/** What the clerk picked: stations by id, names as the keeper offered them (a firm keeps its master name for the chip; the keeper reads only its id). */
export interface Picked {
  stations: number[];
  consignors: NameKey[];
  consignees: NameKey[];
}
export const NOTHING_PICKED: Picked = { stations: [], consignors: [], consignees: [] };

/** Which name it is: a master firm by id, a walk-in by the text it was booked with. */
const identity = (n: NameKey): string => (n.firmId !== null ? `f${n.firmId}` : `w${n.name}`);
const listOf = (side: Side): 'consignors' | 'consignees' => (side === 'consignor' ? 'consignors' : 'consignees');

/** Tick the station, or take it off. */
export function toggleStation(p: Picked, id: number): Picked {
  return { ...p, stations: p.stations.includes(id) ? p.stations.filter((s) => s !== id) : [...p.stations, id] };
}

/** Add the name to its filter (once). */
export function pickName(p: Picked, side: Side, name: NameKey): Picked {
  const list = p[listOf(side)];
  return list.some((n) => identity(n) === identity(name)) ? p : { ...p, [listOf(side)]: [...list, name] };
}

/** One chip on top of the filters: what it says, and the key `dropPick` takes it off with. */
export interface PickChip {
  key: string;
  label: string;
}

/** The filters in use, in the order they sit on the page: stations, consignors, consignees. */
export function chipsOf(p: Picked, stationName: (id: number) => string): PickChip[] {
  return [
    ...p.stations.map((id) => ({ key: `s${id}`, label: stationName(id) })),
    ...p.consignors.map((n) => ({ key: `c${identity(n)}`, label: n.name })),
    ...p.consignees.map((n) => ({ key: `e${identity(n)}`, label: n.name })),
  ];
}

/** Take one chip off. */
export function dropPick(p: Picked, key: string): Picked {
  return {
    stations: p.stations.filter((id) => `s${id}` !== key),
    consignors: p.consignors.filter((n) => `c${identity(n)}` !== key),
    consignees: p.consignees.filter((n) => `e${identity(n)}` !== key),
  };
}

export const hasPicks = (p: Picked): boolean => p.stations.length + p.consignors.length + p.consignees.length > 0;

/** What the keeper is asked: the picks as they are (AND between filters, OR inside one is the keeper's rule). */
export const filtersOf = (p: Picked): MemoFilters => ({ toStationIds: p.stations, consignors: p.consignors, consignees: p.consignees });

/** The memo's To station when exactly one station is filtered; with none or several the clerk picks it. */
export const onlyStation = (p: Picked): number | null => (p.stations.length === 1 ? p.stations[0] : null);

/** One row of the station tick list. */
export interface StationRow {
  stationId: number;
  station: string;
  lrs: number;
  on: boolean;
}

/** The keeper's stations with their counts, and a ticked station the other filters left with none shown too (0), so it can be unticked. */
export function stationRows(counts: PendingStationCount[], p: Picked, stationName: (id: number) => string): StationRow[] {
  const rows = counts.map((c) => ({ stationId: c.stationId, station: c.station, lrs: c.lrs, on: p.stations.includes(c.stationId) }));
  for (const id of p.stations) if (!counts.some((c) => c.stationId === id)) rows.push({ stationId: id, station: stationName(id), lrs: 0, on: true });
  return rows;
}

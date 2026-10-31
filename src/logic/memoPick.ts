// Ticking pending LRs and turning the filter boxes into what the keeper is asked. Pure: no keeper, no React.
import type { Firm, PartyFilter, Station } from '../../shared';
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

/**
 * A Consignor / Consignee box: the firm picked, else a name typed in full that is exactly an active firm (its id is the
 * exact filter), else the text as it is (the keeper matches any part of the name an LR was booked with); nothing typed is no filter.
 */
export function partyFilter(text: string, pickedId: number | null, firms: Firm[]): PartyFilter | null {
  const typed = text.trim();
  if (typed === '') return null;
  return { firmId: pickedId ?? firms.find((f) => f.active && matchKey(f.name) === matchKey(typed))?.id ?? null, text: typed };
}

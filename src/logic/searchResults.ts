// The search results as one list the keyboard can walk, and where each pick leads. Pure: the screen draws the rows.
import type { SearchAnswer, SearchFirm, SearchLr, SearchMemo, SearchStation, SearchTruck } from '../../shared';

/**
 * Where a pick goes: an LR opens in LR Entry; a master row is selected on its Masters tab; a challan opens read-only on the
 * Loading Memo page. `pending` is not a search pick: the Dashboard's station row opens that page with the To-station filter set.
 */
export type Jump =
  | { to: 'lr'; id: number }
  | { to: 'master'; kind: 'firms' | 'trucks' | 'stations'; id: number }
  | { to: 'memo'; id: number }
  | { to: 'pending'; stationId: number };

interface Base {
  /** Unique within one answer (a firm and a station may share an id). */
  key: string;
  jump: Jump;
}
export type Row =
  | (Base & { group: 'lr'; item: SearchLr })
  | (Base & { group: 'memo'; item: SearchMemo })
  | (Base & { group: 'firm'; item: SearchFirm })
  | (Base & { group: 'truck'; item: SearchTruck })
  | (Base & { group: 'station'; item: SearchStation });

/**
 * LR, challan, firm, truck, station, in that order, each group as the keeper sent it. The LR comes before the challan so that
 * a number typed and Enter keeps opening the LR; the challan is one row down.
 */
export function flatten(a: SearchAnswer): Row[] {
  return [
    ...a.lrs.map((item): Row => ({ group: 'lr', key: `lr${item.id}`, jump: { to: 'lr', id: item.id }, item })),
    ...a.memos.map((item): Row => ({ group: 'memo', key: `memo${item.id}`, jump: { to: 'memo', id: item.id }, item })),
    ...a.firms.map((item): Row => ({ group: 'firm', key: `firm${item.id}`, jump: { to: 'master', kind: 'firms', id: item.id }, item })),
    ...a.trucks.map((item): Row => ({ group: 'truck', key: `truck${item.id}`, jump: { to: 'master', kind: 'trucks', id: item.id }, item })),
    ...a.stations.map((item): Row => ({ group: 'station', key: `station${item.id}`, jump: { to: 'master', kind: 'stations', id: item.id }, item })),
  ];
}

/** The highlighted row after Down (+1) or Up (-1), wrapping round; -1 means nothing is highlighted yet. */
export function move(index: number, step: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (index < 0) return step === 1 ? 0 : count - 1;
  return (index + step + count) % count;
}

// The search results as one list the keyboard can walk, and where each pick leads. Pure: the screen draws the rows.
import type { SearchAnswer, SearchFirm, SearchLr, SearchStation, SearchTruck } from '../../shared';

/** Where a pick goes: an LR opens in LR Entry; a master row is selected on its Masters tab. */
export type Jump = { to: 'lr'; id: number } | { to: 'master'; kind: 'firms' | 'trucks' | 'stations'; id: number };

interface Base {
  /** Unique within one answer (a firm and a station may share an id). */
  key: string;
  jump: Jump;
}
export type Row =
  | (Base & { group: 'lr'; item: SearchLr })
  | (Base & { group: 'firm'; item: SearchFirm })
  | (Base & { group: 'truck'; item: SearchTruck })
  | (Base & { group: 'station'; item: SearchStation });

/** LR, firm, truck, station, in that order, each group as the keeper sent it. */
export function flatten(a: SearchAnswer): Row[] {
  return [
    ...a.lrs.map((item): Row => ({ group: 'lr', key: `lr${item.id}`, jump: { to: 'lr', id: item.id }, item })),
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

// What the Wasuli page does with a row, decided without the keeper or React. Pure: tested with node:test.
import type { WasuliRow, WasuliSeen } from '../../shared';
import { matchKey } from './typeAhead';

/** The row as the screen saw it: a change is applied only while the keeper's row is still exactly so. */
export const seenOf = (r: WasuliRow): WasuliSeen => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });

/** `collect` = open the collect dialog; anything else is a reason to tell the clerk (with the row, for the agent's name). */
export type QuickOutcome = 'collect' | 'collected' | 'unassigned' | 'otherAgent';

/** The LR number typed in the quick-collect box found this row: can it be collected for the agent picked? */
export function quickOutcome(row: WasuliRow, agentId: number | null): QuickOutcome {
  if (row.status === 'collected') return 'collected';
  if (row.status === 'unassigned') return 'unassigned';
  return row.agentId === agentId ? 'collect' : 'otherAgent';
}

/** The agent shown in the picker: the one picked or typed in full, else (nothing touched yet) the first active one. */
export function agentChoice(box: { text: string; id: number | null } | null, agents: { id: number; name: string }[]): { id: number; name: string } | null {
  if (box === null) return agents[0] ?? null;
  const typed = box.text.trim();
  if (typed === '') return null;
  return agents.find((a) => a.id === box.id) ?? agents.find((a) => matchKey(a.name) === matchKey(typed)) ?? null;
}

// Which charge boxes follow the charge option and which the clerk has taken over by typing (DM's `manualFields`).
// The amounts themselves come from the keeper (lrs.preview); this only decides which box takes them.
import type { ChargeDefaults } from '../../shared';
import { paiseToField } from './rupees';

export const CHARGE_KEYS = ['godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali'] as const;
export type ChargeKey = (typeof CHARGE_KEYS)[number];
export type ChargeTexts = Record<ChargeKey, string>;

/** The boxes after the keeper's defaults arrive: a box the clerk typed in keeps its text, the others show the default. */
export function applyDefaults(current: ChargeTexts, manual: ReadonlySet<ChargeKey>, defaults: ChargeDefaults): ChargeTexts {
  const next = { ...current };
  for (const k of CHARGE_KEYS) if (!manual.has(k)) next[k] = paiseToField(defaults[k]);
  return next;
}

/** A charge box was typed in: it is the clerk's now. (Emptying it mid-edit changes nothing yet: see `releaseIfEmpty`.) */
export function markManual(manual: ReadonlySet<ChargeKey>, key: ChargeKey, text: string): Set<ChargeKey> {
  const next = new Set(manual);
  if (text.trim() !== '') next.add(key);
  return next;
}

/** The clerk left a charge box and it is empty: hand it back to the charge option. */
export function releaseIfEmpty(manual: ReadonlySet<ChargeKey>, key: ChargeKey, text: string): Set<ChargeKey> {
  const next = new Set(manual);
  if (text.trim() === '') next.delete(key);
  return next;
}

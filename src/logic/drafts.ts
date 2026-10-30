// A half-typed LR that survives a trip to another page. Screen memory only: a draft is not a booking, so it is not
// in the database and does not outlive the app. One per form (LR Entry, Quick LR); an LR opened for edit is never one.
import type { LrFormState } from './lrOpen';

export type DraftSlot = 'lrEntry' | 'quick';
export interface Draft {
  state: LrFormState;
  /** The save's uid travels with the draft, so a retry of the same save is still the same save. */
  uid: string;
}

const drafts = new Map<DraftSlot, Draft>();

/** True when the clerk typed something: From station, the charge option and the tax % are only what a new form starts from. */
export const hasTyped = (s: LrFormState) =>
  [s.consignor.text, s.consignee.text, s.to.text, s.particular, s.qty, s.toPay, s.paid].some((v) => v.trim() !== '');

/** Remembers the form while something is typed in it; an emptied form leaves no draft. */
export function keepDraft(slot: DraftSlot, draft: Draft): void {
  if (hasTyped(draft.state)) drafts.set(slot, draft);
  else drafts.delete(slot);
}

export const loadDraft = (slot: DraftSlot): Draft | undefined => drafts.get(slot);

/** An LR was saved, or New LR was pressed. */
export const clearDraft = (slot: DraftSlot): void => void drafts.delete(slot);

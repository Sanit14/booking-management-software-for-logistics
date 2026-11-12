// A saved LR as the boxes of the form. Display only: the keeper's paise become the text a clerk would type, nothing is added up.
import type { LrDetail } from '../../shared';
import { paiseToField } from './rupees';

export interface Typed {
  text: string;
  id: number | null;
}
export interface Party {
  text: string;
  firmId: number | null;
  add: boolean;
}

/** Every box of the LR form, as typed. */
export interface LrFormState {
  from: Typed;
  to: Typed;
  consignor: Party;
  consignee: Party;
  particular: string;
  qty: string;
  toPay: string;
  paid: string;
  hamali: string;
  wasuli: string;
}

/** `2026-10-29` -> `29-10-2026`, the way dates are shown. */
export const isoToDisplay = (iso: string) => iso.split('-').reverse().join('-');

export function formFromLr(lr: LrDetail, stationName: (id: number) => string): LrFormState {
  return {
    from: { text: stationName(lr.fromStationId), id: lr.fromStationId },
    to: { text: stationName(lr.toStationId), id: lr.toStationId },
    consignor: { text: lr.consignor, firmId: lr.consignorId, add: false },
    consignee: { text: lr.consignee, firmId: lr.consigneeId, add: false },
    particular: lr.particular,
    qty: String(lr.qty),
    toPay: paiseToField(lr.toPayPaise),
    paid: paiseToField(lr.paidPaise),
    hamali: paiseToField(lr.hamaliPaise),
    wasuli: paiseToField(lr.wasuliPaise),
  };
}

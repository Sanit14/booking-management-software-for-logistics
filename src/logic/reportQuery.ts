// What the Reports screen asks the keeper for. Pure: the dates come from the keeper PC's today (the screen reads no clock of its own),
// and the keeper still checks every period and filter and adds up every figure — nothing here is a business rule.
import { REPORT_FILTERS, type FirmRange, type ReportKind, type ReportQuery } from '../../shared';
import { isRange, periodOf, type Preset } from './firmPeriod';

/** What the clerk chose on the Reports page: which report, the period, the filter boxes (as typed / picked). */
export interface ReportsView {
  kind: ReportKind;
  preset: Preset | 'custom';
  from: string;
  to: string;
  /** Picked values are ids as text; '' = "All". */
  toStationId: string;
  text: string;
  truckId: string;
  agentId: string;
}

export const START_VIEW: ReportsView = { kind: 'dateWise', preset: 'month', from: '', to: '', toStationId: '', text: '', truckId: '', agentId: '' };

/** The period a view means on `today`. A custom period is whatever was typed (check it with `isRange`). */
export const periodFor = (v: ReportsView, today: string): FirmRange => (v.preset === 'custom' ? { from: v.from, to: v.to } : periodOf(v.preset, today));

const id = (text: string): number | null => (/^\d+$/.test(text) && Number(text) >= 1 ? Number(text) : null);

/** The request for a view, or null while a custom period is not two real days in order. `typed` is the text box after its short wait. */
export function queryOf(v: ReportsView, today: string, typed: string): ReportQuery | null {
  const range = periodFor(v, today);
  if (!isRange(range.from, range.to)) return null;
  const uses = REPORT_FILTERS[v.kind];
  return {
    ...range,
    toStationId: uses.includes('toStationId') ? id(v.toStationId) : null,
    text: uses.includes('text') ? typed.trim() : '',
    truckId: uses.includes('truckId') ? id(v.truckId) : null,
    agentId: uses.includes('agentId') ? id(v.agentId) : null,
  };
}

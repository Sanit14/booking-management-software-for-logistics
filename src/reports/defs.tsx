// The seven reports as the screen draws them: how to ask the keeper, the columns, the totals strip, and where a click on a row leads.
// Every figure arrives added up by the keeper; this file only formats it (two-line cells keep 9 columns inside the 788 px of the page:
// a cell shows the figures it was sent, never a sum of them).
import type {
  KeeperResult, ReportAgentRow, ReportAgentTotals, ReportCursor, ReportDateRow, ReportFirmRow, ReportFirmTotals, ReportKind, ReportLrsFor, ReportMoney, ReportPage, ReportPartyRow,
  ReportQuery, ReportStationRow, ReportTruckRow, ReportTruckTotals, ReportWithWasuli,
} from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import { rupees } from '../loadingMemo/columns';
import { strings } from '../strings';
import Chip from '../ui/Chip';
import type { Column } from '../ui/Table';
import styles from './ReportsPage.module.css';

const c = strings.reports.columns;
/** An amount, or a dash when a row has none of it. */
export const money = (paise: number) => (paise > 0 ? rupees(paise) : '–');
const cell = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);
/** A figure with a small line under it. */
const two = (main: string, sub: string) => (
  <>
    {main}
    <span className={styles.sub}>{sub}</span>
  </>
);

/** Where a click on a row leads: another page (a `Jump`), or the list of the row's LRs. */
export type Action = { jump: Jump } | { drill: { of: ReportLrsFor; title: string } };

export interface Def {
  read: (query: ReportQuery, cursor: ReportCursor | null) => Promise<KeeperResult<ReportPage<unknown, unknown>>>;
  columns: Column<unknown>[];
  rowKey: (row: unknown) => string;
  /** The totals strip's amounts, in the order of `strings.paper.report.kinds[kind].totals`. */
  totals: (totals: unknown) => string[];
  /** What a click or Enter on a row does; absent = the rows are not clickable. */
  open?: (row: unknown, query: ReportQuery) => Action;
}

/** Fixes the row and totals types of one report, then forgets them: the page treats all seven alike. */
function def<R, T>(d: {
  read: (query: ReportQuery, cursor: ReportCursor | null) => Promise<KeeperResult<ReportPage<R, T>>>;
  columns: Column<R>[];
  rowKey: (row: R) => string;
  totals: (totals: T) => string[];
  open?: (row: R, query: ReportQuery) => Action;
}): Def {
  return d as unknown as Def;
}

const counts = (t: { lrs: number; qty: number }) => [String(t.lrs), String(t.qty)];

export const DEFS: Record<ReportKind, Def> = {
  dateWise: def<ReportDateRow, ReportMoney>({
    read: (q, cursor) => window.bm.keeper.reports.dateWise(q, cursor),
    columns: [
      { key: 'date', header: c.date, width: 112, render: (r) => isoToDisplay(r.date) },
      { key: 'lrs', header: c.lrs, width: 52, num: true, render: (r) => r.lrs },
      { key: 'qty', header: c.qty, width: 60, num: true, render: (r) => r.qty },
      { key: 'toPay', header: c.toPay, width: 136, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: c.paid, width: 136, num: true, render: (r) => money(r.paidPaise) },
      { key: 'hamali', header: c.lrHamali, width: 112, num: true, render: (r) => money(r.hamaliPaise) },
      { key: 'total', header: c.total, width: 148, num: true, render: (r) => rupees(r.totalPaise) },
    ],
    rowKey: (r) => r.date,
    totals: (t) => [...counts(t), rupees(t.toPayPaise), rupees(t.paidPaise), rupees(t.hamaliPaise), rupees(t.totalPaise)],
    open: (r) => ({ jump: { to: 'day', date: r.date } }),
  }),

  stationWise: def<ReportStationRow, ReportWithWasuli>({
    read: (q, cursor) => window.bm.keeper.reports.stationWise(q, cursor),
    columns: [
      { key: 'station', header: c.toStation, render: (r) => cell(r.station) },
      { key: 'lrs', header: c.lrs, width: 60, num: true, render: (r) => r.lrs },
      { key: 'qty', header: c.qty, width: 64, num: true, render: (r) => r.qty },
      { key: 'toPay', header: c.toPay, width: 150, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: c.paid, width: 150, num: true, render: (r) => money(r.paidPaise) },
      { key: 'wasuli', header: c.wasuli, width: 130, num: true, render: (r) => money(r.wasuliPaise) },
    ],
    rowKey: (r) => String(r.stationId),
    totals: (t) => [...counts(t), rupees(t.toPayPaise), rupees(t.paidPaise), rupees(t.wasuliPaise)],
    open: (r) => ({ drill: { of: { kind: 'stationWise', stationId: r.stationId }, title: r.station } }),
  }),

  consignorWise: party('consignor'),
  consigneeWise: party('consignee'),

  truckWise: def<ReportTruckRow, ReportTruckTotals>({
    read: (q, cursor) => window.bm.keeper.reports.truckWise(q, cursor),
    columns: [
      {
        key: 'memo',
        header: c.memo,
        width: 124,
        render: (r) => (
          <>
            <span className={styles.memoNo}>
              {r.challanNo}
              {r.differs && <Chip kind="differs" />}
            </span>
            <span className={styles.sub}>{isoToDisplay(r.date)}</span>
          </>
        ),
      },
      { key: 'truck', header: c.truck, render: (r) => two(r.truck, `→ ${r.toStation}`) },
      { key: 'lrs', header: c.lrs, width: 56, num: true, render: (r) => r.lrs },
      { key: 'toPay', header: c.toPay, width: 122, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: c.paid, width: 122, num: true, render: (r) => money(r.paidPaise) },
      { key: 'hire', header: c.hire, width: 140, num: true, render: (r) => two(money(r.truckHirePaise), `${c.hamali} ${money(r.loadingHamaliPaise)}`) },
    ],
    rowKey: (r) => String(r.memoId),
    totals: (t) => [String(t.memos), String(t.lrs), rupees(t.toPayPaise), rupees(t.paidPaise), rupees(t.truckHirePaise), rupees(t.loadingHamaliPaise)],
    open: (r) => ({ jump: { to: 'memo', id: r.memoId } }),
  }),

  firmWise: def<ReportFirmRow, ReportFirmTotals>({
    read: (q, cursor) => window.bm.keeper.reports.firmWise(q, cursor),
    columns: [
      { key: 'firm', header: c.firm, render: (r) => cell(r.name) },
      { key: 'asConsignor', header: c.asConsignor, width: 112, num: true, render: (r) => r.asConsignor },
      { key: 'asConsignee', header: c.asConsignee, width: 112, num: true, render: (r) => r.asConsignee },
      { key: 'qty', header: c.qty, width: 64, num: true, render: (r) => r.qty },
      { key: 'toPay', header: c.toPay, width: 150, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: c.paid, width: 150, num: true, render: (r) => money(r.paidPaise) },
    ],
    rowKey: (r) => String(r.firmId),
    totals: (t) => [String(t.firms), String(t.asConsignor), String(t.asConsignee), String(t.walkInConsignor), String(t.walkInConsignee)],
    // the firm's own account for this period (opened as Custom dates)
    open: (r, q) => ({ jump: { to: 'account', id: r.firmId, from: q.from, until: q.to } }),
  }),

  wasuli: def<ReportAgentRow, ReportAgentTotals>({
    read: (q, cursor) => window.bm.keeper.reports.wasuli(q, cursor),
    columns: [
      { key: 'agent', header: c.agent, render: (r) => cell(r.agent) },
      { key: 'assignedCount', header: c.assigned, width: 96, num: true, render: (r) => r.assignedCount },
      { key: 'assigned', header: c.amount, width: 150, num: true, render: (r) => money(r.assignedPaise) },
      { key: 'collectedCount', header: c.collected, width: 100, num: true, render: (r) => r.collectedCount },
      { key: 'collected', header: c.amount, width: 150, num: true, render: (r) => money(r.collectedPaise) },
    ],
    rowKey: (r) => String(r.agentId),
    totals: (t) => [String(t.assignedCount), rupees(t.assignedPaise), String(t.collectedCount), rupees(t.collectedPaise), String(t.poolCount), rupees(t.poolPaise)],
  }),
};

/** Consignor- and Consignee-wise are one layout: the party, its station under it, then the figures. */
function party(side: 'consignor' | 'consignee'): Def {
  return def<ReportPartyRow, ReportWithWasuli>({
    read: (q, cursor) => window.bm.keeper.reports.partyWise(side, q, cursor),
    columns: [
      { key: 'name', header: side === 'consignor' ? c.consignor : c.consignee, render: (r) => two(r.name, r.station ?? (r.firmId === null ? strings.reports.walkIn : '')) },
      { key: 'lrs', header: c.lrs, width: 60, num: true, render: (r) => r.lrs },
      { key: 'qty', header: c.qty, width: 64, num: true, render: (r) => r.qty },
      { key: 'toPay', header: c.toPay, width: 150, num: true, render: (r) => money(r.toPayPaise) },
      { key: 'paid', header: c.paid, width: 150, num: true, render: (r) => money(r.paidPaise) },
      { key: 'wasuli', header: c.wasuli, width: 130, num: true, render: (r) => money(r.wasuliPaise) },
    ],
    // a firm is found by its id; a walk-in by its name as booked
    rowKey: (r) => (r.firmId === null ? `w:${r.name.replace(/[A-Z]/g, (c) => c.toLowerCase())}` : String(r.firmId)),
    totals: (t) => [...counts(t), rupees(t.toPayPaise), rupees(t.paidPaise), rupees(t.wasuliPaise)],
    open: (r) => ({ drill: { of: { kind: side === 'consignor' ? 'consignorWise' : 'consigneeWise', firmId: r.firmId, name: r.firmId === null ? r.name : '' }, title: r.name } }),
  });
}

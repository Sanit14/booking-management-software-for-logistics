// The Dashboard's counts. Reads only, counts only: no statement here selects an amount. Every statement is answered
// from an index (checked with EXPLAIN QUERY PLAN in dashboard.dbtest.ts), so it stays quick as the LRs pile up.
import type { DashboardSummary, KeeperResult, PendingStation, RecentLr } from '../shared';
import type { Db } from './db';
import { isDate, localDate } from './lrRules';

const PENDING_LIMIT = 20;
const RECENT_LIMIT = 8;

export const DASHBOARD_SQL = {
  // One statement of subqueries. "LRs today" is booked + loaded; cancelled is counted apart and left out of the quantity.
  // Pending is every booked LR whatever its date. The memo counts are 0 until memos exist (3.1) and are ready for them.
  summary: `SELECT
      (SELECT COUNT(*) FROM lrs WHERE lr_date = @d AND status = 'booked') AS booked,
      (SELECT COUNT(*) FROM lrs WHERE lr_date = @d AND status = 'loaded') AS loaded,
      (SELECT COUNT(*) FROM lrs WHERE lr_date = @d AND status = 'cancelled') AS cancelled,
      (SELECT COALESCE(SUM(qty), 0) FROM lrs WHERE lr_date = @d AND status != 'cancelled') AS qty,
      (SELECT COUNT(*) FROM lrs WHERE status = 'booked') AS pending,
      (SELECT COALESCE(SUM(qty), 0) FROM lrs WHERE status = 'booked') AS pendingQty,
      (SELECT MIN(lr_date) FROM lrs WHERE status = 'booked') AS oldestPending,
      (SELECT COUNT(DISTINCT to_station_id) FROM lrs WHERE status = 'booked') AS pendingStations,
      (SELECT COUNT(*) FROM memos WHERE memo_date = @d AND status = 'saved') AS memos,
      (SELECT COUNT(DISTINCT truck_id) FROM memos WHERE memo_date = @d AND status = 'saved') AS trucksOut`,
  pending: `SELECT l.to_station_id AS stationId, s.name AS station, COUNT(*) AS lrs, SUM(l.qty) AS qty
      FROM lrs l JOIN stations s ON s.id = l.to_station_id
      WHERE l.status = 'booked'
      GROUP BY l.to_station_id ORDER BY lrs DESC, s.name_key LIMIT ${PENDING_LIMIT}`,
  recent: `SELECT l.id, l.lr_no AS lrNo, l.consignee_name AS consignee, s.name AS toStation, l.status
      FROM lrs l JOIN stations s ON s.id = l.to_station_id
      WHERE l.lr_date = @d ORDER BY l.lr_year DESC, l.lr_no DESC LIMIT ${RECENT_LIMIT}`,
};

export function makeDashboard(now: () => Date = () => new Date()) {
  /** The day asked for; today (the keeper PC's date) when none, or not a date. */
  const dayOf = (date: string | null) => (date !== null && isDate(date) ? date : localDate(now()));

  return {
    summary(db: Db, date: string | null): KeeperResult<DashboardSummary> {
      const d = dayOf(date);
      const row = db.prepare(DASHBOARD_SQL.summary).get({ d }) as Omit<DashboardSummary, 'date'>;
      return { ok: true, value: { date: d, ...row } };
    },

    /** Booked LRs per To station, most first (then by name), at most 20. */
    pendingByStation(db: Db): KeeperResult<PendingStation[]> {
      return { ok: true, value: db.prepare(DASHBOARD_SQL.pending).all() as PendingStation[] };
    },

    /** The newest 8 LRs of today, cancelled ones included (they show their status). */
    recentLrs(db: Db): KeeperResult<RecentLr[]> {
      return { ok: true, value: db.prepare(DASHBOARD_SQL.recent).all({ d: dayOf(null) }) as RecentLr[] };
    },
  };
}

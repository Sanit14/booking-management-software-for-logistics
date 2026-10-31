// Loading memos (challans): the number, the claim on the LRs and the frozen totals all happen here, inside ONE
// IMMEDIATE transaction per save. The screen sends what was ticked and typed (money as text) and gets the saved memo
// back; it never adds anything up. An LR can only be loaded while it is booked, and the claim is a single UPDATE that
// must change every ticked LR: if another seat got one first, the whole save is rolled back (no number used) and the
// answer names the LR, the challan it went on and the truck.
import {
  MAX_MEMO_LRS,
  type KeeperResult, type MemoCursor, type MemoDefaults, type MemoDetail, type MemoFilters, type MemoInput, type MemoListRow, type MemoLrRow, type MemoSaved, type MemoTaken,
  type PendingPage, type PendingTotals, type ResultCode,
} from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { isDate, localDate } from './lrRules';
import { cleanMemo, type MemoErrors } from './memoRules';
import { nextNumber } from './numbering';
import type { makePins } from './pins';

type Refusal = Extract<KeeperResult<never>, { ok: false }>;
const refuse = (code: ResultCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });
const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });
/** Thrown inside the transaction so everything written so far is rolled back; caught right outside it. */
class Stop extends Error {
  constructor(readonly refusal: Refusal) {
    super('refused');
  }
}

const PAGE = 100;
const DAY_LIMIT = 200;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const marks = (ids: number[]): string => ids.map(() => '?').join(', ');

const LR_COLUMNS = `l.id, l.lr_no AS lrNo, l.lr_date AS date, l.consignor_name AS consignor, l.consignee_name AS consignee, s.name AS toStation,
  l.qty, l.topay_paise AS toPayPaise, l.paid_paise AS paidPaise`;
const MEMO_ROW = `SELECT m.id, m.challan_year AS challanYear, m.challan_no AS challanNo, m.memo_date AS date, t.number AS truck, s.name AS toStation,
  m.frozen_lr_count AS lrCount, m.status
  FROM memos m JOIN trucks t ON t.id = m.truck_id JOIN stations s ON s.id = m.to_station_id`;

const DETAIL = `SELECT m.id, m.challan_year AS challanYear, m.challan_no AS challanNo, m.memo_date AS date, m.status, m.frozen_lr_count AS lrCount, m.version,
  m.truck_id AS truckId, t.number AS truck, m.driver_id AS driverId, d.name AS driver,
  m.from_station_id AS fromStationId, fs.name AS fromStation, m.to_station_id AS toStationId, ts.name AS toStation,
  m.truck_hire_paise AS truckHirePaise, m.loading_hamali_paise AS loadingHamaliPaise,
  m.frozen_qty AS fQty, m.frozen_topay_paise AS fToPay, m.frozen_paid_paise AS fPaid, m.frozen_charges_paise AS fCharges, m.frozen_stax_paise AS fStax
  FROM memos m JOIN trucks t ON t.id = m.truck_id JOIN drivers d ON d.id = m.driver_id
  JOIN stations fs ON fs.id = m.from_station_id JOIN stations ts ON ts.id = m.to_station_id`;
type DetailRow = Omit<MemoDetail, 'frozen' | 'lrs'> & { fQty: number; fToPay: number; fPaid: number; fCharges: number; fStax: number };

/**
 * The pending list's SQL, built from fixed pieces: only values are bound, a column name never comes from the request.
 * `rows` is one page after the cursor (one row over, to know there is a next page); `count` is the whole filter.
 * A firm filter is the LR's firm id; typed text is any part of the name the LR was booked with, a firm's or a walk-in's
 * (ASCII case ignored), so a name typed without picking it, or a firm closed since, still finds its LRs.
 */
export function pendingSql(f: MemoFilters, afterCursor: boolean) {
  const parts = ["l.status = 'booked'"];
  const args: Record<string, string | number> = {};
  if (f.from) {
    parts.push('l.lr_date >= @from');
    args.from = f.from;
  }
  if (f.to) {
    parts.push('l.lr_date <= @to');
    args.to = f.to;
  }
  if (f.toStationId !== null) {
    parts.push('l.to_station_id = @station');
    args.station = f.toStationId;
  }
  for (const [who, p] of [['consignor', f.consignor], ['consignee', f.consignee]] as const) {
    if (!p) continue;
    if (p.firmId !== null) {
      parts.push(`l.${who}_id = @${who}`);
      args[who] = p.firmId;
    } else {
      parts.push(`instr(lower(l.${who}_name), @${who}) > 0`);
      args[who] = p.text.replace(/[A-Z]/g, (c) => c.toLowerCase()); // SQLite's lower() is ASCII only
    }
  }
  const where = parts.join(' AND ');
  return {
    args,
    rows: `SELECT ${LR_COLUMNS} FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE ${where}${afterCursor ? ' AND (l.lr_date, l.lr_no) > (@cd, @cn)' : ''}
      ORDER BY l.lr_date, l.lr_no LIMIT ${PAGE + 1}`,
    count: `SELECT COUNT(*) AS count, COALESCE(SUM(l.qty), 0) AS qty FROM lrs l WHERE ${where}`,
  };
}

/** The totals frozen onto a memo, from the LRs now on it. `stax` is the SQL twin of `taxPaise` per LR (round half up), summed. */
export const FROZEN_SQL = `SELECT COUNT(*) AS lrs, COALESCE(SUM(qty), 0) AS qty,
    COALESCE(SUM(topay_paise), 0) AS toPayPaise, COALESCE(SUM(paid_paise), 0) AS paidPaise,
    COALESCE(SUM(godown_bhada_paise + godown_insurance_paise + delivery_charges_paise + hamali_paise + pf_paise), 0) AS chargesPaise,
    COALESCE(SUM(((topay_paise + paid_paise) * stax_bp + 5000) / 10000), 0) AS staxPaise
  FROM lrs WHERE memo_id = ?`;

type Frozen = MemoDetail['frozen'];

const TOTALS_SQL = `SELECT COUNT(*) AS lrs, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(topay_paise), 0) AS toPayPaise, COALESCE(SUM(paid_paise), 0) AS paidPaise
  FROM lrs WHERE status = 'booked' AND id IN`;

export function makeMemos(pins: Pick<ReturnType<typeof makePins>, 'verify'>, now: () => Date = () => new Date()) {
  const rowOf = (db: Db, id: number): MemoListRow => db.prepare(`${MEMO_ROW} WHERE m.id = ?`).get(id) as MemoListRow;

  /** The LRs that were ticked but are not booked any more (and not on the memo being saved): what to tell the clerk. */
  const takenOf = (db: Db, ids: number[], memoId: number): MemoTaken[] =>
    db
      .prepare(
        `SELECT l.id, l.lr_no AS lrNo, l.status AS state, m.challan_no AS challanNo, t.number AS truck
         FROM lrs l LEFT JOIN memos m ON m.id = l.memo_id LEFT JOIN trucks t ON t.id = m.truck_id
         WHERE l.status != 'booked' AND l.memo_id IS NOT ? AND l.id IN (${marks(ids)}) ORDER BY l.lr_date, l.lr_no`,
      )
      .all(memoId, ...ids) as MemoTaken[];

  return {
    /** The challan number the next memo dated `date` will most likely get. */
    defaults(db: Db, date: string | null): KeeperResult<MemoDefaults> {
      const today = localDate(now());
      const on = date !== null && isDate(date) ? date : today;
      const last = db.prepare("SELECT last FROM counters WHERE name = 'challan' AND year = ?").get(Number(on.slice(0, 4))) as { last: number } | undefined;
      return ok({ today, nextNo: (last?.last ?? 0) + 1 });
    },

    /** Booked LRs by (date, number), 100 a page, with the count and quantity of the whole filter. */
    pending(db: Db, filters: MemoFilters, cursor: MemoCursor | null): KeeperResult<PendingPage> {
      const q = pendingSql(filters, cursor !== null);
      const rows = db.prepare(q.rows).all(cursor ? { ...q.args, cd: cursor.date, cn: cursor.no } : q.args) as MemoLrRow[];
      const total = db.prepare(q.count).get(q.args) as { count: number; qty: number };
      const last = rows[PAGE - 1];
      return ok({ rows: rows.slice(0, PAGE), next: rows.length > PAGE ? { date: last.date, no: last.lrNo } : null, ...total });
    },

    /** The ticked LRs that are still booked, added up in SQL. */
    totals(db: Db, ids: number[]): KeeperResult<PendingTotals> {
      return ok(db.prepare(`${TOTALS_SQL} (${marks(ids)})`).get(...ids) as PendingTotals);
    },

    /**
     * Save a memo (System PIN when dated other than today). One IMMEDIATE transaction: truck, driver, stations and LRs
     * checked → challan number → memo → claim of the LRs → totals frozen → audit row. The same `uid` returns the first memo.
     */
    create(db: Db, seat: string, input: MemoInput): KeeperResult<MemoSaved> {
      // A retry of a save that went through: the first memo again, nothing written, no PIN needed.
      const earlier = db.prepare('SELECT id FROM memos WHERE uid = ?').get(input.uid) as { id: number } | undefined;
      if (earlier) return ok({ ...rowOf(db, earlier.id), again: true });

      const today = localDate(now());
      const c = cleanMemo(input, today);
      if (Object.keys(c.errors).length > 0) return refuse('memo-invalid', { memoFields: c.errors });
      if (c.date !== today) {
        const gate = pins.verify(db, 'system', input.systemPin ?? '');
        if (!gate.ok) return gate;
      }

      try {
        return db
          .transaction((): KeeperResult<MemoSaved> => {
            const usable = (table: 'trucks' | 'drivers' | 'stations', id: number | null) =>
              db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND active = 1`).get(id) !== undefined;
            const errors: MemoErrors = {};
            if (!usable('trucks', input.truckId)) errors.truck = 'missing';
            if (!usable('drivers', input.driverId)) errors.driver = 'missing';
            if (!usable('stations', input.fromStationId)) errors.fromStation = 'missing';
            if (!usable('stations', input.toStationId)) errors.toStation = 'missing';
            const known = db.prepare(`SELECT COUNT(*) AS n FROM lrs WHERE id IN (${marks(c.ids)})`).get(...c.ids) as { n: number };
            if (known.n !== c.ids.length) errors.lrs = 'missing';
            if (Object.keys(errors).length > 0) throw new Stop(refuse('memo-invalid', { memoFields: errors }));

            const { year, no } = nextNumber(db, 'challan', c.date);
            const memoId = Number(
              db
                .prepare(
                  `INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id,
                     truck_hire_paise, loading_hamali_paise, seat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(input.uid, year, no, c.date, input.truckId, input.driverId, input.fromStationId, input.toStationId, c.hirePaise, c.hamaliPaise, seat).lastInsertRowid,
            );

            // The claim: only a booked LR can be loaded, and every ticked one must be. Anything less undoes the whole save.
            const claimed = db
              .prepare(`UPDATE lrs SET status = 'loaded', memo_id = ?, version = version + 1, updated_at = ${NOW} WHERE status = 'booked' AND id IN (${marks(c.ids)})`)
              .run(memoId, ...c.ids);
            if (claimed.changes !== c.ids.length) throw new Stop(refuse('memo-conflict', { taken: takenOf(db, c.ids, memoId) }));

            const frozen = db.prepare(FROZEN_SQL).get(memoId) as Frozen;
            db.prepare(
              `UPDATE memos SET frozen_lr_count = ?, frozen_qty = ?, frozen_topay_paise = ?, frozen_paid_paise = ?, frozen_charges_paise = ?, frozen_stax_paise = ? WHERE id = ?`,
            ).run(frozen.lrs, frozen.qty, frozen.toPayPaise, frozen.paidPaise, frozen.chargesPaise, frozen.staxPaise, memoId);

            writeAudit(db, {
              seat, action: 'memos.create', entity: 'memos', entityId: memoId,
              after: {
                challanYear: year, challanNo: no, date: c.date, truckId: input.truckId, driverId: input.driverId,
                fromStationId: input.fromStationId, toStationId: input.toStationId, truckHirePaise: c.hirePaise, loadingHamaliPaise: c.hamaliPaise,
                lrIds: c.ids, frozen,
              },
            });
            return ok({ ...rowOf(db, memoId), again: false });
          })
          .immediate();
      } catch (e) {
        if (e instanceof Stop) return e.refusal;
        throw e;
      }
    },

    /** A saved memo: header, the totals frozen when it was saved, and its LRs (at most 500). */
    get(db: Db, id: number): KeeperResult<MemoDetail> {
      const m = db.prepare(`${DETAIL} WHERE m.id = ?`).get(id) as DetailRow | undefined;
      if (!m) return refuse('memo-missing');
      const lrs = db
        .prepare(`SELECT ${LR_COLUMNS} FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE l.memo_id = ? ORDER BY l.lr_date, l.lr_no LIMIT ${MAX_MEMO_LRS}`)
        .all(id) as MemoLrRow[];
      const { fQty, fToPay, fPaid, fCharges, fStax, ...head } = m;
      return ok({ ...head, frozen: { lrs: m.lrCount, qty: fQty, toPayPaise: fToPay, paidPaise: fPaid, chargesPaise: fCharges, staxPaise: fStax }, lrs });
    },

    /** That day's memos, newest first (null = today), at most 200. */
    byDate(db: Db, date: string | null): KeeperResult<MemoListRow[]> {
      const on = date !== null && isDate(date) ? date : localDate(now());
      return ok(db.prepare(`${MEMO_ROW} WHERE m.memo_date = ? ORDER BY m.challan_year DESC, m.challan_no DESC LIMIT ${DAY_LIMIT}`).all(on) as MemoListRow[]);
    },
  };
}

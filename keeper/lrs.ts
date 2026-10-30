// LRs: the number, the validation and the money all happen here, inside ONE transaction per save. The screen sends
// what was typed (money as text) and gets back the saved LR with its amounts; it never adds anything up.
import type { ChargeOption, KeeperResult, LrDay, LrDefaults, LrDefaultsInput, LrDetail, LrHistoryEntry, LrInput, LrListRow, LrPreview, LrSaved, LrStatus, LrUpdated, ResultCode } from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { changesOf, cleanLr, cleanReason, diffLr, isChargeOption, isDate, localDate, parseNumbers, type CleanLr, type LrErrors } from './lrRules';
import type { makeMasters } from './masters';
import { chargesFor, lrAmounts, parsePercent, percentText, type ChargeRule, type LrMoney } from './money';
import { nameKey } from './names';
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

const DAY_LIMIT = 1000;
const NO_CHARGES: ChargeRule = { godownBhadaPaise: 0, godownInsurancePaise: 0, deliveryChargesPaise: 0, hamaliPerDagPaise: 0, hamaliFlatPaise: 0, hamaliMode: 'none' };

const setting = (db: Db, key: string): string | undefined =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

function chargeRule(db: Db, option: ChargeOption): ChargeRule {
  const text = setting(db, `chargeRule_${option}`);
  return text ? (JSON.parse(text) as ChargeRule) : NO_CHARGES;
}

const LIST = `SELECT l.id, l.lr_no AS lrNo, l.consignor_name AS consignor, l.consignee_name AS consignee, s.name AS toStation,
  l.qty, l.topay_paise AS toPayPaise, l.paid_paise AS paidPaise, l.status
  FROM lrs l JOIN stations s ON s.id = l.to_station_id`;

function saved(db: Db, id: number, again: boolean, firmsAdded: boolean): LrSaved {
  const row = db.prepare(`${LIST} WHERE l.id = ?`).get(id) as LrListRow;
  const money = db.prepare('SELECT * FROM lrs WHERE id = ?').get(id) as LrMoney;
  return { row, amounts: lrAmounts(money), again, firmsAdded };
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** An LR row as stored, plus the number of the memo it is on. */
type LrRow = LrMoney & {
  id: number; version: number; status: LrStatus; lr_year: number; lr_no: number; lr_date: string; memo_no: number | null;
  from_station_id: number; to_station_id: number; consignor_id: number | null; consignor_name: string; consignee_id: number | null; consignee_name: string;
  particular: string; qty: number; charge_option: ChargeOption; wasuli_paise: number;
};

const rowOf = (db: Db, id: unknown): LrRow | undefined =>
  db.prepare('SELECT l.*, m.challan_no AS memo_no FROM lrs l LEFT JOIN memos m ON m.id = l.memo_id WHERE l.id = ?').get(id) as LrRow | undefined;

function detailOf(r: LrRow): LrDetail {
  return {
    id: r.id, version: r.version, status: r.status, lrNo: r.lr_no, lrYear: r.lr_year, date: r.lr_date, memoNo: r.memo_no,
    fromStationId: r.from_station_id, toStationId: r.to_station_id,
    consignorId: r.consignor_id, consignor: r.consignor_name, consigneeId: r.consignee_id, consignee: r.consignee_name,
    particular: r.particular, qty: r.qty, toPayPaise: r.topay_paise, paidPaise: r.paid_paise, chargeOption: r.charge_option,
    godownBhadaPaise: r.godown_bhada_paise, godownInsurancePaise: r.godown_insurance_paise, deliveryChargesPaise: r.delivery_charges_paise,
    hamaliPaise: r.hamali_paise, wasuliPaise: r.wasuli_paise, staxPercent: percentText(r.stax_bp), amounts: lrAmounts(r),
  };
}

/** What an edit leaves alone: a station or firm the LR already has stays allowed even if it was deactivated since, and keeps its stored name. */
interface Keep {
  from: number;
  to: number;
  consignor: { id: number | null; name: string };
  consignee: { id: number | null; name: string };
}

interface Party {
  id: number | null;
  name: string;
}

/**
 * The stations and parties of an LR, checked against the database (create and edit share this, so they cannot drift).
 * A walk-in ticked "Add to firms" is saved through Masters inside the caller's transaction, so a refusal there rolls
 * the whole save back. Throws `Stop` with the refusal.
 */
function resolveLr(db: Db, masters: Pick<ReturnType<typeof makeMasters>, 'create'>, seat: string, input: LrInput, c: CleanLr, keep?: Keep) {
  const errors: LrErrors = {};
  const usable = (id: number | null, kept?: number): boolean =>
    id !== null && (id === kept || db.prepare('SELECT 1 FROM stations WHERE id = ? AND active = 1').get(id) !== undefined);
  if (!usable(input.fromStationId, keep?.from)) errors.fromStation = 'missing';
  if (!usable(input.toStationId, keep?.to)) errors.toStation = 'missing';

  let firmsAdded = false;
  const created = new Map<string, Party>();
  const resolve = (field: 'consignor' | 'consignee', p: LrInput['consignor'], typed: string | null): Party | null => {
    if (typed === null) {
      const kept = keep?.[field];
      if (kept && kept.id !== null && p.firmId === kept.id) return kept; // unchanged: the name stays as booked
      const firm = db.prepare('SELECT id, name FROM firms WHERE id = ? AND active = 1').get(p.firmId) as Party | undefined;
      if (!firm) errors[field] = 'missing';
      return firm ?? null;
    }
    if (!p.addToFirms) return { id: null, name: typed };
    const key = nameKey(typed);
    const twin = created.get(key); // the same new firm as consignor and consignee: one row
    if (twin) return twin;
    const r = masters.create(db, seat, 'firms', { name: typed }, input.confirmSimilar === true);
    if (!r.ok) throw new Stop({ ...r, detail: field });
    firmsAdded = true;
    const firm = { id: r.value.id, name: (r.value as { name: string }).name };
    created.set(key, firm);
    return firm;
  };
  const consignor = resolve('consignor', input.consignor, c.consignorName);
  const consignee = resolve('consignee', input.consignee, c.consigneeName);
  if (Object.keys(errors).length > 0 || !consignor || !consignee) throw new Stop(refuse('lr-invalid', { fields: errors }));
  return { consignor, consignee, firmsAdded };
}

const HISTORY_LIMIT = 50;

/** Cancel and restore: status only, one version up, one audit row, in the caller's transaction. */
function flip(db: Db, seat: string, row: LrRow, status: LrStatus, action: string, before: object, after: object): KeeperResult<LrDetail> {
  const done = db.prepare(`UPDATE lrs SET status = ?, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`).run(status, row.id, row.version);
  if (done.changes !== 1) return refuse('lr-stale', { lr: detailOf(rowOf(db, row.id) as LrRow) });
  writeAudit(db, { seat, action, entity: 'lrs', entityId: row.id, before, after });
  return ok(detailOf(rowOf(db, row.id) as LrRow));
}

export function makeLrs(pins: Pick<ReturnType<typeof makePins>, 'verify'>, masters: Pick<ReturnType<typeof makeMasters>, 'create'>, now: () => Date = () => new Date()) {
  function defaults(db: Db, date: string | null): LrDefaults {
    const today = localDate(now());
    const on = date !== null && isDate(date) ? date : today;
    const station = Number(setting(db, 'bookingStationId'));
    const active = Number.isInteger(station) && db.prepare('SELECT 1 FROM stations WHERE id = ? AND active = 1').get(station) !== undefined;
    const option = setting(db, 'defaultChargeOption');
    const bp = Number(setting(db, 'defaultStaxBp') ?? 0);
    const last = db.prepare("SELECT last FROM counters WHERE name = 'lr' AND year = ?").get(Number(on.slice(0, 4))) as { last: number } | undefined;
    return {
      today,
      bookingStationId: active ? station : null,
      chargeOption: isChargeOption(option) ? option : 'blank',
      staxPercent: percentText(Number.isInteger(bp) && bp >= 0 && bp <= 10000 ? bp : 0),
      nextNo: (last?.last ?? 0) + 1,
    };
  }

  return {
    defaults,

    /** No write. Amounts from `lrAmounts` on what is typed so far, and what the chosen charge option fills for this quantity. */
    preview(db: Db, input: LrInput): KeeperResult<LrPreview> {
      const { n, errors } = parseNumbers(input);
      const option = isChargeOption(input.chargeOption) ? input.chargeOption : 'blank';
      const c = chargesFor(chargeRule(db, option), n.qty);
      const amounts = lrAmounts({
        topay_paise: n.toPay,
        paid_paise: errors.paid === 'both' ? 0 : n.paid,
        godown_bhada_paise: n.godownBhada,
        godown_insurance_paise: n.godownInsurance,
        delivery_charges_paise: n.deliveryCharges,
        hamali_paise: n.hamali,
        pf_paise: 0,
        stax_bp: n.staxBp,
      });
      return ok({ amounts, defaults: c, fields: errors });
    },

    create(db: Db, seat: string, input: LrInput): KeeperResult<LrSaved> {
      // A retry of a save that went through: the first LR again, nothing written, no PIN needed.
      const earlier = db.prepare('SELECT id FROM lrs WHERE uid = ?').get(input.uid) as { id: number } | undefined;
      if (earlier) return ok(saved(db, earlier.id, true, false));

      const today = localDate(now());
      const c = cleanLr(input, today);
      if (Object.keys(c.errors).length > 0) return refuse('lr-invalid', { fields: c.errors });
      if (c.date !== today) {
        const gate = pins.verify(db, 'system', input.systemPin ?? '');
        if (!gate.ok) return gate;
      }

      try {
        return db.transaction((): KeeperResult<LrSaved> => {
          // A picked firm must be an active firm. A walk-in is saved to the firms master only when ticked: the same
          // checks as Masters, inside this transaction, so a refusal rolls the whole LR back.
          const { consignor, consignee, firmsAdded } = resolveLr(db, masters, seat, input, c);

          const { year, no } = nextNumber(db, 'lr', c.date);
          const r = db
            .prepare(
              `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_id, consignor_name, consignee_id, consignee_name, from_station_id, to_station_id,
                 particular, qty, topay_paise, paid_paise, charge_option, godown_bhada_paise, godown_insurance_paise, delivery_charges_paise,
                 hamali_paise, wasuli_paise, stax_bp, seat)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.uid, year, no, c.date, consignor.id, consignor.name, consignee.id, consignee.name, input.fromStationId, input.toStationId,
              c.particular, c.n.qty, c.n.toPay, c.n.paid, input.chargeOption, c.n.godownBhada, c.n.godownInsurance, c.n.deliveryCharges,
              c.n.hamali, c.n.wasuli, c.n.staxBp, seat,
            );
          const id = Number(r.lastInsertRowid);
          writeAudit(db, { seat, action: 'lrs.create', entity: 'lrs', entityId: id, after: db.prepare('SELECT * FROM lrs WHERE id = ?').get(id) });
          return ok(saved(db, id, false, firmsAdded));
        })();
      } catch (e) {
        if (e instanceof Stop) return e.refusal;
        throw e;
      }
    },

    get(db: Db, id: number): KeeperResult<LrDetail> {
      const row = rowOf(db, id);
      return row ? ok(detailOf(row)) : refuse('lr-missing');
    },

    /** An LR of the current year by its number. */
    find(db: Db, no: number): KeeperResult<LrDetail> {
      const found = db.prepare('SELECT id FROM lrs WHERE lr_year = ? AND lr_no = ?').get(Number(localDate(now()).slice(0, 4)), no) as { id: number } | undefined;
      const row = found && rowOf(db, found.id);
      return row ? ok(detailOf(row)) : refuse('lr-missing');
    },

    /**
     * Edit a saved LR (System PIN). One transaction: stale version refused with the current LR, then the same rules as a
     * new LR, then only the columns that changed are written, with a before / after audit row. The number never changes
     * and the date stays in the number's year. A loaded LR can be edited (its memo keeps its frozen totals).
     */
    update(db: Db, seat: string, id: number, version: number, input: LrInput, systemPin: string): KeeperResult<LrUpdated> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      try {
        return db.transaction((): KeeperResult<LrUpdated> => {
          const row = rowOf(db, id);
          if (!row) return refuse('lr-missing');
          if (row.version !== version) return refuse('lr-stale', { lr: detailOf(row) });
          if (row.status === 'cancelled') return refuse('lr-cancelled');

          // No date typed keeps the LR's own date (null means "today" only for a new LR).
          const c = cleanLr({ ...input, date: input.date ?? row.lr_date }, localDate(now()));
          if (c.errors.date === undefined && c.date.slice(0, 4) !== String(row.lr_year)) c.errors.date = 'year';
          if (Object.keys(c.errors).length > 0) return refuse('lr-invalid', { fields: c.errors });

          const r = resolveLr(db, masters, seat, input, c, {
            from: row.from_station_id, to: row.to_station_id,
            consignor: { id: row.consignor_id, name: row.consignor_name }, consignee: { id: row.consignee_id, name: row.consignee_name },
          });
          const next = {
            lr_date: c.date, from_station_id: input.fromStationId, to_station_id: input.toStationId,
            consignor_id: r.consignor.id, consignor_name: r.consignor.name, consignee_id: r.consignee.id, consignee_name: r.consignee.name,
            particular: c.particular, qty: c.n.qty, topay_paise: c.n.toPay, paid_paise: c.n.paid, charge_option: input.chargeOption,
            godown_bhada_paise: c.n.godownBhada, godown_insurance_paise: c.n.godownInsurance, delivery_charges_paise: c.n.deliveryCharges,
            hamali_paise: c.n.hamali, wasuli_paise: c.n.wasuli, stax_bp: c.n.staxBp,
          };
          const diff = diffLr(row, next);
          if (!diff) return ok({ lr: detailOf(row), firmsAdded: false, changed: false });

          // The column names come from the fixed list in lrRules, never from the request.
          const cols = Object.keys(diff.after);
          const done = db
            .prepare(`UPDATE lrs SET ${cols.map((col) => `${col} = ?`).join(', ')}, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`)
            .run(...cols.map((col) => diff.after[col] as number | string | null), id, version);
          // Cannot happen inside the transaction that read the version; if it ever does, nothing written so far stays.
          if (done.changes !== 1) throw new Stop(refuse('lr-stale', { lr: detailOf(rowOf(db, id) as LrRow) }));
          writeAudit(db, { seat, action: 'lrs.update', entity: 'lrs', entityId: id, before: diff.before, after: diff.after });
          return ok({ lr: detailOf(rowOf(db, id) as LrRow), firmsAdded: r.firmsAdded, changed: true });
        })();
      } catch (e) {
        if (e instanceof Stop) return e.refusal;
        throw e;
      }
    },

    /** Cancel (System PIN, a reason): status `cancelled`, the number stays used. An LR on a memo must come off it first. */
    cancel(db: Db, seat: string, id: number, version: number, reason: string, systemPin: string): KeeperResult<LrDetail> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return db.transaction((): KeeperResult<LrDetail> => {
        const row = rowOf(db, id);
        if (!row) return refuse('lr-missing');
        if (row.version !== version) return refuse('lr-stale', { lr: detailOf(row) });
        if (row.status === 'cancelled') return refuse('lr-cancelled');
        if (row.status === 'loaded') return refuse('lr-on-memo', { detail: String(row.memo_no) });
        const why = cleanReason(reason);
        if (why === null) return refuse('lr-invalid', { fields: { reason: 'required' } });
        return flip(db, seat, row, 'cancelled', 'lrs.cancel', { status: 'booked' }, { status: 'cancelled', reason: why });
      })();
    },

    /** Bring a cancelled LR back to booked (System PIN). */
    restore(db: Db, seat: string, id: number, version: number, systemPin: string): KeeperResult<LrDetail> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return db.transaction((): KeeperResult<LrDetail> => {
        const row = rowOf(db, id);
        if (!row) return refuse('lr-missing');
        if (row.version !== version) return refuse('lr-stale', { lr: detailOf(row) });
        if (row.status !== 'cancelled') return refuse('lr-not-cancelled');
        return flip(db, seat, row, 'booked', 'lrs.restore', { status: 'cancelled' }, { status: 'booked' });
      })();
    },

    /** Created / edited / cancelled / restored, newest first, at most 50, from the audit log. */
    history(db: Db, id: number): KeeperResult<LrHistoryEntry[]> {
      const rows = db
        .prepare(
          `SELECT at, seat, action, before_json AS before, after_json AS after FROM audit_log
           WHERE entity = 'lrs' AND entity_id = ? ORDER BY at DESC, id DESC LIMIT ${HISTORY_LIMIT}`,
        )
        .all(String(id)) as { at: string; seat: string; action: string; before: string | null; after: string | null }[];
      const stationName = (sid: unknown) => (db.prepare('SELECT name FROM stations WHERE id = ?').get(sid) as { name: string } | undefined)?.name;
      const json = (text: string | null) => (text === null ? {} : (JSON.parse(text) as Record<string, unknown>));
      const kind: Record<string, LrHistoryEntry['action']> = { 'lrs.create': 'created', 'lrs.update': 'edited', 'lrs.cancel': 'cancelled', 'lrs.restore': 'restored' };
      return ok(
        rows.flatMap((r) => {
          const action = kind[r.action];
          if (!action) return [];
          const entry: LrHistoryEntry = { at: r.at, seat: r.seat, action, changes: action === 'edited' ? changesOf(json(r.before), json(r.after), stationName) : [] };
          if (action === 'cancelled') entry.reason = String(json(r.after).reason ?? '');
          return [entry];
        }),
      );
    },

    /** One day's LRs, newest first, and the day's totals from SQL (cancelled LRs left out). */
    byDate(db: Db, date: string | null): KeeperResult<LrDay> {
      const on = date !== null && isDate(date) ? date : localDate(now());
      const rows = db.prepare(`${LIST} WHERE l.lr_date = ? ORDER BY l.lr_year DESC, l.lr_no DESC LIMIT ${DAY_LIMIT}`).all(on) as LrListRow[];
      const t = db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(topay_paise), 0) AS toPayPaise, COALESCE(SUM(paid_paise), 0) AS paidPaise,
             COALESCE(SUM(status = 'booked'), 0) AS booked, COALESCE(SUM(status = 'loaded'), 0) AS loaded
           FROM lrs WHERE lr_date = ? AND status != 'cancelled'`,
        )
        .get(on) as LrDay['totals'];
      return ok({ date: on, rows, totals: t });
    },

    /** Booking station, default charge option, default service tax: the Admin PIN changes them. */
    setDefaults(db: Db, seat: string, input: LrDefaultsInput, adminPin: string): KeeperResult<LrDefaults> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      let bp: number;
      try {
        bp = parsePercent(String(input.staxPercent));
      } catch {
        return refuse('lr-invalid', { fields: { staxPercent: 'percent' } });
      }
      if (!isChargeOption(input.chargeOption)) return refuse('lr-invalid', { fields: { chargeOption: 'required' } });
      const station = input.bookingStationId;
      if (station !== null && (!Number.isInteger(station) || db.prepare('SELECT 1 FROM stations WHERE id = ? AND active = 1').get(station) === undefined)) {
        return refuse('lr-invalid', { fields: { fromStation: 'missing' } });
      }
      db.transaction(() => {
        const before = defaults(db, null);
        const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
        put.run('bookingStationId', station === null ? '' : String(station));
        put.run('defaultChargeOption', input.chargeOption);
        put.run('defaultStaxBp', String(bp));
        const was = { bookingStationId: before.bookingStationId, chargeOption: before.chargeOption, staxPercent: before.staxPercent };
        writeAudit(db, { seat, action: 'settings.lr-defaults', entity: 'settings', entityId: 'lr-defaults', before: was, after: { bookingStationId: station, chargeOption: input.chargeOption, staxPercent: percentText(bp) } });
      })();
      return ok(defaults(db, null));
    },
  };
}

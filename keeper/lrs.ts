// LRs: the number, the validation and the money all happen here, inside ONE transaction per save. The screen sends
// what was typed (money as text) and gets back the saved LR with its amounts; it never adds anything up.
import type { ChargeOption, KeeperResult, LrDay, LrDefaults, LrDefaultsInput, LrInput, LrListRow, LrPreview, LrSaved, ResultCode } from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { cleanLr, isChargeOption, isDate, localDate, parseNumbers, type LrErrors } from './lrRules';
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
          const errors: LrErrors = {};
          const station = (id: number | null): boolean =>
            db.prepare('SELECT 1 FROM stations WHERE id = ? AND active = 1').get(id) !== undefined;
          if (!station(input.fromStationId)) errors.fromStation = 'missing';
          if (!station(input.toStationId)) errors.toStation = 'missing';

          // A picked firm must be an active firm. A walk-in is saved to the firms master only when ticked: the same
          // checks as Masters, inside this transaction, so a refusal rolls the whole LR back.
          let firmsAdded = false;
          const created = new Map<string, { id: number; name: string }>();
          const resolve = (field: 'consignor' | 'consignee', p: LrInput['consignor'], typed: string | null): { id: number | null; name: string } | null => {
            if (typed === null) {
              const firm = db.prepare('SELECT id, name FROM firms WHERE id = ? AND active = 1').get(p.firmId) as { id: number; name: string } | undefined;
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

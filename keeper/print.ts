// Printing (3.3): the keeper answers with exactly what is printed, every amount already formatted (`inr`), so the template
// does no maths. Memo totals are the ones frozen when the memo was saved. Reads write nothing; a print or a saved PDF that
// went through is written to the audit log by `done`, and the company lines are changed with the Admin PIN.
import { MAX_MEMO_LRS, type KeeperResult, type PrintCompany, type PrintDone, type PrintLr, type PrintMemo, type ResultCode } from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import type { makeMemos } from './memos';
import { inr, lrAmounts, percentText, type LrMoney } from './money';
import type { makePins } from './pins';

type Refusal = Extract<KeeperResult<never>, { ok: false }>;
const refuse = (code: ResultCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });
const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });

const DEFAULT_NAME = 'Sundeep Freight Movers';
const MAX_LINE = 100;
const COMPANY_KEYS = { name: 'company_name', address: 'company_address', phone: 'company_phone', gstin: 'company_gstin' } as const;
const BOXES = ['name', 'address', 'phone', 'gstin'] as const;

/** 2026-10-31 -> 31-10-2026 */
const display = (iso: string): string => iso.split('-').reverse().join('-');
/** A row's amount: nothing is a dash. */
const dash = (paise: number): string => (paise > 0 ? inr(paise) : '–');
/** One printed line: trimmed, runs of spaces (and any line break) made one space. */
const line = (v: unknown): string | null => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : null);

interface LrPrintRow extends LrMoney {
  lr_no: number;
  lr_year: number;
  lr_date: string;
  fromName: string;
  toName: string;
  consignor_name: string;
  consignee_name: string;
  particular: string;
  qty: number;
  status: string;
}

/** The body of /print/done: a memo or an LR, its id, and whether it was printed or saved as a PDF; null when it is anything else. */
export function asPrintDone(v: unknown): PrintDone | null {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = o.kind === 'memo' || o.kind === 'lr' ? o.kind : null;
  const how = o.how === 'print' || o.how === 'pdf' ? o.how : null;
  return kind && how && typeof o.id === 'number' && Number.isInteger(o.id) ? { kind, id: o.id, how } : null;
}

export function makePrint(pins: Pick<ReturnType<typeof makePins>, 'verify'>, memos: Pick<ReturnType<typeof makeMemos>, 'get'>) {
  const company = (db: Db): PrintCompany => {
    const get = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
    return { name: get(COMPANY_KEYS.name) || DEFAULT_NAME, address: get(COMPANY_KEYS.address) ?? '', phone: get(COMPANY_KEYS.phone) ?? '', gstin: get(COMPANY_KEYS.gstin) ?? '' };
  };

  return {
    company,

    /** Admin PIN. The name is required (1 to 100 characters), the other lines may be empty; saving what is already there writes nothing. */
    setCompany(db: Db, seat: string, input: PrintCompany, adminPin: string): KeeperResult<PrintCompany> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      const next = {} as PrintCompany;
      for (const box of BOXES) {
        const text = line((input as unknown as Record<string, unknown>)[box]);
        if (text === null || text.length > MAX_LINE || (box === 'name' && text === '')) return refuse('company-invalid', { detail: box });
        next[box] = text;
      }
      return db.transaction((): KeeperResult<PrintCompany> => {
        const before = company(db);
        if (BOXES.every((box) => before[box] === next[box])) return ok(before);
        const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
        for (const box of BOXES) put.run(COMPANY_KEYS[box], next[box]);
        writeAudit(db, { seat, action: 'settings.company', entity: 'settings', entityId: 'company', before, after: next });
        return ok(next);
      })();
    },

    /** A memo as printed: the header, its LRs by LR number (year, then number), the frozen totals, and whether its LRs still add up to them. */
    memo(db: Db, id: number): KeeperResult<PrintMemo> {
      const got = memos.get(db, id);
      if (!got.ok) return got;
      const m = got.value;
      const rows = db
        .prepare(
          `SELECT l.lr_no AS lrNo, l.consignor_name AS consignor, l.consignee_name AS consignee, s.name AS destination, l.particular, l.qty,
             l.topay_paise AS toPay, l.paid_paise AS paid
           FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE l.memo_id = ? ORDER BY l.lr_year, l.lr_no LIMIT ${MAX_MEMO_LRS}`,
        )
        .all(id) as { lrNo: number; consignor: string; consignee: string; destination: string; particular: string; qty: number; toPay: number; paid: number }[];
      return ok({
        company: company(db),
        challanNo: m.challanNo,
        challanYear: m.challanYear,
        date: display(m.date),
        truck: m.truck,
        driver: m.driver,
        from: m.fromStation,
        to: m.toStation,
        truckHire: inr(m.truckHirePaise),
        loadingHamali: inr(m.loadingHamaliPaise),
        cancelled: m.status === 'cancelled',
        differs: m.differs,
        rows: rows.map((r, i) => ({ ...r, sr: i + 1, toPay: dash(r.toPay), paid: dash(r.paid) })),
        totals: { lrs: m.frozen.lrs, qty: m.frozen.qty, toPay: inr(m.frozen.toPayPaise), paid: inr(m.frozen.paidPaise) },
      });
    },

    /** An LR as printed. Freight is To pay or Paid; the total is freight + charges + tax either way (`lrAmounts`). */
    lr(db: Db, id: number): KeeperResult<PrintLr> {
      const r = db
        .prepare(
          `SELECT l.*, fs.name AS fromName, ts.name AS toName FROM lrs l
           JOIN stations fs ON fs.id = l.from_station_id JOIN stations ts ON ts.id = l.to_station_id WHERE l.id = ?`,
        )
        .get(id) as LrPrintRow | undefined;
      if (!r) return refuse('lr-missing');
      const a = lrAmounts(r);
      // ponytail: pf_paise has no line because nothing writes it; if a screen ever does, add its line or the paper will not add up.
      return ok({
        company: company(db),
        lrNo: r.lr_no,
        lrYear: r.lr_year,
        date: display(r.lr_date),
        from: r.fromName,
        to: r.toName,
        consignor: r.consignor_name,
        consignee: r.consignee_name,
        particular: r.particular,
        qty: r.qty,
        mode: r.topay_paise > 0 ? 'topay' : r.paid_paise > 0 ? 'paid' : 'none',
        freight: inr(a.freight),
        godownBhada: inr(r.godown_bhada_paise),
        godownInsurance: inr(r.godown_insurance_paise),
        deliveryCharges: inr(r.delivery_charges_paise),
        hamali: inr(r.hamali_paise),
        staxPercent: percentText(r.stax_bp),
        stax: inr(a.stax),
        total: inr(a.total),
        cancelled: r.status === 'cancelled',
      });
    },

    /** A print or a saved PDF went through: one audit row (`print.memo` / `print.lr`). A cancelled Windows dialog never gets here. */
    done(db: Db, seat: string, d: PrintDone): KeeperResult<true> {
      const table = d.kind === 'memo' ? 'memos' : 'lrs';
      if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(d.id) === undefined) return refuse(d.kind === 'memo' ? 'memo-missing' : 'lr-missing');
      db.transaction(() => writeAudit(db, { seat, action: `print.${d.kind}`, entity: table, entityId: d.id, after: { how: d.how } }))();
      return ok(true);
    },
  };
}

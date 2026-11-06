// Printing (3.3): the keeper answers with exactly what is printed, every amount already formatted (`inr`), so the template
// does no maths. Memo totals are the ones frozen when the memo was saved. Reads write nothing; a print or a saved PDF that
// went through is written to the audit log by `done`, and the company lines are changed with the Admin PIN.
import {
  MAX_MEMO_LRS,
  MAX_REPORT_PRINT_ROWS,
  MAX_STATEMENT_PRINT_ROWS,
  REPORT_FILTERS,
  type KeeperResult,
  type PrintCompany,
  type PrintDone,
  type PrintFirmStatement,
  type PrintLr,
  type PrintMemo,
  type PrintReport,
  type ReportCursor,
  type ReportFilters,
  type ReportKind,
  type ReportPage,
  type ReportQuery,
  type ResultCode,
  type StatementQuery,
} from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import type { makeFirmAccounts } from './firmAccounts';
import { asRange, asRole } from './firmRules';
import type { makeMemos } from './memos';
import { inr, lrAmounts, percentText, type LrMoney } from './money';
import type { makePins } from './pins';
import type { makeReports } from './reports';
import { asReportKind, asReportQuery } from './reportRules';

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

/**
 * The body of /print/done: a memo, an LR, a firm statement or a report, its id, and whether it was printed or saved as a PDF; null when
 * it is anything else. A firm statement also names its period and role, a report which report, its period and filters (each is a
 * different printout for each); a report has no id (0).
 */
export function asPrintDone(v: unknown): PrintDone | null {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = o.kind === 'memo' || o.kind === 'lr' || o.kind === 'firm' || o.kind === 'report' ? o.kind : null;
  const how = o.how === 'print' || o.how === 'pdf' ? o.how : null;
  if (!kind || !how || typeof o.id !== 'number' || !Number.isInteger(o.id)) return null;
  if (kind === 'report') {
    const report = asReportKind(o.report);
    const q = asReportQuery({ ...(o.filters !== null && typeof o.filters === 'object' ? o.filters : {}), from: o.from, to: o.to });
    if (!report || !q) return null;
    const filters: ReportFilters = { toStationId: q.toStationId, text: q.text, truckId: q.truckId, agentId: q.agentId };
    return { kind, id: 0, how, report, from: q.from, to: q.to, filters };
  }
  if (kind !== 'firm') return { kind, id: o.id, how };
  const range = asRange(o);
  const role = asRole(o.role);
  return range && role ? { kind, id: o.id, how, ...range, role } : null;
}

/** Every page of a report, or a refusal when it has more rows than a printout may carry. */
function everyRow<R, T>(read: (cursor: ReportCursor | null) => KeeperResult<ReportPage<R, T>>): KeeperResult<{ rows: R[]; totals: T }> {
  const rows: R[] = [];
  let cursor: ReportCursor | null = null;
  for (;;) {
    const page = read(cursor);
    if (!page.ok) return page;
    rows.push(...page.value.rows);
    if (rows.length > MAX_REPORT_PRINT_ROWS) return refuse('report-too-long');
    if (!page.value.next) return ok({ rows, totals: page.value.totals });
    cursor = page.value.next;
  }
}

export function makePrint(
  pins: Pick<ReturnType<typeof makePins>, 'verify'>,
  memos: Pick<ReturnType<typeof makeMemos>, 'get'>,
  firms: Pick<ReturnType<typeof makeFirmAccounts>, 'statement'>,
  reports: ReturnType<typeof makeReports>,
) {
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

    /**
     * A firm's statement for a period, whole (not one page): the LRs by (date, number), every amount formatted, the totals of the
     * period. Refused above MAX_STATEMENT_PRINT_ROWS LRs (`detail` = how many): the print page is one data: URL.
     */
    firmStatement(db: Db, q: StatementQuery): KeeperResult<PrintFirmStatement> {
      const firm = db.prepare('SELECT name FROM firms WHERE id = ?').get(q.firmId) as { name: string } | undefined;
      if (!firm) return refuse('master-missing');
      const first = firms.statement(db, q, null);
      if (!first.ok) return first;
      const t = first.value.totals;
      if (t.lrs > MAX_STATEMENT_PRINT_ROWS) return refuse('print-too-long', { detail: String(t.lrs) });
      const rows = [...first.value.rows];
      for (let next = first.value.next; next; ) {
        const more = firms.statement(db, q, next);
        if (!more.ok) return more;
        rows.push(...more.value.rows);
        next = more.value.next;
      }
      return ok({
        company: company(db),
        firm: firm.name,
        role: q.role,
        from: display(q.from),
        to: display(q.to),
        rows: rows.map((r) => ({
          lrNo: r.lrNo, date: display(r.date), party: r.party, to: r.toStation, qty: r.qty,
          toPay: dash(r.toPayPaise), paid: dash(r.paidPaise), chargesTax: dash(r.chargesPaise + r.staxPaise), total: inr(r.totalPaise),
        })),
        totals: {
          lrs: t.lrs, qty: t.qty, toPay: inr(t.toPayPaise), paid: inr(t.paidPaise), charges: inr(t.chargesPaise), stax: inr(t.staxPaise), total: inr(t.totalPaise),
          wasuliOwed: inr(t.wasuliOwedPaise), wasuliCollected: inr(t.wasuliCollectedPaise), hasWasuli: t.wasuliOwedPaise > 0,
        },
      });
    },

    /**
     * A report as printed, whole (not one page): its rows and totals in the order of its columns, every amount formatted (`inr`, '–' for
     * nothing in a row). Refused above MAX_REPORT_PRINT_ROWS rows. The page (print/report.ts) names the columns.
     */
    report(db: Db, kind: ReportKind, q: ReportQuery): KeeperResult<PrintReport> {
      const used = REPORT_FILTERS[kind];
      const nameOf = (sql: string, id: number | null, uses: keyof ReportFilters): string | null =>
        id !== null && used.includes(uses) ? ((db.prepare(sql).get(id) as { name: string } | undefined)?.name ?? null) : null;
      const n = String;
      const build = (rows: string[][], totals: string[], anyDiffers = false): KeeperResult<PrintReport> =>
        ok({
          company: company(db),
          report: kind,
          from: display(q.from),
          to: display(q.to),
          filters: {
            station: nameOf('SELECT name FROM stations WHERE id = ?', q.toStationId, 'toStationId'),
            text: used.includes('text') ? q.text : '',
            truck: nameOf('SELECT number AS name FROM trucks WHERE id = ?', q.truckId, 'truckId'),
            agent: nameOf('SELECT name FROM agents WHERE id = ?', q.agentId, 'agentId'),
          },
          rows,
          totals,
          anyDiffers,
        });

      switch (kind) {
        case 'dateWise': {
          const all = everyRow((c) => reports.dateWise(db, q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [display(r.date), n(r.lrs), n(r.qty), dash(r.toPayPaise), dash(r.paidPaise), dash(r.chargesPaise), dash(r.staxPaise), inr(r.totalPaise)]),
            [n(t.lrs), n(t.qty), inr(t.toPayPaise), inr(t.paidPaise), inr(t.chargesPaise), inr(t.staxPaise), inr(t.totalPaise)],
          );
        }
        case 'stationWise': {
          const all = everyRow((c) => reports.stationWise(db, q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [r.station, n(r.lrs), n(r.qty), dash(r.toPayPaise), dash(r.paidPaise), dash(r.wasuliPaise)]),
            [n(t.lrs), n(t.qty), inr(t.toPayPaise), inr(t.paidPaise), inr(t.wasuliPaise)],
          );
        }
        case 'consignorWise':
        case 'consigneeWise': {
          const all = everyRow((c) => reports.partyWise(db, kind === 'consignorWise' ? 'consignor' : 'consignee', q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [r.name, r.station ?? '', n(r.lrs), n(r.qty), dash(r.toPayPaise), dash(r.paidPaise), dash(r.wasuliPaise)]),
            [n(t.lrs), n(t.qty), inr(t.toPayPaise), inr(t.paidPaise), inr(t.wasuliPaise)],
          );
        }
        case 'truckWise': {
          const all = everyRow((c) => reports.truckWise(db, q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [display(r.date), `${r.challanNo}${r.differs ? '*' : ''}`, r.truck, r.toStation, n(r.lrs), dash(r.toPayPaise), dash(r.paidPaise), dash(r.truckHirePaise), dash(r.loadingHamaliPaise)]),
            [n(t.memos), n(t.lrs), inr(t.toPayPaise), inr(t.paidPaise), inr(t.truckHirePaise), inr(t.loadingHamaliPaise)],
            all.value.rows.some((r) => r.differs),
          );
        }
        case 'firmWise': {
          const all = everyRow((c) => reports.firmWise(db, q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [r.name, n(r.asConsignor), n(r.asConsignee), n(r.qty), dash(r.toPayPaise), dash(r.paidPaise)]),
            [n(t.firms), n(t.asConsignor), n(t.asConsignee), n(t.walkInConsignor), n(t.walkInConsignee)],
          );
        }
        case 'wasuli': {
          const all = everyRow((c) => reports.wasuli(db, q, c));
          if (!all.ok) return all;
          const t = all.value.totals;
          return build(
            all.value.rows.map((r) => [r.agent, n(r.assignedCount), dash(r.assignedPaise), n(r.collectedCount), dash(r.collectedPaise)]),
            [n(t.assignedCount), inr(t.assignedPaise), n(t.collectedCount), inr(t.collectedPaise), n(t.poolCount), inr(t.poolPaise)],
          );
        }
      }
    },

    /** A print or a saved PDF went through: one audit row (`print.memo` / `print.lr` / `print.firm` / `print.report`). A cancelled Windows dialog never gets here. */
    done(db: Db, seat: string, d: PrintDone): KeeperResult<true> {
      if (d.kind === 'report') {
        const after = { how: d.how, from: d.from, to: d.to, ...d.filters };
        db.transaction(() => writeAudit(db, { seat, action: 'print.report', entity: 'reports', entityId: d.report as string, after }))();
        return ok(true);
      }
      const table = d.kind === 'memo' ? 'memos' : d.kind === 'lr' ? 'lrs' : 'firms';
      if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(d.id) === undefined) return refuse(d.kind === 'memo' ? 'memo-missing' : d.kind === 'lr' ? 'lr-missing' : 'master-missing');
      const after = d.kind === 'firm' ? { how: d.how, from: d.from, to: d.to, role: d.role } : { how: d.how };
      db.transaction(() => writeAudit(db, { seat, action: `print.${d.kind}`, entity: table, entityId: d.id, after }))();
      return ok(true);
    },
  };
}

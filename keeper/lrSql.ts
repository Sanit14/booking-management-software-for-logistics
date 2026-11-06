// The one SQL twin of `lrAmounts` (money.ts): charges, tax per LR rounded half up (the same arithmetic as `taxPaise`), the total, and the
// sums a memo, a firm statement and a report add up. Memos (frozen totals), Firm Accounts and Reports all build their SQL from here, so
// the same LRs add up to the same figures everywhere. The dbtests of those three compare it with `lrAmounts` over odd amounts and rates.
// `a` is the LR table's alias with its dot ('l.'), or '' when the statement reads `FROM lrs` bare.

/** The money of one LR row as SQL expressions (paise). Tax is on freight only; the total is the same for a To pay and a Paid LR. */
export function lrMoneySql(a = '') {
  const freight = `(${a}topay_paise + ${a}paid_paise)`;
  const charges = `${a}godown_bhada_paise + ${a}godown_insurance_paise + ${a}delivery_charges_paise + ${a}hamali_paise + ${a}pf_paise`;
  const stax = `((${freight} * ${a}stax_bp + 5000) / 10000)`;
  return { freight, charges, stax, total: `(${freight} + ${charges} + ${stax})` };
}

/** What a set of LRs adds up to at least: count, quantity, to pay, paid. */
export function lrFiguresSql(a = ''): string {
  return `COUNT(*) AS lrs, COALESCE(SUM(${a}qty), 0) AS qty,
    COALESCE(SUM(${a}topay_paise), 0) AS toPayPaise, COALESCE(SUM(${a}paid_paise), 0) AS paidPaise`;
}

/** The figures above plus charges and service tax (what a memo freezes). */
export function lrSumsSql(a = ''): string {
  const m = lrMoneySql(a);
  return `${lrFiguresSql(a)},
    COALESCE(SUM(${m.charges}), 0) AS chargesPaise,
    COALESCE(SUM(${m.stax}), 0) AS staxPaise`;
}

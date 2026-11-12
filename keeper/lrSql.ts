// The one SQL twin of `lrAmounts` (money.ts): freight, hamali and the total, and the sums a memo, a firm statement and a report add up.
// Memos (frozen totals), Firm Accounts and Reports all build their SQL from here, so the same LRs add up to the same figures everywhere.
// `lrSql.dbtest.ts` compares it with `lrAmounts` over odd amounts. `a` is the LR table's alias with its dot ('l.'), or '' when the
// statement reads `FROM lrs` bare. The older charge and tax columns of `lrs` are not read: an LR saved before 4.5 adds only freight + hamali.

/** The money of one LR row as SQL expressions (paise). The total is the same for a To pay and a Paid LR. */
export function lrMoneySql(a = '') {
  const freight = `(${a}topay_paise + ${a}paid_paise)`;
  const hamali = `${a}hamali_paise`;
  return { freight, hamali, total: `(${freight} + ${hamali})` };
}

/** What a set of LRs adds up to at least: count, quantity, to pay, paid. */
export function lrFiguresSql(a = ''): string {
  return `COUNT(*) AS lrs, COALESCE(SUM(${a}qty), 0) AS qty,
    COALESCE(SUM(${a}topay_paise), 0) AS toPayPaise, COALESCE(SUM(${a}paid_paise), 0) AS paidPaise`;
}

/** The figures above plus hamali (what a memo freezes). */
export function lrSumsSql(a = ''): string {
  return `${lrFiguresSql(a)},
    COALESCE(SUM(${lrMoneySql(a).hamali}), 0) AS hamaliPaise`;
}

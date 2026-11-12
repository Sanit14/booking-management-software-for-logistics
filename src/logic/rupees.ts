// Display only. The keeper sends whole paise; these turn them into the text a person reads or types. Nothing here
// adds, multiplies or rounds money (that is the keeper's `money.ts`): they only place the decimal point.

const split = (paise: number): [number, number] => [Math.floor(paise / 100), paise % 100];

/** Indian grouping: 1800 -> "1,800", 1250000 -> "12,50,000". */
function group(rupees: number): string {
  const digits = String(rupees);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

/** For lists and totals: 180000 -> "1,800", 12050 -> "120.50". */
export function formatPaise(paise: number): string {
  const [rupees, p] = split(paise);
  return p === 0 ? group(rupees) : `${group(rupees)}.${String(p).padStart(2, '0')}`;
}

/** Like `formatPaise` with a minus sign for a negative amount: -12050 -> "-120.50". A memo's totals and net can be below zero; display only, the keeper worked them out. */
export const formatSigned = (paise: number): string => (paise < 0 ? `-${formatPaise(-paise)}` : formatPaise(paise));

/** Whole rupees with Indian grouping and a minus sign when below zero: 10241 -> "10,241", -121 -> "-121" (a memo's round figure). */
export const formatWhole = (rupees: number): string => formatSigned(rupees * 100);

/** Always two decimals, a minus sign for a negative amount: 695300 -> "6,953.00", -12050 -> "-120.50". For the steps of a settlement and a rate ("0.40"), the way they are printed. */
export function formatFixed(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const [rupees, p] = split(Math.abs(paise));
  return `${sign}${group(rupees)}.${String(p).padStart(2, '0')}`;
}

/** For a box the clerk edits: 500 -> "5", 250 -> "2.5". Zero is an empty box. */
export function paiseToField(paise: number): string {
  if (paise === 0) return '';
  const [rupees, p] = split(paise);
  return p === 0 ? String(rupees) : `${rupees}.${String(p).padStart(2, '0').replace(/0$/, '')}`;
}

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

/** For a box the clerk edits: 500 -> "5", 250 -> "2.5". Zero is an empty box. */
export function paiseToField(paise: number): string {
  if (paise === 0) return '';
  const [rupees, p] = split(paise);
  return p === 0 ? String(rupees) : `${rupees}.${String(p).padStart(2, '0').replace(/0$/, '')}`;
}

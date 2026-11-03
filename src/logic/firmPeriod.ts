// What the Firm Accounts screen needs to ask and to draw. Pure. The dates come from the keeper PC's today (the screen never reads a
// clock of its own); the keeper still checks every range and adds up every figure: nothing here is a business rule.
import type { FirmRange } from '../../shared';

export type Preset = 'today' | 'month' | 'lastMonth' | 'year';

const two = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${two(m)}-${two(d)}`;
/** The last day of month `m` (1 to 12), leap years included. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The period a preset means on `today` (YYYY-MM-DD). This month and This year run to today; Last month is the whole month. */
export function periodOf(preset: Preset, today: string): FirmRange {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'month':
      return { from: iso(y, m, 1), to: today };
    case 'lastMonth': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case 'year':
      return { from: iso(y, 1, 1), to: today };
  }
}

/** Both days typed, real, and from not after to: only then is a custom period worth asking the keeper about. */
export function isRange(from: string, to: string): boolean {
  const real = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  return real(from) && real(to) && from <= to;
}

/** "▲ 12%" for a rise, "▼ 8%" for a fall, "0%" for no change, a dash when there was nothing before to compare with. */
export function growthLabel(g: number | null): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (g === null) return { text: '—', tone: 'flat' };
  if (g === 0) return { text: '0%', tone: 'flat' };
  return g > 0 ? { text: `▲ ${g}%`, tone: 'up' } : { text: `▼ ${-g}%`, tone: 'down' };
}

/** A chart bar in pixels: 100% fills `full`, anything above is capped, a change too small to see still gets 2 px, no growth gets none. */
export function barHeight(g: number | null, full: number): number {
  if (g === null || g === 0) return 0;
  return Math.min(full, Math.max(2, Math.round((Math.abs(g) / 100) * full)));
}

/** The years the chart's picker offers: this one and the two before, newest first. */
export const yearChoices = (today: string): number[] => {
  const y = Number(today.slice(0, 4));
  return [y, y - 1, y - 2];
};

import type { FirmMonth } from '../../shared';
import { barHeight } from '../logic/firmPeriod';
import { strings } from '../strings';
import styles from './FirmAccountsPage.module.css';

const t = strings.firmAccounts;
// The drawing is 720 wide (12 slots of 60) and is scaled to the card. 100% is a bar of FULL px; the labels sit just beyond a bar's end.
const SLOT = 60;
const FULL = 44;
const AXIS = 70;
const HEIGHT = 164;

/**
 * Freight growth against the month before, for the 12 months of a year: up (green) above the line, down (red) below, the percent
 * beside the bar. Percentages only, no amounts (as DM). A month with nothing to compare, and the month in progress, have no bar.
 * Plain SVG: no chart library.
 */
export default function GrowthChart({ year, months }: { year: number; months: FirmMonth[] }) {
  return (
    <svg className={styles.chart} viewBox={`0 0 ${SLOT * 12} ${HEIGHT}`} role="img" aria-label={t.chartLabel(year)}>
      <line className={styles.axis} x1="0" x2={SLOT * 12} y1={AXIS} y2={AXIS} />
      {months.map((m, i) => {
        const cx = i * SLOT + SLOT / 2;
        const name = t.months[Number(m.month.slice(5, 7)) - 1];
        const g = m.growth;
        const h = barHeight(g, FULL);
        const up = g !== null && g > 0;
        const down = g !== null && g < 0;
        return (
          <g key={m.month}>
            <title>{t.barTitle(name, g, m.lrs)}</title>
            {up && <rect className={styles.barUp} x={cx - 14} y={AXIS - h} width="28" height={h} rx="3" />}
            {down && <rect className={styles.barDown} x={cx - 14} y={AXIS} width="28" height={h} rx="3" />}
            {up && (
              <text className={styles.pctUp} x={cx} y={AXIS - h - 6}>
                +{g}%
              </text>
            )}
            {down && (
              <text className={styles.pctDown} x={cx} y={AXIS + h + 17}>
                {g}%
              </text>
            )}
            {g === 0 && <text x={cx} y={AXIS - 6}>0%</text>}
            {g === null && m.lrs > 0 && <text x={cx} y={AXIS - 6}>—</text>}
            <text x={cx} y={HEIGHT - 8}>
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

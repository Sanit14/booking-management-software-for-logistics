import { strings } from '../strings';
import styles from './Chip.module.css';

export type ChipKind = 'booked' | 'loaded' | 'cancelled' | 'toPay' | 'paid' | 'charges' | 'pending' | 'saved' | 'inactive';

/** Status pill: a dot and a word. `count` makes it a filter chip like "Booked 3". */
export default function Chip({ kind, count }: { kind: ChipKind; count?: number }) {
  return (
    <span className={`${styles.chip} ${styles[kind]}`}>
      <span className={styles.dot} />
      {strings.chip[kind]}
      {count !== undefined && ` ${count}`}
    </span>
  );
}

import type { MemoTaken } from '../../shared';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;

/** The LRs another seat got to first (or took off, or cancelled): shown when a save or a change was refused for them. */
export default function TakenDialog({ taken, text, onClose }: { taken: MemoTaken[] | null; text: string; onClose: () => void }) {
  return (
    <Dialog open={taken !== null} title={t.conflictTitle} confirmLabel={t.conflictOk} hideCancel onCancel={onClose} onConfirm={onClose}>
      <p>{text}</p>
      <ul className={styles.takenList}>
        {(taken ?? []).map((x) => (
          <li key={x.id}>{x.state === 'loaded' ? t.conflictLoaded(x.lrNo, x.challanNo, x.truck) : x.state === 'booked' ? t.conflictRemoved(x.lrNo) : t.conflictCancelled(x.lrNo)}</li>
        ))}
      </ul>
    </Dialog>
  );
}

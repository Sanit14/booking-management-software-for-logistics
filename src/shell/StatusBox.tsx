import type { BackupStatus } from '../../shared';
import { strings } from '../strings';
import styles from './StatusBox.module.css';

function backupLine(b: BackupStatus | undefined): { text: string; bad: boolean } {
  if (b?.failing) return { text: strings.status.backupFailing(b.failing), bad: true };
  if (!b?.lastAt) return { text: strings.status.noBackup, bad: false };
  return { text: strings.status.lastBackup(b.lastAt), bad: false };
}

/** Foot of the sidebar: keeper dot, seat, last backup. Shown only while the keeper is connected. */
export default function StatusBox({ seat, backup }: { seat: string; backup?: BackupStatus }) {
  const line = backupLine(backup);
  return (
    <div className={styles.box} role="status">
      <div className={styles.keeper}>
        <span className={styles.dot} aria-hidden="true" />
        {strings.status.connected}
      </div>
      <div>{strings.status.seat(seat)}</div>
      <div className={line.bad ? styles.bad : undefined}>{line.text}</div>
    </div>
  );
}

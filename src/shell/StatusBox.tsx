import type { BackupStatus } from '../../shared';
import { strings } from '../strings';
import styles from './StatusBox.module.css';

function backupLine(b: BackupStatus | undefined): { text: string; bad: boolean } {
  if (b?.failing) return { text: strings.status.backupFailing(b.failing), bad: true };
  if (!b?.lastAt) return { text: strings.status.noBackup, bad: false };
  return { text: strings.status.lastBackup(b.lastAt), bad: false };
}

export type KeeperLink = 'ok' | 'reconnecting' | 'lost';

const linkText: Record<KeeperLink, string> = {
  ok: strings.status.connected,
  reconnecting: strings.status.reconnecting,
  lost: strings.status.lost,
};

/** Foot of the sidebar: keeper dot, seat, last backup. `link` = what main's watchdog says about the keeper. */
export default function StatusBox({ seat, backup, link = 'ok' }: { seat: string; backup?: BackupStatus; link?: KeeperLink }) {
  const line = backupLine(backup);
  const dot = link === 'reconnecting' ? styles.waiting : link === 'lost' ? styles.lostDot : '';
  return (
    <div className={styles.box} role="status">
      <div className={`${styles.keeper} ${link === 'lost' ? styles.bad : ''}`.trim()}>
        <span className={`${styles.dot} ${dot}`.trim()} aria-hidden="true" />
        {linkText[link]}
      </div>
      <div>{strings.status.seat(seat)}</div>
      <div className={line.bad ? styles.bad : undefined}>{line.text}</div>
    </div>
  );
}

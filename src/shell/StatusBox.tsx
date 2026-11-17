import type { BackupStatus } from '../../shared';
import { backupFootText } from '../logic/backupLine';
import { strings } from '../strings';
import styles from './StatusBox.module.css';

export type KeeperLink = 'ok' | 'reconnecting' | 'lost';

/**
 * Foot of the sidebar: one line with the seat and the last backup (red when the backups fail or the database service is lost; the dot is amber
 * while main reconnects), then the version. `link` = what main's watchdog says about the keeper.
 */
export default function StatusBox({ seat, backup, link = 'ok' }: { seat: string; backup?: BackupStatus; link?: KeeperLink }) {
  const backed = backupFootText(backup);
  const what = link === 'reconnecting' ? strings.status.reconnecting : link === 'lost' ? strings.status.lost : backed.text;
  const bad = link === 'lost' || (link === 'ok' && backed.bad);
  const dot = link === 'reconnecting' ? styles.waiting : bad ? styles.lostDot : '';
  return (
    <div className={styles.box} role="status">
      <div className={`${styles.line} ${bad ? styles.bad : ''}`.trim()}>
        <span className={`${styles.dot} ${dot}`.trim()} aria-hidden="true" />
        <span>{strings.status.line(seat, what)}</span>
      </div>
      <div>{strings.status.version(window.bm.version)}</div>
    </div>
  );
}

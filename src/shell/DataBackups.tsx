import { Check, Database, TriangleAlert } from 'lucide-react';
import type { KeeperHealth } from '../../shared';
import { backupStatusLine } from '../logic/backupLine';
import { strings } from '../strings';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import BackupFolderRow from './BackupFolderRow';
import RestoreButton from './RestoreButton';
import SettingsSection from './SettingsSection';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/** Settings → Data & Backups: one status line (red when the backups fail), Save a copy… and Restore…, the data folder, the backup folder with Change…. */
export default function DataBackups({ health, onChanged }: { health: KeeperHealth; onChanged: () => void }) {
  const toast = useToast();
  const line = backupStatusLine(health.backup);

  const saveCopy = () => {
    void window.bm.keeper.backups.exportTo().then((r) => {
      if (r.ok) toast.success(strings.exportDone, r.value.file);
      else if (r.code !== 'cancelled') toast.error(strings.result(r.code, r.detail));
      onChanged(); // the status line shows the newest backup
    });
  };

  return (
    <SettingsSection icon={Database} title={t.dataTitle}>
      <div className={`${styles.line} ${line.bad ? styles.lineBad : ''}`.trim()} role="status">
        {line.bad ? <TriangleAlert size={18} aria-hidden="true" /> : <Check size={18} strokeWidth={2.4} aria-hidden="true" />}
        {line.text}
      </div>
      <div className={styles.row}>
        <Button small variant="outline" onClick={saveCopy}>
          {t.saveCopy}
        </Button>
        <RestoreButton onRestored={onChanged} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{t.dataFolder}</span>
        <span className={styles.path}>{health.dataRoot}</span>
      </div>
      <BackupFolderRow dir={health.backupDir} onChanged={onChanged} />
    </SettingsSection>
  );
}

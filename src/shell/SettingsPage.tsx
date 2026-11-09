import { Fragment } from 'react';
import type { KeeperHealth } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../ui/Toast';
import Page from './Page';
import BackupFolderCard from './BackupFolderCard';
import CompanyCard from './CompanyCard';
import KeysCard from './KeysCard';
import LrDefaultsCard from './LrDefaultsCard';
import PinsCard from './PinsCard';
import RestoreCard from './RestoreCard';
import SeatCard from './SeatCard';
import UpdateCard from './UpdateCard';
import styles from './SettingsPage.module.css';

/** Versions and folders, the backup export, the backup folder, restore, the seat, PINs, keys, company lines, LR defaults and updates. */
export default function SettingsPage({ health, seat, onExported }: { health: KeeperHealth; seat: string; onExported: () => void }) {
  const toast = useToast();
  const s = strings.settings;
  const facts: [string, string][] = [
    [s.appVersion, window.bm.version],
    [s.keeperVersion, String(health.keeperVersion)],
    [s.schemaVersion, health.schemaVersion === undefined ? s.noSchema : String(health.schemaVersion)],
    [s.dataFolder, health.dataRoot],
    [s.backupFolder, health.backupDir],
  ];

  const exportBackup = () => {
    void window.bm.keeper.backups.exportTo().then((r) => {
      if (r.ok) toast.success(strings.exportDone, r.value.file);
      else if (r.code !== 'cancelled') toast.error(strings.result(r.code, r.detail));
      onExported(); // the status box shows the newest backup
    });
  };

  return (
    <Page id="settings">
      <div className={styles.cards}>
        <Card title={s.versionTitle} className={styles.wide}>
          <dl className={styles.facts}>
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          <p className={styles.note}>{s.dataFolderNote}</p>
        </Card>
        <PinsCard />
        <LrDefaultsCard />
        <CompanyCard />
        <KeysCard />
        <UpdateCard />
        <Card title={strings.settings.backupTitle}>
          <div className={styles.body}>
            <p>{strings.settings.backupText}</p>
            <Button variant="secondary" onClick={exportBackup}>
              {strings.exportBackup}
            </Button>
          </div>
        </Card>
        <BackupFolderCard dir={health.backupDir} onChanged={onExported} />
        <RestoreCard onRestored={onExported} />
        <SeatCard seat={seat} />
      </div>
    </Page>
  );
}

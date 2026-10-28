import { Fragment } from 'react';
import type { KeeperHealth } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../ui/Toast';
import Page from './Page';
import PinsCard from './PinsCard';
import UpdateCard from './UpdateCard';
import styles from './SettingsPage.module.css';

/** Only what exists so far: versions and folders, the backup export (moved here from the 1.4 status line) and the Components page link. */
export default function SettingsPage({ health, onExported, onComponents }: { health: KeeperHealth; onExported: () => void; onComponents: () => void }) {
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
        </Card>
        <PinsCard />
        <UpdateCard />
        <Card title={strings.settings.backupTitle}>
          <div className={styles.body}>
            <p>{strings.settings.backupText}</p>
            <Button variant="secondary" onClick={exportBackup}>
              {strings.exportBackup}
            </Button>
          </div>
        </Card>
        <Card title={strings.settings.componentsTitle}>
          <div className={styles.body}>
            <p>{strings.settings.componentsText}</p>
            <Button variant="outline" onClick={onComponents}>
              {strings.settings.openComponents}
            </Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}

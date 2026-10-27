import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../ui/Toast';
import Page from './Page';
import styles from './SettingsPage.module.css';

/** Only what exists so far: the backup export (moved here from the 1.4 status line) and the Components page link. */
export default function SettingsPage({ onExported, onComponents }: { onExported: () => void; onComponents: () => void }) {
  const toast = useToast();

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

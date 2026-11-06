import { useRef, useState } from 'react';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/**
 * Settings → Backup folder (Admin PIN). The PIN is asked first, then main asks for the folder, then the keeper makes a backup there and only if
 * that works switches to it. A folder on the data's own drive is asked about once more. The PIN is held in a ref only while that question is open.
 */
export default function BackupFolderCard({ dir, onChanged }: { dir: string; onChanged: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false); // the Admin PIN
  const [same, setSame] = useState<string | null>(null); // the folder that is on the data's drive, waiting for "use it anyway"
  const pin = useRef('');

  const done = (made: { dir: string; file: string }) => {
    toast.success(t.backupFolderDone(made.dir), t.backupFolderMade(made.file));
    onChanged(); // the status box and this card read the keeper's health
  };

  const submit = async (typed: string): Promise<boolean> => {
    const r = await window.bm.keeper.backups.setFolder(typed, false);
    if (r.ok) {
      setAsking(false);
      done(r.value);
    } else if (r.code === 'wrong-pin') {
      return false; // the dots shake; the keeper counts it
    } else if (r.code === 'backup-dir-same-drive') {
      pin.current = typed;
      setAsking(false);
      setSame(r.detail ?? '');
    } else {
      setAsking(false);
      if (r.code !== 'cancelled') toast.error(strings.result(r.code, r.detail));
    }
    return true;
  };

  const confirmSame = async () => {
    const typed = pin.current;
    pin.current = '';
    setSame(null);
    const r = await window.bm.keeper.backups.setFolder(typed, true);
    if (r.ok) done(r.value);
    else if (r.code !== 'cancelled') toast.error(strings.result(r.code, r.detail));
  };

  return (
    <Card title={t.backupFolderTitle}>
      <div className={styles.body}>
        <p>{t.backupFolderText}</p>
        <p className={styles.status}>{dir}</p>
        <Button variant="secondary" onClick={() => setAsking(true)}>
          {t.backupFolderChange}
        </Button>
      </div>
      <PinDialog open={asking} title={t.backupFolderPinTitle} prompt={t.adminPrompt} label={strings.pins.adminLabel} onCancel={() => setAsking(false)} onSubmit={submit} />
      <Dialog
        open={same !== null}
        title={t.backupFolderSameDriveTitle}
        cancelLabel={t.backupFolderKeep}
        confirmLabel={t.backupFolderUse}
        danger
        onCancel={() => {
          pin.current = '';
          setSame(null);
        }}
        onConfirm={() => void confirmSame()}
      >
        <p>{t.backupFolderSameDriveText(same ?? '')}</p>
      </Dialog>
    </Card>
  );
}

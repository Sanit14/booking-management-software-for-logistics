import { useState } from 'react';
import type { RestorePreview } from '../../shared';
import BackupPicker from '../BackupPicker';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/**
 * Settings → Restore a backup (Admin PIN): the same list and side-by-side check as safe mode, then the PIN. The keeper refuses while another
 * seat has the app open, makes a fresh backup first and keeps the database as it was; every screen refetches when it is done.
 */
export default function RestoreCard({ onRestored }: { onRestored: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<RestorePreview | null>(null); // the backup chosen, waiting for the PIN

  const submit = async (pin: string): Promise<boolean> => {
    if (!asking) return true;
    const r = await window.bm.keeper.restore.apply(asking.file, asking.token, pin);
    if (!r.ok && r.code === 'wrong-pin') return false;
    setAsking(null);
    if (r.ok) {
      setOpen(false);
      toast.success(t.restoreDone, t.restoreDoneText);
      onRestored();
    } else {
      // The preview is spent or the answer was a refusal worth reading: the picker closes and opens afresh next time.
      setOpen(false);
      toast.error(strings.result(r.code, r.detail));
    }
    return true;
  };

  return (
    <Card title={t.restoreTitle}>
      <div className={styles.body}>
        <p>{t.restoreText}</p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t.restoreOpen}
        </Button>
      </div>
      <Dialog open={open} wide title={t.restoreDialogTitle} onCancel={() => setOpen(false)}>
        <div className={styles.restoreBox}>
          <BackupPicker
            onRestore={(preview) => {
              setAsking(preview);
              return null;
            }}
          />
        </div>
      </Dialog>
      <PinDialog open={asking !== null} title={t.restorePinTitle} prompt={t.adminPrompt} label={strings.pins.adminLabel} onCancel={() => setAsking(null)} onSubmit={submit} />
    </Card>
  );
}

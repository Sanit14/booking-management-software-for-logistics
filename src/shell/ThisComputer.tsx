import { useId, useState } from 'react';
import { Monitor } from 'lucide-react';
import { strings } from '../strings';
import Button from '../ui/Button';
import fieldStyles from '../ui/Field.module.css';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import SettingsSection from './SettingsSection';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/** Settings → This Computer: the name this seat writes History under. Saving asks the Admin PIN; the keeper checks the name and it is used from the next start. */
export default function ThisComputer({ seat }: { seat: string }) {
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState(seat);
  const [asking, setAsking] = useState(false); // the Admin PIN
  const [next, setNext] = useState<string | null>(null); // a name accepted and waiting for the next start

  const submit = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.seat.rename(name, pin);
    if (!r.ok && r.code === 'wrong-pin') return false;
    setAsking(false);
    if (r.ok) {
      setNext(r.value.name);
      toast.success(t.seatDone(r.value.name));
    } else toast.error(strings.result(r.code, r.detail));
    return true;
  };

  return (
    <SettingsSection icon={Monitor} title={t.computerTitle}>
      <div className={styles.row}>
        <label className={styles.label} htmlFor={id}>
          {t.computerName}
        </label>
        <input id={id} className={`${fieldStyles.box} ${styles.name}`} maxLength={40} autoComplete="off" placeholder={t.computerPlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
        <Button small variant="outline" disabled={name.trim() === '' || name.trim() === seat} onClick={() => setAsking(true)}>
          {t.save} · {t.adminPin}
        </Button>
      </div>
      {next && <p className={styles.status}>{t.seatAfterRestart(next)}</p>}
      <PinDialog open={asking} title={t.seatPinTitle} prompt={t.adminPrompt} label={strings.pins.adminLabel} onCancel={() => setAsking(false)} onSubmit={submit} />
    </SettingsSection>
  );
}

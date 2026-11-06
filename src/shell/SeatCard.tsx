import { useState } from 'react';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/** Settings → This seat (Admin PIN): the name this seat writes History under. The keeper checks the name; it is used from the next start. */
export default function SeatCard({ seat }: { seat: string }) {
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
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
    <Card title={t.seatTitle}>
      <div className={styles.body}>
        <p>{t.seatText(seat)}</p>
        {next && <p className={styles.status}>{t.seatAfterRestart(next)}</p>}
        <Button
          variant="secondary"
          onClick={() => {
            setName('');
            setNaming(true);
          }}
        >
          {t.seatRename}
        </Button>
      </div>
      <Dialog
        open={naming}
        title={t.seatDialogTitle}
        confirmLabel={t.seatNext}
        onCancel={() => setNaming(false)}
        onConfirm={() => {
          setNaming(false);
          setAsking(true);
        }}
      >
        <Field data-autofocus="" label={t.seatNameLabel} hint={t.seatNameHint} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </Dialog>
      <PinDialog open={asking} title={t.seatPinTitle} prompt={t.adminPrompt} label={strings.pins.adminLabel} onCancel={() => setAsking(false)} onSubmit={submit} />
    </Card>
  );
}

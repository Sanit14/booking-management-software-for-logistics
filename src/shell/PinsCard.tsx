import { useState } from 'react';
import type { KeeperResult } from '../../shared';
import { PinSetupFlow } from '../PinSetup';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import { PinEntry } from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import styles from './SettingsPage.module.css';

const t = strings.pins;
type Which = 'system' | 'admin' | 'forgot' | null;

/** Settings → PINs: change either PIN (the Admin PIN is asked first) or reset both with the recovery code. */
export default function PinsCard() {
  const [open, setOpen] = useState<Which>(null);
  const [codeShown, setCodeShown] = useState(false); // the one-time recovery code is on screen
  const close = () => {
    setOpen(null);
    setCodeShown(false);
  };
  return (
    <Card title={t.cardTitle}>
      <div className={styles.body}>
        <p>{t.cardText}</p>
        <div className={styles.buttons}>
          <Button variant="secondary" small onClick={() => setOpen('system')}>
            {t.changeSystem}
          </Button>
          <Button variant="secondary" small onClick={() => setOpen('admin')}>
            {t.changeAdmin}
          </Button>
          <Button variant="outline" small onClick={() => setOpen('forgot')}>
            {t.forgot}
          </Button>
        </div>
      </div>
      <Dialog open={open === 'system'} title={t.changeSystem} onCancel={close}>
        <ChangePin kind="system" onClose={close} />
      </Dialog>
      <Dialog open={open === 'admin'} title={t.changeAdmin} onCancel={close}>
        <ChangePin kind="admin" onClose={close} />
      </Dialog>
      <Dialog open={open === 'forgot'} title={t.recoverTitle} onCancel={codeShown ? () => undefined : close} hideCancel={codeShown}>
        <PinSetupFlow mode="recover" onDone={close} onCodeShown={() => setCodeShown(true)} />
      </Dialog>
    </Card>
  );
}

/** Admin PIN → new PIN → new PIN again → one change request that carries the Admin PIN again. */
function ChangePin({ kind, onClose }: { kind: 'system' | 'admin'; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<'admin' | 'new' | 'again'>('admin');
  const [adminPin, setAdminPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A wrong Admin PIN shakes in place (the dots say so); any other refusal is explained in a toast.
  const refused = (r: Extract<KeeperResult<unknown>, { ok: false }>): false => {
    if (r.code !== 'wrong-pin') toast.error(strings.result(r.code, r.detail));
    return false;
  };
  const label = kind === 'system' ? t.systemLabel : t.adminLabel;

  return (
    <div>
      {error && (
        <p role="alert" className={styles.pinError}>
          {error}
        </p>
      )}
      {step === 'admin' && (
        <PinEntry
          key="admin"
          prompt={t.enterAdmin}
          label={t.adminLabel}
          onSubmit={async (pin) => {
            const r = await window.bm.keeper.pins.verify('admin', pin);
            if (!r.ok) return refused(r);
            setAdminPin(pin);
            setStep('new');
            return true;
          }}
        />
      )}
      {step === 'new' && (
        <PinEntry
          key="new"
          prompt={kind === 'system' ? t.newSystem : t.newAdmin}
          label={label}
          onSubmit={(pin) => {
            setError(null);
            setNewPin(pin);
            setStep('again');
            return true;
          }}
        />
      )}
      {step === 'again' && (
        <PinEntry
          key="again"
          prompt={t.repeatNew}
          label={label}
          onSubmit={async (pin) => {
            if (pin !== newPin) {
              setError(t.mismatch);
              setStep('new');
              return true;
            }
            const change = kind === 'system' ? window.bm.keeper.pins.changeSystem : window.bm.keeper.pins.changeAdmin;
            const r = await change(adminPin, pin);
            if (!r.ok) {
              toast.error(strings.result(r.code, r.detail));
              setStep(r.code === 'pins-same' ? 'new' : 'admin');
              return true;
            }
            toast.success(t.changed);
            onClose();
            return true;
          }}
        />
      )}
    </div>
  );
}

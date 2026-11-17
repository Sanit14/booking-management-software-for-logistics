import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { UpdateState } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import SettingsSection from './SettingsSection';
import styles from './SettingsPage.module.css';

const t = strings.update;

/** Settings → Software update. The only place that talks to main's updater; nothing here runs by itself. */
export default function UpdateCard() {
  const toast = useToast();
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void window.bm.update.state().then(setState);
    return window.bm.update.onState(setState);
  }, []);

  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const run = (go: () => Promise<UpdateState>) => void go().then(setState);

  const line = ((): string => {
    switch (state.status) {
      case 'idle':
        return '';
      case 'checking':
        return t.checking;
      case 'uptodate':
        return t.uptodate;
      case 'available':
        return t.available(state.version, state.sizeBytes);
      case 'downloading':
        return state.verifying ? t.verifying : t.downloading(state.percent);
      case 'downloaded':
        return t.downloaded(state.version);
      case 'installing':
        return t.installing(state.version);
      case 'error':
        return state.message;
    }
  })();

  // A wrong PIN shakes the dots; every other refusal (another seat is open, the backup failed...) is explained once.
  const install = async (pin: string): Promise<boolean> => {
    const r = await window.bm.update.install(pin);
    if (r.ok) return true; // main is about to close the app
    if (!r.wrongPin) {
      setAsking(false);
      toast.error(r.message);
      return true;
    }
    return false;
  };

  return (
    <SettingsSection icon={Download} title={t.title} adminOnly>
      <div className={styles.row}>
        <span className={styles.label}>{t.thisVersion}</span>
        <span className={styles.version}>{window.bm.version}</span>
        {state.status === 'available' ? (
          <Button small variant="outline" onClick={() => run(window.bm.update.download)}>
            {t.download}
          </Button>
        ) : state.status === 'downloaded' ? (
          <Button small variant="outline" onClick={() => setAsking(true)}>
            {t.install}
          </Button>
        ) : (
          <Button small variant="outline" disabled={busy} onClick={() => run(window.bm.update.check)}>
            {t.check}
          </Button>
        )}
      </div>
      {line !== '' && (
        <p className={state.status === 'error' ? styles.pinError : styles.status} role="status" aria-live="polite">
          {line}
        </p>
      )}
      {state.status === 'downloaded' && state.notice && (
        <p className={styles.pinError} role="alert">
          {state.notice}
        </p>
      )}
      {state.status === 'installing' && (
        <ol className={styles.steps}>
          {t.steps.map((label, i) => (
            <li key={label} className={i === state.step ? styles.stepNow : i < state.step ? styles.stepDone : ''}>
              {label}
            </li>
          ))}
        </ol>
      )}
      <PinDialog open={asking} title={t.installTitle} prompt={t.installPrompt} label={strings.pins.adminLabel} onCancel={() => setAsking(false)} onSubmit={install} />
    </SettingsSection>
  );
}

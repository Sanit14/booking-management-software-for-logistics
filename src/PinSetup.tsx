import { useState } from 'react';
import type { ResultCode } from '../shared';
import styles from './PinSetup.module.css';
import { strings } from './strings';
import Button from './ui/Button';
import { Card } from './ui/Card';
import Field from './ui/Field';
import { PinEntry } from './ui/PinDialog';

const t = strings.pins;

type Step = 'code' | 'admin' | 'admin2' | 'system' | 'system2' | 'saving' | 'done';

/**
 * Choose both PINs (each typed twice), then show the recovery code once. `first-run` is the very first start;
 * `recover` starts with the recovery code instead. The keeper decides everything; this only collects digits.
 */
export function PinSetupFlow({ mode, onDone, onCodeShown }: { mode: 'first-run' | 'recover'; onDone: () => void; onCodeShown?: () => void }) {
  const [step, setStep] = useState<Step>(mode === 'recover' ? 'code' : 'admin');
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState('');
  const [system, setSystem] = useState('');
  const [typedCode, setTypedCode] = useState('');
  const [newCode, setNewCode] = useState('');

  const save = (systemPin: string) => {
    setStep('saving');
    const done = mode === 'recover' ? window.bm.keeper.pins.recover(typedCode, admin, systemPin) : window.bm.keeper.pins.setup(admin, systemPin);
    void done.then((r) => {
      if (r.ok) {
        setNewCode(r.value.recoveryCode);
        onCodeShown?.(); // the PINs are already replaced: from here only the button may close a dialog around this
        return setStep('done');
      }
      // Another computer finished the first-run setup while this one was typing: nothing to do but carry on.
      if (r.code === 'pins-already-set') return onDone();
      setError(strings.result(r.code, r.detail));
      // ponytail: a wrong recovery code is only found out here, after both PINs were typed; a pre-check route
      // would need a second recovery-code gate. Add one if clerks hit it.
      const retryCode: ResultCode[] = ['wrong-recovery-code', 'pin-locked'];
      setStep(retryCode.includes(r.code) ? 'code' : 'admin');
    });
  };

  const first = (pin: string, next: Step, remember: (p: string) => void) => {
    setError(null);
    remember(pin);
    setStep(next);
    return true;
  };

  const again = (pin: string, expected: string, back: Step, ok: () => void) => {
    if (pin === expected) {
      setError(null);
      ok();
    } else {
      setError(t.mismatch);
      setStep(back);
    }
    return true;
  };

  return (
    <div className={styles.flow}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {step === 'code' && (
        <form
          className={styles.codeForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (typedCode.trim()) {
              setError(null);
              setStep('admin');
            }
          }}
        >
          <p>{t.recoverIntro}</p>
          <Field label={t.recoverLabel} value={typedCode} onChange={(e) => setTypedCode(e.target.value)} autoFocus maxLength={20} />
          <Button type="submit" disabled={!typedCode.trim()}>
            {t.recoverContinue}
          </Button>
        </form>
      )}
      {step === 'admin' && <PinEntry key="a1" prompt={t.chooseAdmin} label={t.adminLabel} onSubmit={(p) => first(p, 'admin2', setAdmin)} />}
      {step === 'admin2' && (
        <PinEntry key="a2" prompt={t.repeatAdmin} label={t.adminLabel} onSubmit={(p) => again(p, admin, 'admin', () => setStep('system'))} />
      )}
      {step === 'system' && (
        <PinEntry
          key="s1"
          prompt={t.chooseSystem}
          label={t.systemLabel}
          wrongText={strings.result('pins-same')}
          onSubmit={(p) => (p === admin ? false : first(p, 'system2', setSystem))} // the keeper enforces this too
        />
      )}
      {step === 'system2' && <PinEntry key="s2" prompt={t.repeatSystem} label={t.systemLabel} onSubmit={(p) => again(p, system, 'system', () => save(p))} />}
      {step === 'saving' && <p role="status">{t.saving}</p>}
      {step === 'done' && (
        <div className={styles.done}>
          <p>{t.codeText}</p>
          <div className={styles.code} aria-label={t.codeTitle}>
            {newCode}
          </div>
          <Button data-autofocus="" onClick={onDone}>
            {t.codeDone}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shown instead of the app on the first start, until the PINs exist. */
export default function PinSetup({ onDone }: { onDone: () => void }) {
  return (
    <main className={styles.page}>
      <Card title={t.setupTitle} className={styles.card}>
        <div className={styles.intro}>
          <p>{t.setupIntro}</p>
          <PinSetupFlow mode="first-run" onDone={onDone} />
        </div>
      </Card>
    </main>
  );
}

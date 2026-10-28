import { useState } from 'react';
import { strings } from '../strings';
import Dialog from './Dialog';
import styles from './PinDialog.module.css';

const PIN_LENGTH = 4;

interface EntryProps {
  /** Checking the PIN is the caller's job (it asks the keeper). Return true when accepted; false shakes and clears. */
  onSubmit: (pin: string) => boolean | Promise<boolean>;
  /** The line above the dots; the default asks for the System PIN. */
  prompt?: string;
  /** Accessible name of the input. */
  label?: string;
  /** Shown under the dots after a refusal; the default is "Wrong PIN". */
  wrongText?: string;
}

interface Props extends EntryProps {
  open: boolean;
  title: string;
  onCancel: () => void;
}

/** Four dots, filled by the keyboard's digits; the fourth digit submits. */
export default function PinDialog({ open, title, onCancel, ...entry }: Props) {
  return (
    <Dialog open={open} title={title} onCancel={onCancel}>
      <PinEntry {...entry} />
    </Dialog>
  );
}

/** The dots on their own, for flows that sit in a page or a dialog of their own (PIN setup, PIN change). */
export function PinEntry({ onSubmit, prompt, label, wrongText }: EntryProps) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false); // message stays until the next digit
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = (raw: string) => {
    if (busy) return;
    const next = raw.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setPin(next);
    setWrong(false);
    if (next.length < PIN_LENGTH) return;
    setBusy(true);
    void Promise.resolve(onSubmit(next))
      .catch(() => false) // a failed check counts as wrong; the caller says why (toast)
      .then((ok) => {
        if (!ok) {
          setWrong(true);
          setShaking(true);
        }
        setPin('');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.wrap}>
      <p>{prompt ?? strings.ui.pinPrompt(PIN_LENGTH)}</p>
      <div className={`${styles.dots} ${shaking ? styles.shake : ''}`.trim()} onAnimationEnd={() => setShaking(false)}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < pin.length ? styles.filled : styles.dot} />
        ))}
        {/* The real input sits invisibly over the dots so the keyboard, paste and screen readers all work. */}
        <input
          data-autofocus=""
          autoFocus // a Dialog focuses data-autofocus itself; on a page (PIN setup) this does it
          className={styles.input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label ?? strings.ui.pinLabel}
          value={pin}
          readOnly={busy} // not disabled: a disabled input loses focus and the next try could not be typed
          onChange={(e) => change(e.target.value)}
        />
      </div>
      <div className={styles.message} role="alert">
        {wrong && (wrongText ?? strings.ui.pinWrong)}
      </div>
    </div>
  );
}

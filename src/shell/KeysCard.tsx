import { useEffect, useState } from 'react';
import { ACTIONS, DEFAULT_KEYS, checkChange, eventToKey, keyLabel, type ActionId, type KeyCheck } from '../logic/keymap';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import KeyCap from '../ui/KeyCap';
import { useToast } from '../ui/Toast';
import { useKeys } from '../useKeys';
import styles from './SettingsPage.module.css';

const t = strings.keys;

const refusal = (c: Exclude<KeyCheck, { ok: true }>) => (c.why === 'used' ? t.used(t.actions[c.by]) : t[c.why]);

/** This seat's shortcuts: Change an action, press the new key; a refused key says why and keeps waiting. Every change is saved in the seat's own file and applies at once. */
export default function KeysCard() {
  const toast = useToast();
  const { keys, save } = useKeys();
  const [changing, setChanging] = useState<ActionId | null>(null);
  const [message, setMessage] = useState<string>();

  // While waiting for the new key nothing else may react to it: this listener runs first and stops the event.
  useEffect(() => {
    if (changing === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const key = e.repeat ? null : eventToKey(e);
      if (key === null) return;
      if (key === 'Escape') {
        setChanging(null);
        setMessage(undefined);
        return;
      }
      const check = checkChange(keys, changing, key);
      if (!check.ok) return setMessage(refusal(check));
      setChanging(null);
      setMessage(undefined);
      save({ ...keys, [changing]: key }).then(
        () => toast.success(t.savedToast(t.actions[changing], keyLabel(key))),
        () => toast.error(t.notSaved),
      );
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [changing, keys, save, toast]);

  const reset = () => {
    setChanging(null);
    setMessage(undefined);
    save({ ...DEFAULT_KEYS }).then(
      () => toast.success(t.resetToast),
      () => toast.error(t.notSaved),
    );
  };

  return (
    <Card title={t.title} className={styles.wide}>
      <div className={styles.body}>
        <p>{t.text}</p>
        <ul className={styles.keyList}>
          {ACTIONS.map((a) => (
            <li key={a} className={styles.keyRow}>
              <span className={styles.keyAction}>{t.actions[a]}</span>
              <span className={styles.keyValue}>{changing === a ? <em>{t.pressKey}</em> : <KeyCap>{keyLabel(keys[a])}</KeyCap>}</span>
              <Button
                small
                variant="outline"
                onClick={() => {
                  setMessage(undefined);
                  setChanging(a);
                }}
                onBlur={() => changing === a && setChanging(null)}
              >
                {t.change}
              </Button>
              {changing === a && message && (
                <span className={styles.keyError} role="alert">
                  {message}
                </span>
              )}
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={reset}>
          {t.reset}
        </Button>
      </div>
    </Card>
  );
}

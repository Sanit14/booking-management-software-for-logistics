import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { strings } from '../strings';
import styles from './Field.module.css';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Money box: ₹ prefix, right-aligned. The caller parses the text (parseRupees lives in the keeper). */
  money?: boolean;
  /** Wrapper class, for width in a form row. */
  className?: string;
  /** Rendered inside the field's box after the input: used by TypeAhead for its list. */
  children?: ReactNode;
}

/** Label + input + hint/error. Read-only is the normal `readOnly` attribute and is styled to look fixed. */
export default function Field({ label, hint, error, required, money, className, children, ...input }: FieldProps) {
  const id = useId();
  const note = error ?? hint;
  const noteId = note ? `${id}-note` : undefined;
  const box = [styles.box, input.readOnly ? styles.readOnly : '', error ? styles.invalid : '', money ? styles.money : ''];
  return (
    <div className={`${styles.field} ${className ?? ''}`.trim()}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} title={strings.required} aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className={styles.inputWrap}>
        {money && <span className={styles.rupee}>{strings.ui.rupee}</span>}
        <input
          inputMode={money ? 'decimal' : undefined}
          autoComplete="off"
          {...input}
          id={id}
          className={box.join(' ').trim()}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[noteId, input['aria-describedby']].filter(Boolean).join(' ') || undefined}
        />
        {children}
      </div>
      {note && (
        <div id={noteId} className={error ? styles.error : styles.hint} role={error ? 'alert' : undefined}>
          {note}
        </div>
      )}
    </div>
  );
}

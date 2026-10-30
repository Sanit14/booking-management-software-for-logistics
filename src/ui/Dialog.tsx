import { useEffect, useId, useRef, type ReactNode } from 'react';
import { strings } from '../strings';
import Button from './Button';
import styles from './Dialog.module.css';

interface Props {
  open: boolean;
  title: string;
  /** Called for Esc and the Cancel button. The caller sets `open` to false. */
  onCancel: () => void;
  /** Absent = a dialog with only Cancel (PinDialog drives its own submit). */
  onConfirm?: () => void;
  confirmLabel?: string;
  /** Wording of the Cancel button, e.g. "Go back". */
  cancelLabel?: string;
  /** No Cancel button, for a step that must not be dismissed (the caller also ignores onCancel, i.e. Esc). */
  hideCancel?: boolean;
  /** Red confirm button; focus starts on Cancel instead of Confirm. */
  danger?: boolean;
  /** Wide enough for a whole form (Quick LR). */
  wide?: boolean;
  children?: ReactNode;
}

/**
 * Modal built on the native <dialog>: showModal() traps Tab inside, makes the page behind inert, and gives focus
 * back to whatever opened it when it closes. Esc is routed to onCancel. Children are mounted only while open,
 * so their state starts fresh each time. Mark the control that should get focus first with data-autofocus.
 */
export default function Dialog({ open, title, onCancel, onConfirm, confirmLabel, cancelLabel, hideCancel, danger, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Where the cursor was when the dialog opened: a text box gets its caret back too, not only the focus.
  const opener = useRef<{ el: HTMLElement; from: number | null; to: number | null } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      const el = document.activeElement;
      opener.current = el instanceof HTMLInputElement ? { el, from: el.selectionStart, to: el.selectionEnd } : null;
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && d.open) {
      d.close();
      const back = opener.current;
      opener.current = null;
      if (back?.el.isConnected && back.from !== null && back.to !== null) {
        back.el.focus();
        (back.el as HTMLInputElement).setSelectionRange(back.from, back.to);
      }
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? `${styles.dialog} ${styles.wide}` : styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // the caller closes it by clearing `open`
        onCancel();
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <div className={styles.body}>{children}</div>
          <div className={styles.actions}>
            {!hideCancel && (
              <Button variant="outline" small onClick={onCancel} data-autofocus={danger || !onConfirm ? '' : undefined}>
                {cancelLabel ?? strings.ui.cancel}
              </Button>
            )}
            {onConfirm && (
              <Button variant={danger ? 'danger' : 'primary'} small onClick={onConfirm} data-autofocus={danger ? undefined : ''}>
                {confirmLabel ?? strings.ui.ok}
              </Button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

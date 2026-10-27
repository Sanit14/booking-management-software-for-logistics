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
  /** Red confirm button; focus starts on Cancel instead of Confirm. */
  danger?: boolean;
  children?: ReactNode;
}

/**
 * Modal built on the native <dialog>: showModal() traps Tab inside, makes the page behind inert, and gives focus
 * back to whatever opened it when it closes. Esc is routed to onCancel. Children are mounted only while open,
 * so their state starts fresh each time. Mark the control that should get focus first with data-autofocus.
 */
export default function Dialog({ open, title, onCancel, onConfirm, confirmLabel, danger, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
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
            <Button variant="outline" small onClick={onCancel} data-autofocus={danger || !onConfirm ? '' : undefined}>
              {strings.ui.cancel}
            </Button>
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

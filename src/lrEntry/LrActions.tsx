import { useState } from 'react';
import type { LrDetail } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import LrHistory from './LrHistory';
import styles from './LrEntryPage.module.css';

const t = strings.lr;
type Step = null | 'edit' | 'reason' | 'cancel' | 'restore';

interface Props {
  lr: LrDetail;
  editing: boolean;
  /** Another seat saved this LR while it is being edited here. */
  changedElsewhere: boolean;
  /** The System PIN typed for Edit: the form checks it with the keeper and switches to edit mode. */
  onEdit: (pin: string) => Promise<boolean>;
  onDiscard: () => void;
  /** Show this LR in the form (what a change answered with), or null for a new, empty LR. */
  onOpen: (lr: LrDetail | null) => void;
}

/**
 * The strip above an opened LR: its number and status, and Edit / Cancel LR / Restore / History / New LR.
 * Cancel asks a reason, then the System PIN; the keeper checks the PIN with the action itself, so a wrong PIN just
 * shakes the dots and nothing is written.
 */
export default function LrActions({ lr, editing, changedElsewhere, onEdit, onDiscard, onOpen }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [showHistory, setShowHistory] = useState(false);
  const cancelled = lr.status === 'cancelled';

  const close = () => {
    setStep(null);
    setReason('');
    setReasonError(undefined);
  };
  // A refusal that is not a wrong PIN ends the dialog; a stale one also shows the LR as it is now.
  const refused = (r: { code: Parameters<typeof strings.result>[0]; detail?: string; lr?: LrDetail }) => {
    close();
    if (r.code === 'lr-stale') toast.warning(t.stale(lr.lrNo));
    else if (r.code === 'lr-on-memo') toast.error(t.onMemo(lr.lrNo, r.detail ?? ''));
    else toast.error(strings.result(r.code, r.detail));
    if (r.lr) onOpen(r.lr);
  };

  const askPin = () => {
    if (reason.trim() === '') return setReasonError(t.fieldError.required);
    setReasonError(undefined);
    setStep('cancel');
  };
  const cancelWithPin = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.lrs.cancel(lr.id, lr.version, reason, pin);
    if (r.ok) {
      toast.success(t.cancelledToast(lr.lrNo));
      close();
      onOpen(r.value);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    if (r.code === 'lr-invalid') {
      setReasonError(t.fieldError.required); // the keeper found the reason unusable (too long): back to the reason
      setStep('reason');
      return true;
    }
    refused(r);
    return true;
  };
  const restoreWithPin = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.lrs.restore(lr.id, lr.version, pin);
    if (r.ok) {
      toast.success(t.restoredToast(lr.lrNo));
      close();
      onOpen(r.value);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    refused(r);
    return true;
  };

  return (
    <div className={styles.openBar}>
      <strong className={styles.openTitle}>{editing ? t.editing(lr.lrNo) : t.lrTitle(lr.lrNo)}</strong>
      <Chip kind={lr.status} />
      {lr.memoNo !== null && <span className={styles.openNote}>{t.memoNote(lr.memoNo)}</span>}
      {changedElsewhere && (
        <span className={styles.openWarn} role="status">
          {t.changedElsewhere}
        </span>
      )}
      <span className={styles.openActions}>
        {editing ? (
          <Button small variant="outline" onClick={onDiscard}>
            {t.actions.discard}
          </Button>
        ) : (
          <>
            {cancelled ? (
              <Button small autoFocus onClick={() => setStep('restore')}>
                {t.actions.restore}
              </Button>
            ) : (
              <>
                <Button small autoFocus onClick={() => setStep('edit')}>
                  {t.actions.edit}
                </Button>
                <Button small variant="outline" onClick={() => setStep('reason')}>
                  {t.actions.cancel}
                </Button>
              </>
            )}
            <Button small variant="outline" onClick={() => setShowHistory(true)}>
              {t.actions.history}
            </Button>
            <Button small variant="outline" keyCap={strings.ui.esc} onClick={() => onOpen(null)}>
              {t.actions.newLr}
            </Button>
          </>
        )}
      </span>

      <PinDialog open={step === 'edit'} title={t.editPinTitle(lr.lrNo)} onCancel={close} onSubmit={async (pin) => {
        const ok = await onEdit(pin);
        if (ok) close();
        return ok;
      }} />
      <Dialog open={step === 'reason'} title={t.cancelTitle(lr.lrNo)} cancelLabel={t.goBack} confirmLabel={t.cancelContinue} onCancel={close} onConfirm={askPin}>
        <Field
          data-autofocus=""
          label={t.cancelReason}
          hint={t.cancelReasonHint}
          error={reasonError}
          required
          maxLength={200}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              askPin();
            }
          }}
        />
      </Dialog>
      <PinDialog open={step === 'cancel'} title={t.cancelTitle(lr.lrNo)} onCancel={() => setStep('reason')} onSubmit={cancelWithPin} />
      <PinDialog open={step === 'restore'} title={t.restoreTitle(lr.lrNo)} onCancel={close} onSubmit={restoreWithPin} />
      <LrHistory lr={lr} open={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  );
}

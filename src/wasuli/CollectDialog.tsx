import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { WasuliCollectInput, WasuliField, WasuliFieldError, WasuliMode, WasuliRow } from '../../shared';
import { matches } from '../logic/keymap';
import { isoToDisplay } from '../logic/lrOpen';
import { paiseToField } from '../logic/rupees';
import { rupees } from '../loadingMemo/columns';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import SelectField from '../ui/SelectField';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeys } from '../useKeys';
import styles from './WasuliPage.module.css';

const t = strings.wasuli;
export type CollectErrors = Partial<Record<WasuliField, WasuliFieldError>>;
const MODES: WasuliMode[] = ['cash', 'upi', 'card'];

interface Props {
  /** The assigned row being collected; null = closed. The boxes start fresh for each row. */
  row: WasuliRow | null;
  onCancel: () => void;
  /** Sends the collection. Resolves with what the keeper found wrong (the dialog stays open), or null (done, or the page has closed it). */
  onSubmit: (input: WasuliCollectInput) => Promise<CollectErrors | null>;
}

/**
 * Amount (all of it to start with), how it was paid and a remark. Enter walks the boxes and saves on the remark; the seat's
 * save key saves from anywhere. The keeper checks everything (the amount against what is owed, too); this only collects it.
 */
export default function CollectDialog({ row, onCancel, onSubmit }: Props) {
  const { keys } = useKeys();
  const enterToNext = useEnterToNext();
  const [amount, setAmount] = useState(row ? paiseToField(row.amountPaise) : '');
  const [mode, setMode] = useState<WasuliMode | ''>('');
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<CollectErrors>({});
  const form = useRef<HTMLFormElement>(null);
  // The dialog stays mounted (so closing it gives the focus back); another row starts the boxes again.
  const [forRow, setForRow] = useState<number | null>(null);
  if ((row?.id ?? null) !== forRow) {
    setForRow(row?.id ?? null);
    setAmount(row ? paiseToField(row.amountPaise) : '');
    setMode('');
    setRemark('');
    setErrors({});
  }

  const submit = async () => {
    const found = await onSubmit({ amount, mode: mode === '' ? null : mode, remark });
    if (found) setErrors(found);
  };
  // The seat's save key, while this dialog is the one open.
  const saveNow = useRef(submit);
  useEffect(() => {
    saveNow.current = submit;
  });
  const open = row !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.repeat || !matches(keys.saveLr, e)) return;
      e.preventDefault();
      void saveNow.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, keys.saveLr]);

  // A refusal puts the cursor on the box to fix.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    enterToNext(e);
    if (e.key === 'Enter' && !e.defaultPrevented && e.target instanceof HTMLInputElement && e.target.name === 'remark') {
      e.preventDefault();
      void submit();
    }
  };
  const change = (set: () => void, field: WasuliField) => {
    set();
    setErrors((now) => ({ ...now, [field]: undefined }));
  };
  const say = (field: WasuliField) => (errors[field] ? t.fieldError[errors[field] as string] : undefined);

  return (
    <Dialog open={open} title={row ? t.collectTitle(row.lrNo, isoToDisplay(row.lrDate)) : ''} cancelLabel={strings.ui.cancel} confirmLabel={t.collectConfirm} onCancel={onCancel} onConfirm={() => void submit()}>
      {row && (
        <form ref={form} className={styles.collectForm} onKeyDown={onKeyDown} onSubmit={(e) => e.preventDefault()} noValidate>
          <p className={styles.collectFor}>{t.collectFor(row.consignee, rupees(row.amountPaise))}</p>
          <Field
            money
            data-autofocus=""
            onFocus={(e) => e.target.select()}
            label={t.amountLabel}
            hint={t.amountHint}
            error={say('amount')}
            value={amount}
            onChange={(e) => change(() => setAmount(e.target.value), 'amount')}
          />
          <SelectField
            label={t.modeLabel}
            aria-invalid={errors.mode ? true : undefined}
            value={mode}
            onChange={(e) => change(() => setMode(e.target.value as WasuliMode | ''), 'mode')}
            options={[{ value: '', label: t.modeChoose }, ...MODES.map((m) => ({ value: m, label: t.mode[m] }))]}
          />
          {errors.mode && <div className={styles.fieldError} role="alert">{say('mode')}</div>}
          <Field name="remark" label={t.remarkField} hint={t.remarkHint} error={say('remark')} value={remark} onChange={(e) => change(() => setRemark(e.target.value), 'remark')} />
        </form>
      )}
    </Dialog>
  );
}

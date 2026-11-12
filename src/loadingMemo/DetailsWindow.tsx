import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PendingTotals } from '../../shared';
import { keyLabel, matches } from '../logic/keymap';
import { blankLines, previewReady, roundText, saveKeyWanted, settlementLines, windowErrors, type SettlementAnswer } from '../logic/memoDetails';
import { formatFixed } from '../logic/rupees';
import { strings } from '../strings';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import { useToast } from '../ui/Toast';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeys } from '../useKeys';
import styles from './DetailsWindow.module.css';
import { Steps } from './SettlementCard';

const t = strings.memo.details;
const rupee = strings.ui.rupee;
const NOTHING: PendingTotals = { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, wasuliPaise: 0 };

interface Props {
  open: boolean;
  /** One line under the title: which memo this is for. */
  subtitle: string;
  /** The ticked LRs a new memo is made of (their totals are added up by the keeper); ignored when `memoId` is set. Keep it stable between renders. */
  ids: number[];
  /** A saved memo: Edit rate / commission works from the totals frozen on it, what was printed. */
  memoId?: number | null;
  /** What the boxes start with: empty for a new memo (no default), the saved values for an edit. */
  initialRate?: string;
  initialCommission?: string;
  /** A save is on its way: both buttons and the key wait. */
  busy: boolean;
  /** Bump it to ask the keeper again (a save was refused and the figures may have moved). */
  refresh?: number;
  onSave: (rate: string, commission: string, print: boolean) => void;
  /** Esc and the close button: back to where the clerk was, nothing sent. */
  onBack: () => void;
}

/**
 * "Details of report" (4.6): the totals of the ticked LRs, the two boxes the clerk types (hamali rate per article, commission %) and, as they type, the
 * settlement and the round figure. The keeper works every figure out and checks both boxes; this only asks it after each change and shows the answer.
 * Nothing is saved here: the two buttons and the seat's save key hand the typed text to `onSave` once, and only when the answer is for exactly what is
 * typed now. Enter goes rate → commission → the Save & print button; Esc goes back.
 */
export default function DetailsWindow(props: Props) {
  // The body is mounted only while the window is open (the Dialog draws its children only then), so every opening starts from the values it is given.
  return (
    <Dialog open={props.open} wide noActions title={t.title} onCancel={() => !props.busy && props.onBack()}>
      <DetailsBody {...props} />
    </Dialog>
  );
}

function DetailsBody({ subtitle, ids, memoId = null, initialRate = '', initialCommission = '', busy, refresh = 0, onSave, onBack }: Props) {
  const { keys } = useKeys();
  const toast = useToast();
  const enterToNext = useEnterToNext();
  const edit = memoId !== null;
  const [rate, setRate] = useState(initialRate);
  const [commission, setCommission] = useState(initialCommission);
  const [answer, setAnswer] = useState<SettlementAnswer | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [moved, setMoved] = useState(0); // another seat changed an LR or a memo: ask again
  const body = useRef<HTMLDivElement>(null);

  // Ask the keeper after every change of the text (and when an LR or a memo changed anywhere): only the newest answer is kept.
  useEffect(() => {
    let live = true;
    void window.bm.keeper.memos.settlement(ids, rate, commission, memoId).then((r) => {
      if (!live) return;
      if (r.ok) setAnswer({ rate, commission, preview: r.value });
      else toast.error(strings.result(r.code, r.detail)); // the keeper could not answer: say so (the buttons stay without figures, they never save blind)
    });
    return () => {
      live = false;
    };
    // the toast function is stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, rate, commission, memoId, moved, refresh]);
  useEffect(() => {
    return window.bm.keeper.onChanged((c) => {
      if (c.tables.includes('lrs') || c.tables.includes('memos')) setMoved((n) => n + 1);
    });
  }, []);

  const ready = previewReady(answer, rate, commission);
  const errors = windowErrors(answer, rate, commission, attempted);
  const preview = answer?.preview ?? null;
  const totals = preview?.totals ?? NOTHING;
  const settlement = preview?.settlement ?? null;

  const box = (name: 'rate' | 'commission') => body.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`) ?? null;
  const focusFirstToFix = (shown: { hamaliRate?: string; commission?: string }) => (shown.hamaliRate || rate.trim() === '' ? box('rate') : box('commission'))?.focus();

  /** The two buttons and the key: save when the figures are for what is typed; else mark what is missing and go to the first box to fix. */
  const trySave = (print: boolean) => {
    if (busy) return;
    if (ready) return onSave(rate, commission, print);
    setAttempted(true);
    focusFirstToFix(windowErrors(answer, rate, commission, true));
  };

  // The seat's save key, while this window is the dialog in front.
  const latest = useRef(trySave);
  useEffect(() => {
    latest.current = trySave;
  });
  const saveKey = keys.saveLr;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const dialogs = document.querySelectorAll('dialog[open]');
      const mine = body.current?.closest('dialog');
      if (!saveKeyWanted({ isSaveKey: matches(saveKey, e), repeat: e.repeat, topmost: !!mine && dialogs[dialogs.length - 1] === mine, saving: busy })) return;
      e.preventDefault();
      latest.current(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveKey, busy]);

  // Enter: rate → commission (the usual walk), commission → the Save & print button (a second Enter saves, so the clerk sees the figure first).
  const typeKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.defaultPrevented && !e.nativeEvent.isComposing && e.target instanceof HTMLInputElement && e.target.name === 'commission') {
      e.preventDefault();
      body.current?.closest('dialog')?.querySelector<HTMLElement>('[data-save-print]')?.focus();
      return;
    }
    enterToNext(e);
  };

  const lines = settlement ? settlementLines(settlement) : blankLines(totals);
  const figures: [string, string][] = [
    [t.articles, String(totals.qty)],
    [t.paid, `${rupee} ${formatFixed(totals.paidPaise)}`],
    [t.toPay, `${rupee} ${formatFixed(totals.toPayPaise)}`],
    [t.wasuli, `${rupee} ${formatFixed(totals.wasuliPaise)}`],
  ];

  return (
    <div ref={body} className={styles.window}>
      <p className={styles.subtitle}>{subtitle}</p>
      <div className={styles.grid}>
        <div className={styles.left}>
          <section aria-label={edit ? t.fromSaved : t.fromLrs}>
            <h3 className={styles.kicker}>{edit ? t.fromSaved : t.fromLrs}</h3>
            <dl className={styles.figures}>
              {figures.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className={styles.typeBox} onKeyDown={typeKeys}>
            <h3 className={styles.kicker}>{t.typeHere}</h3>
            <Field
              data-autofocus=""
              name="rate"
              label={t.rate}
              inputMode="decimal"
              placeholder={t.ratePlaceholder}
              error={errors.hamaliRate}
              hint={t.rateTimes(totals.qty)}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <Field
              name="commission"
              label={t.commission}
              inputMode="decimal"
              placeholder={t.commissionPlaceholder}
              error={errors.commission}
              hint={settlement ? t.commissionOf(formatFixed(settlement.commissionBasePaise)) : undefined}
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
            <p className={styles.note}>{t.noDefault}</p>
          </div>
        </div>
        <section className={styles.right} aria-label={t.settlement} aria-live="polite">
          <h3 className={styles.kicker}>{t.settlement}</h3>
          <Steps lines={lines} />
          <div className={styles.round}>
            <div>
              <strong>{t.round}</strong>
              <span>{t.roundHint}</span>
            </div>
            <output aria-label={t.round}>{settlement ? `${rupee} ${roundText(settlement)}` : `${rupee} ${strings.memo.none}`}</output>
          </div>
          <p className={styles.note}>{t.notAdded}</p>
        </section>
      </div>
      <div className={styles.footer}>
        <Button variant="ghost" small keyCap={t.esc} onClick={onBack} disabled={busy}>
          {edit ? t.editEscHint : t.escHint}
        </Button>
        <span className={styles.buttons}>
          <Button variant="outline" disabled={busy} onClick={() => trySave(false)}>
            {edit ? t.save : t.saveOnly}
          </Button>
          <Button keyCap={keyLabel(keys.saveLr)} data-save-print="" disabled={busy} onClick={() => trySave(true)}>
            {edit ? t.saveAndPrintEdit : t.saveAndPrint}
          </Button>
        </span>
      </div>
    </div>
  );
}

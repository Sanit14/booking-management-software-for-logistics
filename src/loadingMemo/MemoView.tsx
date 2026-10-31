import { useMemo, useState, type ChangeEvent } from 'react';
import type { KeeperResult, MastersAll, MemoDetail, MemoField, MemoHeaderInput, MemoListRow, MemoLrRow, MemoTaken, MemoTotals } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import type { Box, Ticks } from '../logic/memoPick';
import { toggle } from '../logic/memoPick';
import { matchKey } from '../logic/typeAhead';
import { strings } from '../strings';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import Table from '../ui/Table';
import { useToast } from '../ui/Toast';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useKeeperData } from '../useKeeperData';
import { lrColumns, rupees } from './columns';
import styles from './LoadingMemoPage.module.css';
import MemoHistory from './MemoHistory';
import PendingPicker from './PendingPicker';
import TakenDialog from './TakenDialog';

const t = strings.memo;
type Step = null | 'edit' | 'editPin' | 'removePin' | 'move' | 'movePin' | 'add' | 'addPin' | 'recalculatePin' | 'reason' | 'cancelPin';
type Fail = Extract<KeeperResult<unknown>, { ok: false }>;

/** The header boxes of the edit dialog. */
interface Draft {
  date: string;
  truck: Box;
  driver: Box;
  from: Box;
  to: Box;
  hire: string;
  hamali: string;
}
const plain = (paise: number): string => (paise / 100).toFixed(2).replace(/\.00$/, '');
const draftOf = (m: MemoDetail): Draft => ({
  date: m.date,
  truck: { text: m.truck, id: m.truckId },
  driver: { text: m.driver, id: m.driverId },
  from: { text: m.fromStation, id: m.fromStationId },
  to: { text: m.toStation, id: m.toStationId },
  hire: plain(m.truckHirePaise),
  hamali: plain(m.loadingHamaliPaise),
});

function Totals({ v }: { v: MemoTotals }) {
  return (
    <>
      <span>
        {t.frozen.lrs} <strong>{v.lrs}</strong>
      </span>
      <span>
        {t.frozen.qty} <strong>{v.qty}</strong>
      </span>
      <span>
        {t.frozen.toPay} <strong>{rupees(v.toPayPaise)}</strong>
      </span>
      <span>
        {t.frozen.paid} <strong>{rupees(v.paidPaise)}</strong>
      </span>
      <span>
        {t.frozen.charges} <strong>{rupees(v.chargesPaise)}</strong>
      </span>
      <span>
        {t.frozen.stax} <strong>{rupees(v.staxPaise)}</strong>
      </span>
    </>
  );
}

interface Props {
  id: number;
  masters: MastersAll;
  today: string;
  oldestPending: string | null;
}

/**
 * A saved memo: its header, the totals frozen when it was saved (next to the totals now when its LRs no longer add up to
 * them) and its LRs, with what can be done to it. A change asks for its PIN (System for the header and the LRs, Admin for
 * Recalculate and Cancel); the keeper checks the PIN with the change and answers all or nothing. The screen adds nothing up.
 */
export default function MemoView({ id, masters, today, oldestPending }: Props) {
  const toast = useToast();
  const memo = useKeeperData<MemoDetail | null>(() => window.bm.keeper.memos.get(id), ['memos', 'lrs'], null, [id]).data;
  const [step, setStep] = useState<Step>(null);
  const [ticks, setTicks] = useState<Ticks>(new Set()); // LRs on this memo picked for Remove / Move
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<MemoField, string>>>({});
  const [target, setTarget] = useState<number | null>(null);
  const [targetText, setTargetText] = useState('');
  const [targetError, setTargetError] = useState<string>();
  const [added, setAdded] = useState<Ticks>(new Set()); // pending LRs picked for Add
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [taken, setTaken] = useState<MemoTaken[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // The ticks that are still LRs of this memo (another seat may have taken one off).
  const onMemo = useMemo(() => new Set((memo?.lrs ?? []).map((l) => l.id)), [memo?.lrs]);
  const picked = useMemo(() => [...ticks].filter((x) => onMemo.has(x)), [ticks, onMemo]);
  const tickedKeys = useMemo(() => new Set(picked.map(String)), [picked]);
  // Saved memos to move LRs to: the newest hundred, this one and the cancelled left out.
  const moving = step === 'move' || step === 'movePin';
  const memos = useKeeperData<MemoListRow[]>(
    async () => {
      if (!moving) return { ok: true as const, value: [] }; // only a Move needs them
      const r = await window.bm.keeper.memos.list({ from: null, to: null, truckId: null, toStationId: null }, null);
      return r.ok ? { ok: true as const, value: r.value.rows } : r;
    },
    ['memos'],
    [],
    [moving],
  ).data;

  if (!memo) return null; // a memo that is not there says so in a toast
  const cancelled = memo.status === 'cancelled';

  const close = () => {
    setStep(null);
    setErrors({});
    setTargetError(undefined);
    setReasonError(undefined);
  };
  // A refusal that is not a wrong PIN ends the step; a stale one says so (the memo on screen follows its own event).
  const refused = (r: Fail) => {
    close();
    if (r.code === 'memo-conflict') setTaken(r.taken ?? []);
    else if (r.code === 'memo-stale') toast.warning(t.stale(memo.challanNo));
    else if (r.code === 'memo-invalid' && r.memoFields?.lrs === 'many') toast.error(t.fieldError.many);
    else toast.error(strings.result(r.code, r.detail));
  };
  /** Runs a PIN-checked change: false = a wrong PIN (the dots shake), true = the step is over, done or refused. */
  const attempt = async <T,>(pin: string, call: (pin: string) => Promise<KeeperResult<T>>, done: (v: T) => void): Promise<boolean> => {
    const r = await call(pin);
    if (r.ok) {
      done(r.value);
      close();
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    if (r.code === 'memo-invalid' && step === 'editPin') {
      // the keeper found something in the header the screen did not: back to the form with it marked
      const fields: Partial<Record<MemoField, string>> = {};
      for (const [k, why] of Object.entries(r.memoFields ?? {})) fields[k as MemoField] = t.fieldError[why];
      setErrors(fields);
      setStep('edit');
      return true;
    }
    refused(r);
    return true;
  };

  // ---- Edit header ----
  const year = memo.date.slice(0, 4);
  const options = (list: { id: number; label: string; active: boolean }[], keep: number): Option[] =>
    list.filter((x) => x.active || x.id === keep).map((x) => ({ id: String(x.id), label: x.label }));
  const truckOptions = options(masters.trucks.map((x) => ({ id: x.id, label: x.number, active: x.active })), memo.truckId);
  const driverOptions = options(masters.drivers.map((x) => ({ id: x.id, label: x.name, active: x.active })), memo.driverId);
  const fromOptions = options(masters.stations.map((x) => ({ id: x.id, label: x.name, active: x.active })), memo.fromStationId);
  const toOptions = options(masters.stations.map((x) => ({ id: x.id, label: x.name, active: x.active })), memo.toStationId);
  /** The row a box means: the one picked, else a name typed in full; null when it is in no list. */
  const resolve = (b: Box, list: Option[]): number | null => {
    const hit = list.find((o) => matchKey(o.label) === matchKey(b.text));
    return b.id ?? (hit ? Number(hit.id) : null);
  };
  const headerOf = (d: Draft): MemoHeaderInput | null => {
    const found = { truck: resolve(d.truck, truckOptions), driver: resolve(d.driver, driverOptions), fromStation: resolve(d.from, fromOptions), toStation: resolve(d.to, toOptions) };
    const bad: Partial<Record<MemoField, string>> = {};
    if (found.truck === null) bad.truck = t.fieldError.missing;
    if (found.driver === null) bad.driver = t.fieldError.missing;
    if (found.fromStation === null) bad.fromStation = t.fieldError.missing;
    if (found.toStation === null) bad.toStation = t.fieldError.missing;
    setErrors(bad);
    if (Object.keys(bad).length > 0) return null;
    return { date: d.date, truckId: found.truck, driverId: found.driver, fromStationId: found.fromStation, toStationId: found.toStation, truckHire: d.hire, loadingHamali: d.hamali };
  };
  const field = (k: Exclude<keyof Draft, 'date'>, v: Box | string) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setErrors({});
  };
  const editHeader = async (pin: string) =>
    attempt(
      pin,
      (p) => window.bm.keeper.memos.editHeader(memo.id, memo.version, headerOf(draft as Draft) as MemoHeaderInput, p),
      (r) => (r.changed ? toast.success(t.edited(memo.challanNo)) : toast.info(t.editedNothing)),
    );

  // ---- Move LR ----
  const targets: Option[] = memos
    .filter((m) => m.status === 'saved' && m.id !== memo.id)
    .map((m) => ({ id: String(m.id), label: t.moveTargetOption(m.challanNo, m.truck, m.toStation, isoToDisplay(m.date)) }));
  const askTarget = () => {
    if (target === null) return setTargetError(t.fieldError.missing);
    setTargetError(undefined);
    setStep('movePin');
  };
  const targetNo = memos.find((m) => m.id === target)?.challanNo ?? 0;

  // ---- Cancel ----
  const askPin = () => {
    if (reason.trim() === '') return setReasonError(t.fieldError.required);
    setReasonError(undefined);
    setStep('cancelPin');
  };

  const f = memo.frozen;
  const lrRows: MemoLrRow[] = memo.lrs;
  return (
    <>
      <h3 className={styles.viewHead}>
        {t.viewHead(memo.challanNo, isoToDisplay(memo.date))}
        <Chip kind={memo.status} />
        {memo.differs && <Chip kind="differs" />}
      </h3>
      <dl className={styles.details}>
        {(
          [
            ['truck', memo.truck],
            ['driver', memo.driver],
            ['from', memo.fromStation],
            ['to', memo.toStation],
            ['truckHire', rupees(memo.truckHirePaise)],
            ['loadingHamali', rupees(memo.loadingHamaliPaise)],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{t.viewDetails[k]}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {memo.differs ? (
        <div className={styles.differsBox} role="status">
          {t.differsText}
          <div className={styles.frozen}>
            <span className={styles.frozenTitle}>{t.frozenTitle}</span>
            <Totals v={f} />
          </div>
          <div className={styles.frozen}>
            <span className={styles.frozenTitle}>{t.nowTitle}</span>
            <Totals v={memo.now} />
          </div>
        </div>
      ) : (
        <div className={styles.frozen}>
          <span className={styles.frozenTitle}>{t.frozenTitle}</span>
          <Totals v={f} />
        </div>
      )}
      <div className={styles.actions} role="group" aria-label={t.actionsLabel}>
        {!cancelled && (
          <>
            <Button small onClick={() => { setDraft(draftOf(memo)); setStep('edit'); }}>
              {t.actions.edit}
            </Button>
            <Button small variant="outline" disabled={picked.length === 0} onClick={() => setStep('removePin')}>
              {picked.length > 0 ? t.removeCount(picked.length) : t.actions.remove}
            </Button>
            <Button small variant="outline" disabled={picked.length === 0} onClick={() => { setTarget(null); setTargetText(''); setStep('move'); }}>
              {picked.length > 0 ? t.moveCount(picked.length) : t.actions.move}
            </Button>
            <Button small variant="outline" onClick={() => { setAdded(new Set()); setStep('add'); }}>
              {t.actions.add}
            </Button>
            {memo.differs && (
              <Button small variant="outline" onClick={() => setStep('recalculatePin')}>
                {t.actions.recalculate}
              </Button>
            )}
            <Button small variant="outline" onClick={() => { setReason(''); setStep('reason'); }}>
              {t.actions.cancel}
            </Button>
          </>
        )}
        <Button small variant="outline" onClick={() => setShowHistory(true)}>
          {t.actions.history}
        </Button>
      </div>
      {!cancelled && <p className={styles.changeBar}>{t.pickToChange}</p>}
      <Table
        label={t.lrsLabel}
        columns={lrColumns}
        rows={lrRows}
        rowKey={(r) => String(r.id)}
        ticked={tickedKeys}
        empty={t.noLrs}
        maxHeight={200}
        onRowActivate={cancelled ? undefined : (r) => setTicks((now) => toggle(now, r.id))}
        onRowToggle={cancelled ? undefined : (r) => setTicks((now) => toggle(now, r.id))}
      />

      {/* Edit header: the form, then the System PIN */}
      <Dialog open={step === 'edit'} wide title={t.editTitle(memo.challanNo)} cancelLabel={t.goBack} confirmLabel={t.save} onCancel={close} onConfirm={() => {
          if (draft && headerOf(draft)) setStep('editPin');
        }}>
        {draft && (
          <div className={styles.formGrid}>
            <Field
              data-autofocus=""
              label={t.date}
              type="date"
              min={`${year}-01-01`}
              max={today}
              hint={t.editSameYear}
              error={errors.date}
              value={draft.date}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setDraft({ ...draft, date: e.target.value || memo.date });
                setErrors({});
              }}
            />
            <TypeAhead label={t.truck} required listLabel={t.truckList} error={errors.truck} value={draft.truck.text} options={truckOptions} onChange={(x) => field('truck', { text: x, id: null })} onPick={(o) => field('truck', { text: o.label, id: Number(o.id) })} />
            <TypeAhead label={t.driver} required listLabel={t.driverList} error={errors.driver} value={draft.driver.text} options={driverOptions} onChange={(x) => field('driver', { text: x, id: null })} onPick={(o) => field('driver', { text: o.label, id: Number(o.id) })} />
            <TypeAhead label={t.from2} required listLabel={t.stationList} error={errors.fromStation} value={draft.from.text} options={fromOptions} onChange={(x) => field('from', { text: x, id: null })} onPick={(o) => field('from', { text: o.label, id: Number(o.id) })} />
            <TypeAhead label={t.to2} required listLabel={t.stationList} error={errors.toStation} value={draft.to.text} options={toOptions} onChange={(x) => field('to', { text: x, id: null })} onPick={(o) => field('to', { text: o.label, id: Number(o.id) })} />
            <Field money label={t.truckHire} error={errors.truckHire} value={draft.hire} onChange={(e) => field('hire', e.target.value)} />
            <Field money label={t.loadingHamali} error={errors.loadingHamali} value={draft.hamali} onChange={(e) => field('hamali', e.target.value)} />
          </div>
        )}
      </Dialog>
      <PinDialog open={step === 'editPin'} title={t.pinEdit(memo.challanNo)} onCancel={() => setStep('edit')} onSubmit={editHeader} />

      {/* Remove LR */}
      <PinDialog
        open={step === 'removePin'}
        title={t.pinRemove(memo.challanNo)}
        onCancel={close}
        onSubmit={(pin) =>
          attempt(pin, (p) => window.bm.keeper.memos.removeLrs(memo.id, picked, p), () => {
            toast.success(t.removed(picked.length));
            setTicks(new Set());
          })
        }
      />

      {/* Move LR: the memo to move to, then the System PIN */}
      <Dialog open={step === 'move'} title={t.moveTitle(picked.length)} cancelLabel={t.goBack} confirmLabel={t.moveContinue} onCancel={close} onConfirm={askTarget}>
        <TypeAhead
          data-autofocus=""
          label={t.moveTarget}
          required
          listLabel={t.moveTargetList}
          error={targetError}
          value={targetText}
          options={targets}
          onChange={(x) => {
            setTargetText(x);
            setTarget(null);
            setTargetError(undefined);
          }}
          onPick={(o) => {
            setTargetText(o.label);
            setTarget(Number(o.id));
            setTargetError(undefined);
          }}
        />
      </Dialog>
      <PinDialog
        open={step === 'movePin'}
        title={t.pinMove(memo.challanNo)}
        onCancel={() => setStep('move')}
        onSubmit={(pin) =>
          attempt(pin, (p) => window.bm.keeper.memos.moveLrs(memo.id, picked, target as number, p), () => {
            toast.success(t.moved(picked.length, targetNo));
            setTicks(new Set());
          })
        }
      />

      {/* Add LRs: the pending list, then the System PIN */}
      <Dialog open={step === 'add'} wide title={t.addTitle(memo.challanNo)} cancelLabel={t.goBack} confirmLabel={t.addCount(added.size)} onCancel={close} onConfirm={() => (added.size > 0 ? setStep('addPin') : toast.warning(t.noneTicked))}>
        <div className={styles.pickerBox}>
          <PendingPicker masters={masters} mastersLoaded today={today} oldestPending={oldestPending} ticks={added} onTicks={setAdded} />
        </div>
      </Dialog>
      <PinDialog
        open={step === 'addPin'}
        title={t.pinAdd(memo.challanNo)}
        onCancel={() => setStep('add')}
        onSubmit={(pin) => attempt(pin, (p) => window.bm.keeper.memos.addLrs(memo.id, [...added], p), () => toast.success(t.added(added.size)))}
      />

      {/* Recalculate (Admin PIN) */}
      <PinDialog
        open={step === 'recalculatePin'}
        title={t.pinRecalculate(memo.challanNo)}
        prompt={strings.lrDefaults.pinPrompt}
        label={strings.lrDefaults.pinLabel}
        onCancel={close}
        onSubmit={(pin) =>
          attempt(pin, (p) => window.bm.keeper.memos.recalculate(memo.id, memo.version, p), (r) => (r.changed ? toast.success(t.recalculated(memo.challanNo)) : toast.info(t.recalculatedNothing)))
        }
      />

      {/* Cancel memo: a reason, then the Admin PIN */}
      <Dialog open={step === 'reason'} title={t.cancelTitle(memo.challanNo)} cancelLabel={t.goBack} confirmLabel={t.cancelContinue} danger onCancel={close} onConfirm={askPin}>
        <p>{t.cancelText}</p>
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
      <PinDialog
        open={step === 'cancelPin'}
        title={t.pinCancel(memo.challanNo)}
        prompt={strings.lrDefaults.pinPrompt}
        label={strings.lrDefaults.pinLabel}
        onCancel={() => setStep('reason')}
        onSubmit={(pin) => attempt(pin, (p) => window.bm.keeper.memos.cancel(memo.id, memo.version, reason, p), () => toast.success(t.cancelledToast(memo.challanNo)))}
      />

      <TakenDialog taken={taken} text={t.conflictChangeText} onClose={() => setTaken(null)} />
      <MemoHistory id={memo.id} no={memo.challanNo} version={memo.version} open={showHistory} onClose={() => setShowHistory(false)} />
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CalendarDays, Info, Undo2 } from 'lucide-react';
import { MAX_MEMO_LRS, type KeeperResult, type LrDefaults, type MastersAll, type MemoDefaults, type MemoField, type MemoListRow, type MemoTaken, type PendingTotals } from '../../shared';
import { errorSummary } from '../logic/errorSummary';
import { keyLabel, matches } from '../logic/keymap';
import { isoToDisplay } from '../logic/lrOpen';
import type { Box, Ticks } from '../logic/memoPick';
import { matchKey } from '../logic/typeAhead';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeeperData } from '../useKeeperData';
import { useKeys } from '../useKeys';
import { rupees } from './columns';
import styles from './LoadingMemoPage.module.css';
import TakenDialog from './TakenDialog';

const t = strings.memo;
const lr = strings.lr;
const ZERO: PendingTotals = { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0 };
const TODAYS_SHOWN = 3;

const noBox: Box = { text: '', id: null };
type Errors = Partial<Record<MemoField, string>>;
const labelOf = (field: string): string =>
  ({ date: t.date, reason: t.cancelReason, truck: t.truck, driver: t.driver, fromStation: t.from2, toStation: t.to2, truckHire: t.truckHire, loadingHamali: t.loadingHamali, lrs: t.pendingTitle })[field as MemoField] ?? field;

interface Props {
  masters: MastersAll;
  ticks: Ticks;
  /** The list's To-station filter, if one is set: the memo's To follows it until another station is picked. */
  filterStation: { id: number; name: string } | null;
  /** A memo was saved: the page clears its ticks. */
  onSaved: () => void;
  /** These ticked LRs were taken by another seat first. */
  onTaken: (ids: number[]) => void;
  /** Open a saved memo (a chip of today's memos). */
  onOpen: (id: number) => void;
}

/**
 * The new memo: truck, driver, From, To, truck hire and loading hamali for the ticked LRs, with the ticked LRs' totals as
 * the keeper adds them up. The keeper decides everything (the number, whether every LR can still be loaded); this only
 * collects the typed values and says what came back.
 */
export default function MemoPanel({ masters, ticks, filterStation, onSaved, onTaken, onOpen }: Props) {
  const toast = useToast();
  const { keys } = useKeys();
  const enterToNext = useEnterToNext();
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState<string | null>(null); // null = today; another day is unlocked with the System PIN
  const pin = useRef(''); // the PIN that unlocked the date, sent with each save (the keeper checks it every time)
  const [askingPin, setAskingPin] = useState(false);
  const [from, setFrom] = useState<Box | null>(null); // null = the booking station
  const [to, setTo] = useState<Box | null>(null); // null = the list's To-station filter
  const [truck, setTruck] = useState<Box>(noBox);
  const [driver, setDriver] = useState<Box>(noBox);
  const [hire, setHire] = useState('');
  const [hamali, setHamali] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [focusError, setFocusError] = useState(0); // bumped when a refusal should put the cursor on the first box to fix
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<MemoTaken[] | null>(null);
  const inFlight = useRef(false); // two F4s before the first re-render must not send two saves
  // One uid per set of ticked LRs: a retry of the same save carries the same one (the keeper then returns the memo it already
  // saved), but other LRs ticked since are another memo and must not be mistaken for it.
  const attempt = useRef({ key: '', uid: crypto.randomUUID() });

  const lrDefaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(null), ['settings'], null);
  const memoDefaults = useKeeperData<MemoDefaults | null>(() => window.bm.keeper.memos.defaults(date), ['memos'], null, [date]);
  const ids = useMemo(() => [...ticks], [ticks]);
  const tooMany = ids.length > MAX_MEMO_LRS; // the keeper's totals and a save both stop at the limit: say so before it matters
  const totals = useKeeperData<PendingTotals>(
    () => (ids.length > 0 ? window.bm.keeper.memos.totals(ids) : Promise.resolve({ ok: true as const, value: ZERO })),
    ['lrs', 'memos'],
    ZERO,
    [ids.join(',')],
  ).data;
  const todays = useKeeperData<MemoListRow[]>(() => window.bm.keeper.memos.byDate(null), ['memos'], []).data;
  const today = memoDefaults.data?.today ?? '';

  const stationOptions = useMemo<Option[]>(() => masters.stations.filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name })), [masters.stations]);
  const truckOptions = useMemo<Option[]>(() => masters.trucks.filter((x) => x.active).map((x) => ({ id: String(x.id), label: x.number })), [masters.trucks]);
  const driverOptions = useMemo<Option[]>(
    () => masters.drivers.filter((d) => d.active).map((d) => ({ id: String(d.id), label: d.name, hint: d.phone || undefined })),
    [masters.drivers],
  );
  const booking = masters.stations.find((s) => s.active && s.id === lrDefaults.data?.bookingStationId);
  const fromBox: Box = from ?? (booking ? { text: booking.name, id: booking.id } : noBox);
  const toBox: Box = to ?? (filterStation ? { text: filterStation.name, id: filterStation.id } : noBox);
  /** The master row a box means: the one picked, else a name typed in full. Null when it is empty or not in the list. */
  const resolve = (b: Box, options: Option[]): number | null => {
    if (b.id !== null) return b.id;
    const hit = options.find((o) => matchKey(o.label) === matchKey(b.text));
    return hit ? Number(hit.id) : null;
  };

  const refuse = (fields: Errors) => {
    setErrors(fields);
    setFocusError((n) => n + 1);
  };
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  const handleRefusal = (r: Extract<KeeperResult<unknown>, { ok: false }>) => {
    switch (r.code) {
      case 'memo-invalid': {
        const fields: Errors = {};
        for (const [k, why] of Object.entries(r.memoFields ?? {})) fields[k as MemoField] = t.fieldError[why];
        if (fields.lrs) toast.error(fields.lrs);
        return refuse(fields);
      }
      case 'memo-conflict':
        return setTaken(r.taken ?? []);
      case 'wrong-pin':
      case 'pin-locked':
        // The PIN that unlocked the date no longer works (it was changed, or locked): back to today.
        pin.current = '';
        setDate(null);
        toast.error(strings.result(r.code, r.detail));
        return;
      default:
        toast.error(strings.result(r.code, r.detail));
    }
  };

  const save = async (): Promise<void> => {
    if (inFlight.current) return;
    if (ids.length === 0) return void toast.warning(t.noneTicked);
    if (tooMany) return void toast.error(t.fieldError.many);
    // A box typed but not in its list is the clerk's to fix before anything is sent.
    const truckId = resolve(truck, truckOptions);
    const driverId = resolve(driver, driverOptions);
    const fromId = resolve(fromBox, stationOptions);
    const toId = resolve(toBox, stationOptions);
    const local: Errors = {};
    const need = (field: MemoField, box: Box, id: number | null) => {
      if (id === null) local[field] = box.text.trim() === '' ? t.fieldError.required : t.fieldError.missing;
    };
    need('truck', truck, truckId);
    need('driver', driver, driverId);
    need('fromStation', fromBox, fromId);
    need('toStation', toBox, toId);
    if (Object.keys(local).length > 0) return refuse(local);

    setErrors({});
    const key = ids.join(',');
    if (attempt.current.key !== key) attempt.current = { key, uid: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await window.bm.keeper.memos.create({
        uid: attempt.current.uid,
        date,
        systemPin: date === null ? '' : pin.current,
        truckId,
        driverId,
        fromStationId: fromId,
        toStationId: toId,
        truckHire: hire,
        loadingHamali: hamali,
        lrIds: ids,
      });
      if (!r.ok) return handleRefusal(r);
      const { challanNo, lrCount, again } = r.value;
      if (again) toast.info(t.savedAgain(challanNo));
      else toast.success(t.saved(challanNo), t.savedDetail(lrCount));
      // Ready for the next truck: the date and From stay, everything about this truck goes.
      attempt.current = { key: '', uid: crypto.randomUUID() };
      setTruck(noBox);
      setDriver(noBox);
      setTo(null);
      setHire('');
      setHamali('');
      onSaved();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // The seat's save key saves from anywhere on the page, unless a dialog is open (Quick LR, a PIN, a saved memo).
  const saveNow = useRef(save);
  const saveKey = useRef(keys.saveLr);
  useEffect(() => {
    saveNow.current = save;
    saveKey.current = keys.saveLr;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // not while a dialog is open, nor while the other tab is showing
      if (e.repeat || document.querySelector('dialog[open]') || !form.current?.offsetParent || !matches(saveKey.current, e)) return;
      e.preventDefault();
      void saveNow.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // "Change date": the System PIN is checked by the keeper now, and again with every save.
  const checkPin = async (value: string): Promise<boolean> => {
    const r = await window.bm.keeper.pins.verify('system', value);
    if (r.ok) {
      pin.current = value;
      setDate(today);
      setAskingPin(false);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    toast.error(strings.result(r.code, r.detail)); // locked, or the keeper did not answer
    setAskingPin(false);
    return true;
  };
  const backToToday = () => {
    pin.current = '';
    setDate(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };
  const clearError = (field: MemoField) => setErrors((e) => (e[field] === undefined ? e : { ...e, [field]: undefined }));
  const problem = errorSummary(errors, labelOf);
  const isToday = date === null;
  const closeTaken = () => {
    const lost = taken ?? [];
    setTaken(null);
    onTaken(lost.map((x) => x.id));
  };
  const shown = todays.slice(0, TODAYS_SHOWN);

  return (
    <Card className={styles.panel}>
      <div className={styles.panelHead}>
        <strong className={styles.panelTitle}>{t.panelTitle}</strong>
        <span className={styles.panelNote}>{memoDefaults.data ? t.nextNo(memoDefaults.data.nextNo) : ''}</span>
        {!isToday && <span className={styles.warn}>{lr.dateBackdated}</span>}
        {(tooMany || problem) && (
          <span className={styles.warn} aria-hidden={tooMany ? undefined : 'true'} title={tooMany ? t.fieldError.many : problem}>
            {tooMany ? t.fieldError.many : problem}
          </span>
        )}
        <div className={styles.panelTotals} role="group" aria-label={t.totalsLabel} aria-live="polite">
          <span>
            {t.totals.lrs} <strong>{totals.lrs}</strong>
          </span>
          <span>
            {t.totals.qty} <strong>{totals.qty}</strong>
          </span>
          <span>
            {t.totals.toPay} <strong>{rupees(totals.toPayPaise)}</strong>
          </span>
          <span>
            {t.totals.paid} <strong>{rupees(totals.paidPaise)}</strong>
          </span>
        </div>
      </div>
      <form ref={form} className={styles.panelForm} aria-label={t.panelLabel} onSubmit={submit} onKeyDown={enterToNext} noValidate>
        <div className={styles.row}>
          <Field
            className={styles.dateField}
            label={t.date}
            title={isToday ? lr.dateHint : lr.dateBackdated}
            error={errors.date}
            data-skip-enter=""
            {...(isToday
              ? { readOnly: true, tabIndex: -1, value: today ? isoToDisplay(today) : '' }
              : { type: 'date', max: today, value: date ?? '', onChange: (e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value || today) })}
          >
            <button
              type="button"
              className={styles.dateButton}
              title={isToday ? lr.changeDate : lr.backToToday}
              aria-label={isToday ? lr.changeDate : lr.backToToday}
              disabled={isToday && !today} // until the keeper has said what today is, there is no date to unlock
              onClick={isToday ? () => setAskingPin(true) : backToToday}
            >
              {isToday ? <CalendarDays size={20} aria-hidden="true" /> : <Undo2 size={20} aria-hidden="true" />}
            </button>
          </Field>
          <TypeAhead
            className={styles.grow}
            label={t.truck}
            required
            listLabel={t.truckList}
            placeholder={t.pickPlaceholder}
            error={errors.truck}
            value={truck.text}
            options={truckOptions}
            onChange={(text) => {
              setTruck({ text, id: null });
              clearError('truck');
            }}
            onPick={(o) => {
              setTruck({ text: o.label, id: Number(o.id) });
              clearError('truck');
            }}
          />
          <TypeAhead
            className={styles.grow}
            label={t.driver}
            required
            listLabel={t.driverList}
            placeholder={t.pickPlaceholder}
            error={errors.driver}
            value={driver.text}
            options={driverOptions}
            onChange={(text) => {
              setDriver({ text, id: null });
              clearError('driver');
            }}
            onPick={(o) => {
              setDriver({ text: o.label, id: Number(o.id) });
              clearError('driver');
            }}
          />
        </div>
        <div className={styles.row}>
          {/* From is the booking station and is walked past by Enter (Tab still reaches it), as on the LR form. */}
          <TypeAhead
            className={styles.stationField}
            label={t.from2}
            required
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            data-skip-enter=""
            error={errors.fromStation}
            value={fromBox.text}
            options={stationOptions}
            onChange={(text) => {
              setFrom({ text, id: null });
              clearError('fromStation');
            }}
            onPick={(o) => {
              setFrom({ text: o.label, id: Number(o.id) });
              clearError('fromStation');
            }}
          />
          <TypeAhead
            className={styles.stationField}
            label={t.to2}
            required
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            error={errors.toStation}
            value={toBox.text}
            options={stationOptions}
            onChange={(text) => {
              setTo({ text, id: null });
              clearError('toStation');
            }}
            onPick={(o) => {
              setTo({ text: o.label, id: Number(o.id) });
              clearError('toStation');
            }}
          />
          <Field
            money
            className={styles.hire}
            label={t.truckHire}
            error={errors.truckHire}
            value={hire}
            onChange={(e) => {
              setHire(e.target.value);
              clearError('truckHire');
            }}
          />
          <Field
            money
            className={styles.hamali}
            label={t.loadingHamali}
            error={errors.loadingHamali}
            value={hamali}
            onChange={(e) => {
              setHamali(e.target.value);
              clearError('loadingHamali');
            }}
          />
          <Button type="submit" className={styles.create} keyCap={keyLabel(keys.saveLr)} disabled={busy || ids.length === 0 || tooMany}>
            {busy ? t.saving : t.create(ids.length)}
          </Button>
        </div>
        <p className={styles.noteLine}>
          <Info size={16} aria-hidden="true" />
          {t.note}
        </p>
      </form>
      <div className={styles.today} role="group" aria-label={t.todayTitle}>
        <strong className={styles.todayTitle}>{t.todayTitle}</strong>
        {todays.length === 0 ? (
          <span className={styles.panelNote}>{t.todayNone}</span>
        ) : (
          shown.map((m) => (
            <button key={m.id} type="button" className={styles.todayChip} aria-label={t.todayChipLabel(m.challanNo)} title={t.todayChip(m.challanNo, m.truck, m.toStation, m.lrCount)} onClick={() => onOpen(m.id)}>
              {t.todayChip(m.challanNo, m.truck, m.toStation, m.lrCount)}
            </button>
          ))
        )}
        {todays.length > TODAYS_SHOWN && <span className={styles.panelNote}>{t.todayMore(todays.length - TODAYS_SHOWN)}</span>}
      </div>

      <PinDialog open={askingPin} title={lr.changeDateTitle} onCancel={() => setAskingPin(false)} onSubmit={checkPin} />
      <TakenDialog taken={taken} text={t.conflictText} onClose={closeTaken} />
    </Card>
  );
}

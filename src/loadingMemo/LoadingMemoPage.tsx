import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CalendarDays, Undo2 } from 'lucide-react';
import { MAX_MEMO_LRS, type KeeperResult, type LrDefaults, type MemoDefaults, type MemoField, type MemoTaken, type PendingTotals } from '../../shared';
import { keyLabel, matches } from '../logic/keymap';
import { isoToDisplay } from '../logic/lrOpen';
import { nextEnabled, refusalStep, resolveHeader, settlementRefusal } from '../logic/memoDetails';
import { NOTHING_PICKED, onlyStation, untick, type Box, type Picked, type Ticks } from '../logic/memoPick';
import type { Jump } from '../logic/searchResults';
import { MASTER_TABLES, NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card, PageHeader } from '../ui/Card';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useKeeperData } from '../useKeeperData';
import { useKeys } from '../useKeys';
import { usePrint } from '../usePrint';
import { rupees } from './columns';
import detail from './DetailsWindow.module.css';
import DetailsWindow from './DetailsWindow';
import styles from './LoadingMemoPage.module.css';
import PendingPicker from './PendingPicker';
import TakenDialog from './TakenDialog';

const t = strings.memo;
const lr = strings.lr;
const ZERO: PendingTotals = { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, wasuliPaise: 0 };
const noBox: Box = { text: '', id: null };
type Errors = Partial<Record<MemoField, string>>;

interface Props {
  /** A Dashboard row asking for one To station. */
  jump: Jump | null;
  onJumpUsed: () => void;
  /** Open a saved memo (it lives on the Saved Memos page). */
  onOpenMemo: (id: number) => void;
}

/**
 * Loading Memo, in two steps (4.7). Step 1 is the pending LRs and their filters: tick the LRs going on one truck, then Next. Step 2 is "Memo details", a window with
 * the truck boxes, the hamali rate and the commission % and, as they are typed, the settlement and the round figure; nothing is sent until the clerk saves from it.
 * The keeper decides everything (the number, whether every LR can still be loaded, the settlement); this only collects what was ticked and typed and says what came back.
 */
export default function LoadingMemoPage({ jump, onJumpUsed, onOpenMemo }: Props) {
  const toast = useToast();
  const print = usePrint();
  const { keys } = useKeys();
  const page = useRef<HTMLDivElement>(null);
  const headerBox = useRef<HTMLDivElement>(null);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const lrDefaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(null), ['stations'], null);

  const [ticks, setTicks] = useState<Ticks>(new Set());
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [date, setDate] = useState<string | null>(null); // null = today; another day is unlocked with the System PIN
  const pin = useRef(''); // the PIN that unlocked the date, sent with each save (the keeper checks it every time)
  const [askingPin, setAskingPin] = useState(false);
  const [from, setFrom] = useState<Box | null>(null); // null = the booking station
  const [to, setTo] = useState<Box | null>(null); // null = the one station filtered
  const [truck, setTruck] = useState<Box>(noBox);
  const [driver, setDriver] = useState<Box>(noBox);
  const [hire, setHire] = useState('');
  const [hamali, setHamali] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [focusError, setFocusError] = useState(0); // bumped when a refusal should put the cursor on the first box to fix
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<MemoTaken[] | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recheck, setRecheck] = useState(0); // bumped when the keeper refused the rate or the % so the window asks for its figures again
  const inFlight = useRef(false); // two F4s before the first re-render must not send two saves
  const refocus = useRef(false); // a memo was saved: the cursor goes back to the stations when its window has closed
  // One uid per set of ticked LRs: a retry of the same save carries the same one (the keeper then returns the memo it already
  // saved), but other LRs ticked since are another memo and must not be mistaken for it.
  const attempt = useRef({ key: '', uid: crypto.randomUUID() });

  const memoDefaults = useKeeperData<MemoDefaults | null>(() => window.bm.keeper.memos.defaults(date), ['memos'], null, [date]);
  const ids = useMemo(() => [...ticks], [ticks]);
  const tooMany = ids.length > MAX_MEMO_LRS; // the keeper's totals and a save both stop at the limit: say so before it matters
  const totals = useKeeperData<PendingTotals>(
    () => (ids.length > 0 ? window.bm.keeper.memos.totals(ids) : Promise.resolve({ ok: true as const, value: ZERO })),
    ['lrs', 'memos'],
    ZERO,
    [ids.join(',')],
  ).data;
  const today = memoDefaults.data?.today ?? '';

  const stationOptions = useMemo<Option[]>(() => masters.data.stations.filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name })), [masters.data.stations]);
  const truckOptions = useMemo<Option[]>(() => masters.data.trucks.filter((x) => x.active).map((x) => ({ id: String(x.id), label: x.number })), [masters.data.trucks]);
  const driverOptions = useMemo<Option[]>(
    () => masters.data.drivers.filter((d) => d.active).map((d) => ({ id: String(d.id), label: d.name, hint: d.phone || undefined })),
    [masters.data.drivers],
  );
  const booking = masters.data.stations.find((s) => s.active && s.id === lrDefaults.data?.bookingStationId);
  const only = masters.data.stations.find((s) => s.active && s.id === onlyStation(picked));
  const fromBox: Box = from ?? (booking ? { text: booking.name, id: booking.id } : noBox);
  const toBox: Box = to ?? (only ? { text: only.name, id: only.id } : noBox);

  const refuse = (fields: Errors) => {
    setErrors(fields);
    setFocusError((n) => n + 1);
  };
  useEffect(() => {
    if (focusError > 0) headerBox.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  // Ready for the next truck: the date and From stay, everything about this truck goes.
  const readyForNext = () => {
    attempt.current = { key: '', uid: crypto.randomUUID() };
    setTicks(new Set());
    setTruck(noBox);
    setDriver(noBox);
    setTo(null);
    setHire('');
    setHamali('');
    setErrors({});
    refocus.current = true; // the window is still closing: the effect below moves the cursor once it is gone
  };
  useEffect(() => {
    if (detailsOpen || !refocus.current) return;
    refocus.current = false;
    page.current?.querySelector<HTMLElement>('[role="group"] input[type="checkbox"]')?.focus(); // the first station
  }, [detailsOpen]);

  const handleRefusal = (r: Extract<KeeperResult<unknown>, { ok: false }>) => {
    switch (refusalStep(r.code, r.memoFields)) {
      case 'open':
        // The first answer was lost and the clerk changed something before saving again: the memo exists, a second one is never made.
        // Show it (the typed values are dropped; the clerk edits the saved memo instead).
        if (!r.memo) return toast.error(strings.result(r.code, r.detail));
        setDetailsOpen(false);
        toast.warning(t.alreadySaved(r.memo.challanNo));
        readyForNext();
        return onOpenMemo(r.memo.id);
      case 'recheck':
        // Only the settlement was refused: the window stays and asks for its figures again, which now say what is wrong.
        setRecheck((n) => n + 1);
        return toast.error(settlementRefusal(r.memoFields));
      case 'mark': {
        // A box of the header (or the LR list) was refused: the window stays open with the box marked.
        const fields: Errors = {};
        for (const [k, why] of Object.entries(r.memoFields ?? {})) fields[k as MemoField] = t.fieldError[why];
        if (fields.lrs) toast.error(fields.lrs);
        return refuse(fields);
      }
      case 'taken':
        setDetailsOpen(false);
        return setTaken(r.taken ?? []);
      case 'forget-date':
        // The PIN that unlocked the date no longer works (it was changed, or locked): back to today.
        pin.current = '';
        setDate(null);
        return toast.error(strings.result(r.code, r.detail));
      default:
        toast.error(strings.result(r.code, r.detail));
    }
  };

  /** The four boxes as master rows; null (with the wrong boxes marked) when something is missing. Nothing is sent. */
  const checked = () => {
    if (ids.length === 0 || tooMany) return null;
    const r = resolveHeader({ truck, driver, from: fromBox, to: toBox }, { trucks: truckOptions, drivers: driverOptions, stations: stationOptions });
    if (r.ok) {
      setErrors({});
      return r.ids;
    }
    const local: Errors = {};
    for (const [field, why] of Object.entries(r.problems)) local[field as MemoField] = t.fieldError[why];
    refuse(local);
    return null;
  };

  /** Next / the save key on the page: the window for the ticked LRs. Nothing is saved. */
  const openDetails = () => {
    if (inFlight.current) return;
    if (ids.length === 0) return void toast.warning(t.noneTicked);
    if (tooMany) return void toast.error(t.fieldError.many);
    setErrors({});
    setDetailsOpen(true);
  };

  /** The window's two buttons and its key: ONE save with the typed rate and %; with Save & print the memo then goes to the printer. */
  const save = async (hamaliRate: string, commission: string, printAfter: boolean): Promise<void> => {
    if (inFlight.current) return;
    const rows = checked();
    if (!rows) return;
    const key = ids.join(',');
    if (attempt.current.key !== key) attempt.current = { key, uid: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await window.bm.keeper.memos.create({
        uid: attempt.current.uid,
        date,
        systemPin: date === null ? '' : pin.current,
        truckId: rows.truckId,
        driverId: rows.driverId,
        fromStationId: rows.fromId,
        toStationId: rows.toId,
        truckHire: hire,
        loadingHamali: hamali,
        hamaliRate,
        commission,
        lrIds: ids,
      });
      if (!r.ok) return handleRefusal(r);
      const { id, challanNo, lrCount, again } = r.value;
      setDetailsOpen(false);
      if (again) {
        toast.info(t.savedAgain(challanNo));
        if (printAfter) void print.memo(id, challanNo, 'print'); // the answer to the first save was lost: the memo exists, and the print was asked for
      } else if (printAfter) {
        toast.success(t.saved(challanNo), t.savedDetail(lrCount));
        void print.memo(id, challanNo, 'print');
      } else toast.success(t.saved(challanNo), t.savedDetail(lrCount), { label: strings.print.print, onClick: () => void print.memo(id, challanNo, 'print') });
      readyForNext();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // The seat's save key opens "Memo details" from anywhere on the page, unless a dialog is open (Quick LR, a PIN, the window itself, which saves with it).
  const saveNow = useRef(openDetails);
  const saveKey = useRef(keys.saveLr);
  useEffect(() => {
    saveNow.current = openDetails;
    saveKey.current = keys.saveLr;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || document.querySelector('dialog[open]') || !matches(saveKey.current, e)) return;
      e.preventDefault();
      saveNow.current();
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

  const clearError = (field: MemoField) => setErrors((e) => (e[field] === undefined ? e : { ...e, [field]: undefined }));
  const isToday = date === null;
  const closeTaken = () => {
    const lost = taken ?? [];
    setTaken(null);
    setTicks((now) => untick(now, lost.map((x) => x.id)));
    setReloadSignal((n) => n + 1);
  };

  const header = (
    <section ref={headerBox} className={detail.truckBox} aria-label={t.details.truckBox}>
      <h3 className={detail.kicker}>{t.details.truckBox}</h3>
      <div className={detail.truckGrid}>
        <TypeAhead
          data-autofocus=""
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
        <TypeAhead
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
        {/* From is the booking station and is walked past by Enter (Tab still reaches it), as on the LR form. */}
        <TypeAhead
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
        <Field
          money
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
          label={t.loadingHamali}
          error={errors.loadingHamali}
          value={hamali}
          onChange={(e) => {
            setHamali(e.target.value);
            clearError('loadingHamali');
          }}
        />
      </div>
    </section>
  );

  // The memo's date is automatic; the calendar button asks the System PIN to change it (the keeper checks it again with every save).
  const dateLine = (
    <>
      <span>{t.details.newSubtitle(memoDefaults.data?.nextNo ?? null, ids.length, isoToDisplay(date ?? today))}</span>
      {isToday ? null : (
        <input
          type="date"
          className={styles.dateInput}
          aria-label={t.date}
          max={today}
          value={date ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value || today)}
        />
      )}
      <button
        type="button"
        className={styles.dateIcon}
        title={isToday ? lr.changeDate : lr.backToToday}
        aria-label={isToday ? lr.changeDate : lr.backToToday}
        disabled={isToday && !today} // until the keeper has said what today is, there is no date to unlock
        onClick={isToday ? () => setAskingPin(true) : backToToday}
      >
        {isToday ? <CalendarDays size={18} aria-hidden="true" /> : <Undo2 size={18} aria-hidden="true" />}
      </button>
      {!isToday && <span className={styles.warn}>{lr.dateBackdated}</span>}
      {errors.date && <span className={styles.warn}>{errors.date}</span>}
    </>
  );

  const next = (
    <Card className={styles.next}>
      <div className={styles.nextBody} role="group" aria-label={t.totalsLabel} aria-live="polite">
        <strong className={styles.nextTitle}>{t.lrsTicked(totals.lrs)}</strong>
        <div className={styles.nextFigures}>
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
        {tooMany && <span className={styles.warn}>{t.fieldError.many}</span>}
        <Button className={styles.nextButton} keyCap={keyLabel(keys.saveLr)} disabled={busy || !nextEnabled(ids.length, MAX_MEMO_LRS)} onClick={openDetails}>
          {t.next}
        </Button>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader title={t.pageTitle} subtitle={memoDefaults.data ? t.nextNo(memoDefaults.data.nextNo) : undefined} />
      <div ref={page} className={styles.page}>
        <PendingPicker
          masters={masters.data}
          ticks={ticks}
          onTicks={setTicks}
          stationJump={jump?.to === 'pending' ? jump.stationId : null}
          onStationUsed={onJumpUsed}
          onPicked={setPicked}
          reloadSignal={reloadSignal}
          footer={next}
          focusFirst
        />
      </div>
      <PinDialog open={askingPin} title={lr.changeDateTitle} onCancel={() => setAskingPin(false)} onSubmit={checkPin} />
      <DetailsWindow
        open={detailsOpen}
        subtitle={dateLine}
        ids={ids}
        busy={busy}
        refresh={recheck}
        header={header}
        precheck={() => checked() !== null}
        onSave={(rate, commission, printAfter) => void save(rate, commission, printAfter)}
        onBack={() => setDetailsOpen(false)}
      />
      <TakenDialog taken={taken} text={t.conflictText} onClose={closeTaken} />
    </>
  );
}

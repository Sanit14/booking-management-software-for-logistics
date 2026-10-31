import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CalendarDays, Undo2 } from 'lucide-react';
import type { ChargeOption, Firm, KeeperResult, LrDefaults, LrDetail, LrField, LrInput, LrParty, LrPreview, LrSaved, Station } from '../../shared';
import { applyDefaults, markManual, releaseIfEmpty, CHARGE_KEYS, type ChargeKey, type ChargeTexts } from '../logic/chargeFill';
import { clearDraft, hasTyped, keepDraft, loadDraft, type DraftSlot } from '../logic/drafts';
import { errorSummary } from '../logic/errorSummary';
import { keyLabel, matches } from '../logic/keymap';
import { formFromLr, isoToDisplay, type LrFormState as State, type Party, type Typed } from '../logic/lrOpen';
import { formatPaise } from '../logic/rupees';
import { matchKey } from '../logic/typeAhead';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import SelectField from '../ui/SelectField';
import { useToast } from '../ui/Toast';
import TypeAhead from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import { useKeys } from '../useKeys';
import LrActions from './LrActions';
import styles from './LrEntryPage.module.css';

const t = strings.lr;
const OPTION_KEY = 'bm.lrChargeOption'; // the last charge option used on this seat (this Windows user's profile)
const CHARGE_OPTIONS = (Object.keys(t.chargeOptions) as ChargeOption[]).map((value) => ({ value, label: t.chargeOptions[value] }));
const NO_CHARGES: ChargeTexts = { godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '' };

type Errors = Partial<Record<LrField, string>>;

const noParty: Party = { text: '', firmId: null, add: false };

function rememberedOption(): ChargeOption | null {
  try {
    const v = localStorage.getItem(OPTION_KEY);
    return v === 'option1' || v === 'option2' || v === 'blank' ? v : null;
  } catch {
    return null; // blocked storage: the Settings default is used
  }
}

/** Everything the clerk types is empty; the From station, the charge option and the service tax % are what the form starts from (and keeps after a save). */
function initial(d: LrDefaults, stations: Station[], keep?: State): State {
  const station = stations.find((s) => s.id === d.bookingStationId);
  return {
    from: keep?.from ?? { text: station?.name ?? '', id: station?.id ?? null },
    consignor: noParty,
    consignee: noParty,
    to: { text: '', id: null },
    particular: '',
    qty: '',
    toPay: '',
    paid: '',
    option: keep?.option ?? rememberedOption() ?? d.chargeOption,
    charges: NO_CHARGES,
    manual: new Set(),
    wasuli: '',
    stax: keep?.stax ?? d.staxPercent,
  };
}

const sameCharges = (a: ChargeTexts, b: ChargeTexts) => CHARGE_KEYS.every((k) => a[k] === b[k]);

interface Props {
  stations: Station[];
  firms: Firm[];
  defaults: LrDefaults;
  /** null = today. A date other than today was unlocked with the System PIN (a new LR only). */
  date: string | null;
  onDate: (date: string | null) => void;
  /** A saved LR: the form shows it read-only, and Edit (System PIN) makes it editable. Absent = a new LR. */
  lr?: LrDetail;
  /** Show this LR (what a change answered with), or null for a new, empty one. */
  onOpen: (lr: LrDetail | null) => void;
  /** Open the memo a saved LR is on (the Saved memos tab), when the page can. */
  onOpenMemo?: (memoId: number) => void;
  /** True while the form holds work that opening another LR would throw away (an edit, or a half-typed new LR). */
  onGuard?: (holding: boolean) => void;
  /** Which kept draft a new LR starts from and writes to: LR Entry and Quick LR each have their own. */
  draftSlot: DraftSlot;
  /** A new LR was saved (not a retry of an earlier save). */
  onSaved?: (saved: LrSaved) => void;
}

/**
 * The LR form. The clerk types, the keeper decides: money and quantity go to the keeper as the typed text, the live
 * amounts and the charge options' amounts come back from lrs.preview, and the number comes back from the save. The
 * form shows what it is given and never adds anything up.
 */
export default function LrForm({ stations, firms, defaults, date, onDate, lr, onOpen, onOpenMemo, onGuard, draftSlot, onSaved }: Props) {
  const toast = useToast();
  const { keys } = useKeys();
  const enterToNext = useEnterToNext();
  const nameOf = (id: number) => stations.find((s) => s.id === id)?.name ?? '';
  // A new LR picks up where the clerk left it (typed values only; the date unlock and its PIN are never kept).
  const [state, setState] = useState<State>(() => (lr ? formFromLr(lr, nameOf) : (loadDraft(draftSlot)?.state ?? initial(defaults, stations))));
  const [editing, setEditing] = useState(false);
  const locked = lr !== undefined && !editing; // a saved LR is read-only until Edit
  const [editDate, setEditDate] = useState(lr?.date ?? ''); // the date box of an LR being edited (within its year)
  const editPin = useRef(''); // the System PIN that opened Edit, sent with the save
  const [editBase, setEditBase] = useState(0); // the version Edit started from: a save from an older one is refused
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState<LrPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusError, setFocusError] = useState(0); // bumped when a refusal should put the cursor on the first box to fix
  const [askingPin, setAskingPin] = useState(false);
  const [similar, setSimilar] = useState<{ party: string; names: string[] } | null>(null);
  const uid = useRef(loadDraft(draftSlot)?.uid ?? crypto.randomUUID()); // one per form (and its draft); a retry of the same save carries the same one
  const pin = useRef(''); // the System PIN that unlocked a changed date, sent with each save
  const asked = useRef(0);
  const inFlight = useRef(false); // two F4s before the first re-render must not send two saves
  const previewPending = useRef<Promise<void> | null>(null); // the newest lrs.preview still on its way
  const form = useRef<HTMLFormElement>(null);

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const activeFirms = useMemo(() => firms.filter((f) => f.active), [firms]);
  const stationOptions = useMemo(() => activeStations.map((s) => ({ id: String(s.id), label: s.name })), [activeStations]);
  const firmOptions = useMemo(
    () => activeFirms.map((f) => ({ id: String(f.id), label: f.name, hint: stations.find((s) => s.id === f.stationId)?.name })),
    [activeFirms, stations],
  );

  const set = (patch: Partial<State>, clear?: LrField) => {
    setState((s) => ({ ...s, ...patch }));
    if (clear) setErrors((e) => (e[clear] === undefined ? e : { ...e, [clear]: undefined }));
  };
  const setParty = (who: 'consignor' | 'consignee', patch: Partial<Party>) => {
    setState((s) => ({ ...s, [who]: { ...s[who], ...patch } }));
    setErrors((e) => (e[who] === undefined ? e : { ...e, [who]: undefined }));
  };

  const stationId = (p: Typed): number | null => {
    const typed = p.text.trim();
    return typed === '' ? null : (p.id ?? activeStations.find((s) => matchKey(s.name) === matchKey(typed))?.id ?? null);
  };
  const partyOf = (p: Party): LrParty => {
    const typed = p.text.trim();
    // A name typed in full that is exactly an active firm is that firm (Esc on the list must not make a duplicate walk-in).
    const firmId = p.firmId ?? (typed === '' ? null : (activeFirms.find((f) => matchKey(f.name) === matchKey(typed))?.id ?? null));
    return { firmId, name: p.text, addToFirms: firmId === null && p.add };
  };

  const toInput = (confirmSimilar = false): LrInput => ({
    uid: uid.current,
    date: lr ? editDate : date,
    systemPin: lr ? '' : pin.current, // an edit sends its PIN apart (lrs.update)
    fromStationId: stationId(state.from),
    toStationId: stationId(state.to),
    consignor: partyOf(state.consignor),
    consignee: partyOf(state.consignee),
    particular: state.particular,
    qty: state.qty,
    toPay: state.toPay,
    paid: state.paid,
    chargeOption: state.option,
    godownBhada: state.charges.godownBhada,
    godownInsurance: state.charges.godownInsurance,
    deliveryCharges: state.charges.deliveryCharges,
    hamali: state.charges.hamali,
    wasuli: state.wasuli,
    staxPercent: state.stax,
    confirmSimilar,
  });

  // Live amounts, and what the charge option fills for this quantity. Only the newest answer is used.
  // `manual` is in the key: a box emptied and left is handed back to the option, which needs a fresh answer to refill it.
  const previewKey = JSON.stringify([state.option, state.qty, state.toPay, state.paid, state.charges, [...state.manual], state.wasuli, state.stax]);
  useEffect(() => {
    if (locked) return; // a saved LR in view mode shows the amounts it was saved with
    const mine = ++asked.current;
    const pending = window.bm.keeper.lrs.preview({ ...toInput(), systemPin: '' }).then((r) => {
      if (mine !== asked.current || !r.ok) return;
      setPreview(r.value);
      setState((s) => {
        const charges = applyDefaults(s.charges, s.manual, r.value.defaults);
        return sameCharges(charges, s.charges) ? s : { ...s, charges };
      });
    });
    previewPending.current = pending;
    void pending.finally(() => {
      if (previewPending.current === pending) previewPending.current = null;
    });
    // toInput() reads the same state that previewKey is made of
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, locked]);

  // A saved LR in view mode follows the LR it is given (another seat saved it, or this seat just did); while it is
  // being edited it keeps what is typed, and the save is refused if the LR moved on.
  const fill = (from: LrDetail) => {
    setState(formFromLr(from, nameOf));
    setEditDate(from.date);
    setErrors({});
  };
  const [filledFrom, setFilledFrom] = useState(lr); // the LR the boxes were last filled from
  if (lr && !editing && (filledFrom?.version !== lr.version || filledFrom.status !== lr.status)) {
    setFilledFrom(lr);
    fill(lr);
  }
  useEffect(() => {
    if (editing) form.current?.querySelector<HTMLElement>('[data-first]')?.focus(); // after the PIN dialog has handed focus back
  }, [editing]);

  // The page must not swap this form for another LR while it holds work: tell it when that is so.
  const holding = lr ? editing : hasTyped(state);
  useEffect(() => {
    onGuard?.(holding);
    return () => onGuard?.(false);
    // onGuard only sets a flag on the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  // A new LR that is being typed is kept while the clerk is on another page; a saved LR (view or edit) never is.
  useEffect(() => {
    if (!lr) keepDraft(draftSlot, { state, uid: uid.current });
  }, [state, lr, draftSlot]);

  // A refusal puts the cursor on the first box to fix (not again when the clerk fixes one of several).
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  // The date was just unlocked: the cursor goes to it (this effect runs after the PIN dialog has handed focus back).
  const dateUnlocked = date !== null;
  const sawUnlocked = useRef(dateUnlocked); // a form that opens with the date already unlocked does not jump to it
  useEffect(() => {
    if (sawUnlocked.current === dateUnlocked) return;
    sawUnlocked.current = dateUnlocked;
    if (dateUnlocked && !lr) form.current?.querySelector<HTMLElement>('input[type="date"]')?.focus();
  }, [dateUnlocked, lr]);

  const focusFirst = () => form.current?.querySelector<HTMLElement>('[data-first]')?.focus();

  const refuse = (fields: Errors) => {
    setErrors(fields);
    setFocusError((n) => n + 1);
  };

  // What a refused save says, new LR or edit: the boxes to fix, a firm that exists or looks alike, or a toast.
  const handleRefusal = (r: Extract<KeeperResult<unknown>, { ok: false }>) => {
    switch (r.code) {
      case 'lr-invalid': {
        const fields: Errors = {};
        for (const [k, why] of Object.entries(r.fields ?? {})) fields[k as LrField] = t.fieldError[why];
        return refuse(fields);
      }
      case 'master-exists': {
        const who = r.detail === 'consignee' ? 'consignee' : 'consignor';
        return refuse({ [who]: t.firmExists(r.row && 'name' in r.row ? r.row.name : state[who].text) });
      }
      case 'master-similar':
        return setSimilar({ party: r.detail === 'consignee' ? t.consignee : t.consignor, names: r.similar ?? [] });
      case 'wrong-pin':
      case 'pin-locked':
        // The PIN that unlocked the date no longer works (it was changed, or locked): back to today.
        pin.current = '';
        onDate(null);
        toast.error(strings.result(r.code, r.detail));
        return;
      default:
        toast.error(strings.result(r.code, r.detail));
    }
  };

  // An edit that was not saved: the LR moved on (stale, cancelled, gone) or the PIN stopped working. Back to view mode.
  const leaveEdit = (r: Extract<KeeperResult<unknown>, { ok: false }>) => {
    editPin.current = '';
    if (lr) fill(lr); // what was typed is not saved: the boxes show the saved values (the newer LR, if one came, replaces them)
    setEditing(false);
    if (r.code === 'lr-stale') toast.warning(t.stale(lr?.lrNo ?? 0));
    else toast.error(strings.result(r.code, r.detail));
    if (r.code === 'lr-missing') onOpen(null);
    else if (r.lr) onOpen(r.lr);
  };

  const save = async (confirmSimilar = false): Promise<void> => {
    if (inFlight.current || locked) return;
    // A charge box (hamali per dag x quantity) may be about to change: let the newest preview land and the form
    // re-render, then save with what is on screen (a newer save() is on `saveNow` by then).
    if (previewPending.current) {
      inFlight.current = true;
      try {
        await previewPending.current;
        await new Promise((r) => setTimeout(r, 0));
      } finally {
        inFlight.current = false;
      }
      return saveNow.current(confirmSimilar);
    }
    // A station typed but not in the list is the clerk's to fix before anything is sent.
    const local: Errors = {};
    if (state.from.text.trim() !== '' && stationId(state.from) === null) local.fromStation = t.fieldError.missing;
    if (state.to.text.trim() !== '' && stationId(state.to) === null) local.toStation = t.fieldError.missing;
    if (Object.keys(local).length > 0) return refuse(local);

    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      if (lr) {
        const r = await window.bm.keeper.lrs.update(lr.id, editBase, toInput(confirmSimilar), editPin.current);
        if (r.ok) {
          const { lr: next, changed } = r.value;
          if (changed) toast.success(t.updated(next.lrNo), t.savedDetail(next.consignor, next.consignee, nameOf(next.toStationId)));
          else toast.info(t.noChanges(next.lrNo));
          editPin.current = '';
          setEditing(false);
          onOpen(next);
          return;
        }
        if (r.code === 'lr-stale' || r.code === 'lr-missing' || r.code === 'lr-cancelled' || r.code === 'wrong-pin' || r.code === 'pin-locked') return leaveEdit(r);
        return handleRefusal(r);
      }
      const r = await window.bm.keeper.lrs.create(toInput(confirmSimilar));
      if (r.ok) {
        const { row, again } = r.value;
        if (again) toast.info(t.savedAgain(row.lrNo));
        else toast.success(t.saved(row.lrNo), t.savedDetail(row.consignor, row.consignee, row.toStation));
        try {
          localStorage.setItem(OPTION_KEY, state.option);
        } catch {
          /* blocked storage: only the memory of the last option is lost */
        }
        clearDraft(draftSlot); // the form may be closed by now (Quick LR, another page): its unmounted effect cannot clear this
        if (!again) onSaved?.(r.value);
        uid.current = crypto.randomUUID();
        setState((s) => initial(defaults, stations, s)); // keeps From station, the option and the tax %
        setPreview(null);
        focusFirst();
        return;
      }
      return handleRefusal(r);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // The seat's save key saves from anywhere on the page, unless a dialog that is not this form's own is open (Quick LR
  // over this page, a PIN dialog). The handler always calls the newest save() and the newest keys.
  const saveNow = useRef(save);
  const closeNow = useRef<(() => void) | null>(null);
  const keysNow = useRef(keys);
  useEffect(() => {
    saveNow.current = save;
    closeNow.current = locked ? () => onOpen(null) : null;
    keysNow.current = keys;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('dialog[open]');
      const top = dialogs[dialogs.length - 1];
      if (e.repeat || (top && !(form.current && top.contains(form.current)))) return;
      if (matches(keysNow.current.saveLr, e)) {
        e.preventDefault();
        void saveNow.current();
      } else if (matches(keysNow.current.newLr, e) && closeNow.current) {
        e.preventDefault();
        closeNow.current(); // a saved LR in view mode: Esc goes back to a new, empty LR
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // "Change date": the System PIN is checked by the keeper now, and again with every save.
  const checkPin = async (value: string): Promise<boolean> => {
    const r = await window.bm.keeper.pins.verify('system', value);
    if (r.ok) {
      pin.current = value;
      onDate(defaults.today);
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
    onDate(null);
  };

  // "Edit": the keeper checks the System PIN now; the save sends it again and the keeper checks it again.
  const startEdit = async (value: string): Promise<boolean> => {
    if (!lr) return true;
    const r = await window.bm.keeper.pins.verify('system', value);
    if (r.ok) {
      editPin.current = value;
      setEditBase(lr.version);
      setEditDate(lr.date);
      setEditing(true);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    toast.error(strings.result(r.code, r.detail)); // locked, or the keeper did not answer
    return true;
  };
  const discardEdit = () => {
    editPin.current = '';
    if (lr) fill(lr); // the saved values back in the boxes
    setEditing(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const chargeBox = (key: ChargeKey, label: string, className = styles.money) => (
    <Field
      money
      className={className}
      label={label}
      readOnly={locked}
      value={state.charges[key]}
      error={errors[key]}
      onChange={(e) => setState((s) => ({ ...s, charges: { ...s.charges, [key]: e.target.value }, manual: markManual(s.manual, key, e.target.value) }))}
      // A saved LR keeps every charge as saved, a 0 (empty box) included: only a new LR hands an emptied box back to the option.
      onBlur={lr ? undefined : (e) => setState((s) => ({ ...s, manual: releaseIfEmpty(s.manual, key, e.target.value) }))}
    />
  );

  const partyBox = (who: 'consignor' | 'consignee', label: string, first = false) => {
    const p = state[who];
    const exact = partyOf(p).firmId !== null;
    const walkIn = p.text.trim() !== '' && !exact;
    return (
      <div className={styles.party}>
        <TypeAhead
          label={label}
          required
          readOnly={locked}
          placeholder={t.firmPlaceholder}
          listLabel={t.firmList}
          walkInLabel={t.walkIn}
          error={errors[who]}
          value={p.text}
          options={firmOptions}
          onChange={(text) => setParty(who, { text, firmId: null })}
          onPick={(o) => setParty(who, { text: o.label, firmId: Number(o.id), add: false })}
          {...(first ? { 'data-first': '', 'data-autofocus': '', autoFocus: !lr } : {})}
        />
        {walkIn && !locked && (
          <label className={styles.check}>
            {/* On the label line of the box, so it costs no height. Enter walks past it; Tab reaches it, Space ticks it. */}
            <input type="checkbox" data-skip-enter="" checked={p.add} onChange={(e) => setParty(who, { add: e.target.checked })} />
            {t.addToFirms}
          </label>
        )}
      </div>
    );
  };

  const amounts = lr && locked ? lr.amounts : preview?.amounts;
  // Refusals are said once in the head (the boxes turn red); under the boxes they would push the day's list down.
  const problem = errorSummary(errors, (k) => t.historyFields[k as keyof typeof t.historyFields] ?? k);
  const isToday = date === null;
  // The date box: a new LR's (today, or another day unlocked with the PIN), or a saved LR's (fixed, or free within its year while editing).
  const yearEnd = lr ? `${lr.lrYear}-12-31` : '';
  const dateBox = lr
    ? editing
      ? { hint: t.dateInYear, props: { type: 'date', min: `${lr.lrYear}-01-01`, max: defaults.today < yearEnd ? defaults.today : yearEnd, value: editDate, onChange: (e: ChangeEvent<HTMLInputElement>) => { setEditDate(e.target.value || lr.date); setErrors((er) => ({ ...er, date: undefined })); } } }
      : { hint: undefined, props: { readOnly: true, value: isoToDisplay(lr.date) } }
    : isToday
      ? { hint: t.dateHint, props: { readOnly: true, value: isoToDisplay(defaults.today) } }
      : { hint: t.dateBackdated, props: { type: 'date', max: defaults.today, value: date ?? '', onChange: (e: ChangeEvent<HTMLInputElement>) => onDate(e.target.value || defaults.today) } };
  return (
    <Card className={styles.formCard}>
      {lr ? (
        <LrActions lr={lr} editing={editing} changedElsewhere={editing && lr.version !== editBase} problem={problem} onEdit={startEdit} onDiscard={discardEdit} onOpen={onOpen} onOpenMemo={onOpenMemo} />
      ) : (
        <div className={styles.head}>
          <strong className={styles.headTitle}>{t.formLabel}</strong>
          <span className={styles.headNote}>{t.lrNoHint(defaults.nextNo)}</span>
          {!isToday && <span className={styles.headWarn}>{t.dateBackdated}</span>}
          {problem && (
            <span className={styles.headWarn} aria-hidden="true" title={problem}>
              {problem}
            </span>
          )}
        </div>
      )}
      <form ref={form} className={styles.form} aria-label={lr ? t.lrTitle(lr.lrNo) : t.formLabel} onSubmit={submit} onKeyDown={enterToNext} noValidate>
        <div className={styles.row}>
          <Field className={styles.lrNo} label={t.lrNo} readOnly tabIndex={-1} value={lr ? String(lr.lrNo) : t.lrNoNew} />
          <Field className={styles.date} label={t.date} title={dateBox.hint} error={errors.date} data-skip-enter="" {...dateBox.props}>
            {!lr && (
              <button
                type="button"
                className={styles.dateButton}
                title={isToday ? t.changeDate : t.backToToday}
                aria-label={isToday ? t.changeDate : t.backToToday}
                onClick={isToday ? () => setAskingPin(true) : backToToday}
              >
                {isToday ? <CalendarDays size={20} aria-hidden="true" /> : <Undo2 size={20} aria-hidden="true" />}
              </button>
            )}
          </Field>
          {partyBox('consignor', t.consignor, true)}
          {partyBox('consignee', t.consignee)}
        </div>

        <div className={styles.row}>
          {/* From sits after the parties so that each row reads in the order the keys walk it; Enter walks past it. */}
          <TypeAhead
            className={styles.from}
            label={t.fromStation}
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            readOnly={locked}
            data-skip-enter=""
            error={errors.fromStation}
            value={state.from.text}
            options={stationOptions}
            onChange={(text) => set({ from: { text, id: null } }, 'fromStation')}
            onPick={(o) => set({ from: { text: o.label, id: Number(o.id) } }, 'fromStation')}
          />
          <TypeAhead
            className={styles.to}
            label={t.toStation}
            required
            readOnly={locked}
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            error={errors.toStation}
            value={state.to.text}
            options={stationOptions}
            onChange={(text) => set({ to: { text, id: null } }, 'toStation')}
            onPick={(o) => set({ to: { text: o.label, id: Number(o.id) } }, 'toStation')}
          />
          <Field className={styles.particular} label={t.particular} required readOnly={locked} placeholder={t.particularPlaceholder} error={errors.particular} value={state.particular} onChange={(e) => set({ particular: e.target.value }, 'particular')} />
          <Field className={styles.qty} label={t.qty} required readOnly={locked} inputMode="numeric" error={errors.qty} value={state.qty} onChange={(e) => set({ qty: e.target.value }, 'qty')} />
          <Field money className={styles.money} label={t.toPay} readOnly={locked} error={errors.toPay} value={state.toPay} onChange={(e) => set({ toPay: e.target.value }, 'toPay')} />
          <Field money className={styles.money} label={t.paid} readOnly={locked} error={errors.paid} value={state.paid} onChange={(e) => set({ paid: e.target.value }, 'paid')} />
        </div>

        <div className={`${styles.row} ${styles.charges}`}>
          <SelectField
            className={styles.option}
            label={t.chargeOption}
            options={CHARGE_OPTIONS}
            disabled={locked}
            value={state.option}
            onChange={(e) => set({ option: e.target.value as ChargeOption })}
          />
          {chargeBox('godownBhada', t.godownBhada, styles.bhada)}
          {chargeBox('godownInsurance', t.godownInsurance, styles.insurance)}
          {chargeBox('deliveryCharges', t.deliveryCharges, styles.delivery)}
          {chargeBox('hamali', t.hamali)}
          <Field money className={styles.money} label={t.wasuli} readOnly={locked} error={errors.wasuli} value={state.wasuli} onChange={(e) => set({ wasuli: e.target.value }, 'wasuli')} />
        </div>

        <div className={`${styles.row} ${styles.bottom}`}>
          <Field className={styles.tax} label={t.staxPercent} readOnly={locked} inputMode="decimal" error={errors.staxPercent} value={state.stax} onChange={(e) => set({ stax: e.target.value }, 'staxPercent')} />
          <dl className={styles.amounts} aria-label={t.amountsLabel} aria-live="off">
            {(['freight', 'charges', 'stax', 'total'] as const).map((k) => (
              <div key={k} className={k === 'total' ? styles.total : undefined}>
                <dt>{t.amounts[k]}</dt>
                <dd>{amounts ? `${strings.ui.rupee}${formatPaise(amounts[k])}` : t.none}</dd>
              </div>
            ))}
          </dl>
          {!locked && (
            <Button type="submit" className={styles.save} keyCap={keyLabel(keys.saveLr)} disabled={busy}>
              {busy ? t.saving : t.save}
            </Button>
          )}
        </div>
      </form>

      <PinDialog open={askingPin} title={t.changeDateTitle} onCancel={() => setAskingPin(false)} onSubmit={checkPin} />
      <Dialog
        open={similar !== null}
        title={t.similarTitle}
        cancelLabel={strings.masters.goBack}
        confirmLabel={t.addAndSave}
        onCancel={() => setSimilar(null)}
        onConfirm={() => {
          setSimilar(null);
          void save(true);
        }}
      >
        <p>{t.similarText}</p>
        <ul className={styles.similarList}>
          {similar?.names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p>
          {similar?.party}: {t.similarAsk}
        </p>
      </Dialog>
    </Card>
  );
}

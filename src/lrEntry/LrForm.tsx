import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CalendarDays, Undo2 } from 'lucide-react';
import type { ChargeOption, Firm, LrDefaults, LrField, LrInput, LrParty, LrPreview, Station } from '../../shared';
import { applyDefaults, markManual, releaseIfEmpty, CHARGE_KEYS, type ChargeKey, type ChargeTexts } from '../logic/chargeFill';
import { formatPaise } from '../logic/rupees';
import { matchKey } from '../logic/typeAhead';
import { KEYS } from '../keymap';
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
import styles from './LrEntryPage.module.css';

const t = strings.lr;
const OPTION_KEY = 'bm.lrChargeOption'; // the last charge option used on this seat (this Windows user's profile)
const CHARGE_OPTIONS = (Object.keys(t.chargeOptions) as ChargeOption[]).map((value) => ({ value, label: t.chargeOptions[value] }));
const NO_CHARGES: ChargeTexts = { godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '' };

interface Party {
  text: string;
  firmId: number | null;
  add: boolean;
}
interface Typed {
  text: string;
  id: number | null;
}
interface State {
  from: Typed;
  consignor: Party;
  consignee: Party;
  to: Typed;
  particular: string;
  qty: string;
  toPay: string;
  paid: string;
  option: ChargeOption;
  charges: ChargeTexts;
  manual: ReadonlySet<ChargeKey>;
  wasuli: string;
  stax: string;
}
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

export const isoToDisplay = (iso: string) => iso.split('-').reverse().join('-');
const sameCharges = (a: ChargeTexts, b: ChargeTexts) => CHARGE_KEYS.every((k) => a[k] === b[k]);

interface Props {
  stations: Station[];
  firms: Firm[];
  defaults: LrDefaults;
  /** null = today. A date other than today was unlocked with the System PIN. */
  date: string | null;
  onDate: (date: string | null) => void;
}

/**
 * The LR form. The clerk types, the keeper decides: money and quantity go to the keeper as the typed text, the live
 * amounts and the charge options' amounts come back from lrs.preview, and the number comes back from the save. The
 * form shows what it is given and never adds anything up.
 */
export default function LrForm({ stations, firms, defaults, date, onDate }: Props) {
  const toast = useToast();
  const enterToNext = useEnterToNext();
  const [state, setState] = useState<State>(() => initial(defaults, stations));
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState<LrPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusError, setFocusError] = useState(0); // bumped when a refusal should put the cursor on the first box to fix
  const [askingPin, setAskingPin] = useState(false);
  const [similar, setSimilar] = useState<{ party: string; names: string[] } | null>(null);
  const uid = useRef(crypto.randomUUID()); // one per form; a retry of the same save carries the same one
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
    date,
    systemPin: pin.current,
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
  }, [previewKey]);

  // A refusal puts the cursor on the first box to fix (not again when the clerk fixes one of several).
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  // The date was just unlocked: the cursor goes to it (this effect runs after the PIN dialog has handed focus back).
  const dateUnlocked = date !== null;
  useEffect(() => {
    if (dateUnlocked) form.current?.querySelector<HTMLElement>('input[type="date"]')?.focus();
  }, [dateUnlocked]);

  const focusFirst = () => form.current?.querySelector<HTMLElement>('[data-first]')?.focus();

  const refuse = (fields: Errors) => {
    setErrors(fields);
    setFocusError((n) => n + 1);
  };

  const save = async (confirmSimilar = false): Promise<void> => {
    if (inFlight.current) return;
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
        uid.current = crypto.randomUUID();
        setState((s) => initial(defaults, stations, s)); // keeps From station, the option and the tax %
        setPreview(null);
        focusFirst();
        return;
      }
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
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // F4 saves from anywhere on the page, unless a dialog is open. The handler always calls the newest save().
  const saveNow = useRef(save);
  useEffect(() => {
    saveNow.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== KEYS.saveLr || e.repeat || document.querySelector('dialog[open]')) return;
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const chargeBox = (key: ChargeKey, label: string) => (
    <Field
      money
      className={styles.money}
      label={label}
      value={state.charges[key]}
      error={errors[key]}
      onChange={(e) => setState((s) => ({ ...s, charges: { ...s.charges, [key]: e.target.value }, manual: markManual(s.manual, key, e.target.value) }))}
      onBlur={(e) => setState((s) => ({ ...s, manual: releaseIfEmpty(s.manual, key, e.target.value) }))}
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
          placeholder={t.firmPlaceholder}
          listLabel={t.firmList}
          walkInLabel={t.walkIn}
          error={errors[who]}
          value={p.text}
          options={firmOptions}
          onChange={(text) => setParty(who, { text, firmId: null })}
          onPick={(o) => setParty(who, { text: o.label, firmId: Number(o.id), add: false })}
          {...(first ? { 'data-first': '', autoFocus: true } : {})}
        />
        <div className={styles.checkSlot}>
          {walkIn && (
            <label className={styles.check}>
              {/* Enter walks past it; Tab reaches it, Space ticks it. */}
              <input type="checkbox" data-skip-enter="" checked={p.add} onChange={(e) => setParty(who, { add: e.target.checked })} />
              {t.addToFirms}
            </label>
          )}
        </div>
      </div>
    );
  };

  const amounts = preview?.amounts;
  const isToday = date === null;
  return (
    <Card className={styles.formCard}>
      <form ref={form} className={styles.form} aria-label={t.formLabel} onSubmit={submit} onKeyDown={enterToNext} noValidate>
        <div className={styles.row}>
          <Field className={styles.lrNo} label={t.lrNo} readOnly tabIndex={-1} value={t.lrNoNew} hint={t.lrNoHint(defaults.nextNo)} />
          <Field
            className={styles.date}
            label={t.date}
            hint={isToday ? t.dateHint : t.dateBackdated}
            error={errors.date}
            data-skip-enter=""
            {...(isToday
              ? { readOnly: true, value: isoToDisplay(defaults.today) }
              : { type: 'date', max: defaults.today, value: date ?? '', onChange: (e: ChangeEvent<HTMLInputElement>) => onDate(e.target.value || defaults.today) })}
          >
            <button
              type="button"
              className={styles.dateButton}
              title={isToday ? t.changeDate : t.backToToday}
              aria-label={isToday ? t.changeDate : t.backToToday}
              onClick={isToday ? () => setAskingPin(true) : backToToday}
            >
              {isToday ? <CalendarDays size={20} aria-hidden="true" /> : <Undo2 size={20} aria-hidden="true" />}
            </button>
          </Field>
          <TypeAhead
            className={styles.from}
            label={t.fromStation}
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            data-skip-enter=""
            error={errors.fromStation}
            value={state.from.text}
            options={stationOptions}
            onChange={(text) => set({ from: { text, id: null } }, 'fromStation')}
            onPick={(o) => set({ from: { text: o.label, id: Number(o.id) } }, 'fromStation')}
          />
          {partyBox('consignor', t.consignor, true)}
          {partyBox('consignee', t.consignee)}
        </div>

        <div className={styles.row}>
          <TypeAhead
            className={styles.to}
            label={t.toStation}
            required
            listLabel={t.stationList}
            placeholder={t.stationPlaceholder}
            error={errors.toStation}
            value={state.to.text}
            options={stationOptions}
            onChange={(text) => set({ to: { text, id: null } }, 'toStation')}
            onPick={(o) => set({ to: { text: o.label, id: Number(o.id) } }, 'toStation')}
          />
          <Field className={styles.particular} label={t.particular} required placeholder={t.particularPlaceholder} error={errors.particular} value={state.particular} onChange={(e) => set({ particular: e.target.value }, 'particular')} />
          <Field className={styles.qty} label={t.qty} required inputMode="numeric" error={errors.qty} value={state.qty} onChange={(e) => set({ qty: e.target.value }, 'qty')} />
          <Field money className={styles.money} label={t.toPay} error={errors.toPay} value={state.toPay} onChange={(e) => set({ toPay: e.target.value }, 'toPay')} />
          <Field money className={styles.money} label={t.paid} error={errors.paid} value={state.paid} onChange={(e) => set({ paid: e.target.value }, 'paid')} />
        </div>

        <div className={`${styles.row} ${styles.charges}`}>
          <SelectField
            className={styles.option}
            label={t.chargeOption}
            options={CHARGE_OPTIONS}
            value={state.option}
            onChange={(e) => set({ option: e.target.value as ChargeOption })}
          />
          {chargeBox('godownBhada', t.godownBhada)}
          {chargeBox('godownInsurance', t.godownInsurance)}
          {chargeBox('deliveryCharges', t.deliveryCharges)}
          {chargeBox('hamali', t.hamali)}
          <Field money className={styles.money} label={t.wasuli} error={errors.wasuli} value={state.wasuli} onChange={(e) => set({ wasuli: e.target.value }, 'wasuli')} />
        </div>

        <div className={`${styles.row} ${styles.bottom}`}>
          <Field className={styles.tax} label={t.staxPercent} inputMode="decimal" error={errors.staxPercent} value={state.stax} onChange={(e) => set({ stax: e.target.value }, 'staxPercent')} />
          <dl className={styles.amounts} aria-label={t.amountsLabel} aria-live="off">
            {(['freight', 'charges', 'stax', 'total'] as const).map((k) => (
              <div key={k} className={k === 'total' ? styles.total : undefined}>
                <dt>{t.amounts[k]}</dt>
                <dd>{amounts ? `${strings.ui.rupee}${formatPaise(amounts[k])}` : t.none}</dd>
              </div>
            ))}
          </dl>
          <Button type="submit" className={styles.save} keyCap={KEYS.saveLr} disabled={busy}>
            {busy ? t.saving : t.save}
          </Button>
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

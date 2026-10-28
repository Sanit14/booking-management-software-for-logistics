import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Firm, KeeperResult, MasterFields, MasterKind, MasterRow, Station } from '../../shared';
import { rowText } from '../logic/masterList';
import { matchKey } from '../logic/typeAhead';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import TypeAhead from '../ui/TypeAhead';
import { useEnterToNext } from '../ui/useEnterToNext';
import styles from './MastersPage.module.css';

const t = strings.masters;
type Outcome = 'created' | 'updated' | 'deactivated' | 'reactivated';

const nameLabel: Record<MasterKind, string> = {
  stations: t.fields.stationName,
  firms: t.fields.firmName,
  trucks: t.fields.truckNumber,
  drivers: t.fields.driverName,
};

interface Props {
  kind: MasterKind;
  /** The row being edited; null = the add form. */
  editing: MasterRow | null;
  /** Every station: a firm's pick list offers the active ones (plus the one it already has). */
  stations: Station[];
  /** A save went through: the page reloads and goes back to the add form. */
  onDone: () => void;
  /** Someone else changed the row first: the page reloads and shows `current`. */
  onStale: (current: MasterRow) => void;
  onCancel: () => void;
}

/**
 * Add form and edit form in one. Enter walks the fields and saves on the last one; after a save the page remounts
 * this form (new key), so it is empty and the first field has focus. Adding needs no PIN; saving an edit and
 * deactivating ask the System PIN, which the keeper checks in the same request.
 */
export default function MasterForm({ kind, editing, stations, onDone, onStale, onCancel }: Props) {
  const toast = useToast();
  const enterToNext = useEnterToNext();
  const firm = editing && 'stationId' in editing ? (editing as Firm) : null;
  const ownStation = firm?.stationId ?? null;
  const pickable = stations.filter((s) => s.active || s.id === ownStation);

  const [name, setName] = useState(editing ? rowText(editing) : ''); // a truck's number is its "name" here
  const [phone, setPhone] = useState(editing && 'phone' in editing ? editing.phone : '');
  const [station, setStation] = useState<{ text: string; id: number | null }>({
    text: stations.find((s) => s.id === ownStation)?.name ?? '',
    id: ownStation,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<MasterRow | null>(null); // the row a duplicate matched
  const [similar, setSimilar] = useState<string[] | null>(null);
  const [pinFor, setPinFor] = useState<'save' | 'deactivate' | null>(null);
  const [busy, setBusy] = useState(false);
  const pin = useRef(''); // kept only between the PIN dialog and a "Save anyway" resend
  const form = useRef<HTMLFormElement>(null);

  // A refusal puts the cursor on the field to fix, not wherever Enter had walked to.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  /** The fields as the keeper takes them; null (with the reason shown) when the station text is not a station. */
  const build = (): MasterFields | null => {
    if (kind === 'trucks') return { number: name };
    if (kind === 'stations') return { name };
    if (kind === 'drivers') return { name, phone };
    const typed = station.text.trim();
    if (typed === '') return { name, phone, stationId: null };
    // Typed in full but never picked from the list still counts when it is exactly a station.
    const id = station.id ?? pickable.find((s) => matchKey(s.name) === matchKey(typed))?.id ?? null;
    if (id === null) {
      setErrors({ station: t.bad.station });
      return null;
    }
    return { name, phone, stationId: id };
  };

  const handle = (r: KeeperResult<MasterRow>, outcome: Outcome) => {
    if (r.ok || r.code !== 'master-similar') pin.current = ''; // only a "Save anyway" resend still needs it
    if (r.ok) {
      const label = rowText(r.value);
      toast.success(
        outcome === 'created' ? t.saved(kind, label) : outcome === 'updated' ? t.updated(kind, label) : outcome === 'deactivated' ? t.deactivated(label) : t.reactivated(label),
      );
      return onDone();
    }
    switch (r.code) {
      case 'master-exists': {
        setExisting(r.row ?? null);
        const other = r.row ? rowText(r.row) : name;
        setErrors({ name: r.row && !r.row.active ? t.existsInactive(other) : t.exists(other) });
        break;
      }
      case 'master-similar':
        setSimilar(r.similar ?? []);
        break;
      case 'master-bad': {
        const field = r.detail ?? 'name';
        setErrors({ [field === 'number' ? 'name' : field]: t.bad[field] ?? strings.result(r.code, r.detail) });
        break;
      }
      case 'master-missing':
        toast.error(strings.result(r.code));
        onDone(); // nothing to edit any more
        break;
      case 'master-stale':
        toast.warning(t.stale(kind));
        if (r.row) onStale(r.row);
        else onDone();
        break;
      default:
        toast.error(strings.result(r.code, r.detail));
    }
  };

  const guarded = async (call: () => Promise<KeeperResult<MasterRow>>, outcome: Outcome) => {
    setErrors({});
    setExisting(null);
    setBusy(true);
    try {
      handle(await call(), outcome);
    } finally {
      setBusy(false);
    }
  };

  const add = (confirmSimilar: boolean) => {
    const fields = build();
    if (fields) void guarded(() => window.bm.keeper.masters.create(kind, fields, confirmSimilar), 'created');
  };
  const save = (systemPin: string, confirmSimilar: boolean) => {
    const fields = build();
    if (fields && editing) {
      const { id, version } = editing;
      return guarded(() => window.bm.keeper.masters.update(kind, id, version, fields, systemPin, confirmSimilar), 'updated');
    }
  };
  const setActive = (row: MasterRow, active: boolean, systemPin: string) =>
    guarded(() => window.bm.keeper.masters.setActive(kind, row.id, row.version, active, systemPin), active ? 'reactivated' : 'deactivated');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!editing) return add(false);
    if (build()) setPinFor('save');
  };

  // The dots shake on a wrong PIN; any other refusal closes the dialog and is shown by handle().
  const checkPin = async (value: string): Promise<boolean> => {
    if (!editing) return false;
    const { id, version } = editing;
    const fields = pinFor === 'save' ? build() : null;
    if (pinFor === 'save' && !fields) {
      setPinFor(null); // build() has shown what is wrong
      return true;
    }
    const r =
      pinFor === 'deactivate'
        ? await window.bm.keeper.masters.setActive(kind, id, version, false, value)
        : await window.bm.keeper.masters.update(kind, id, version, fields as MasterFields, value, false);
    if (!r.ok && r.code === 'wrong-pin') return false;
    pin.current = value;
    setPinFor(null);
    handle(r, pinFor === 'deactivate' ? 'deactivated' : 'updated');
    return true;
  };

  return (
    <Card title={editing ? t.editTitle(kind) : t.addTitle(kind)} className={styles.formCard}>
      <form ref={form} className={styles.form} onSubmit={submit} onKeyDown={enterToNext} noValidate>
        <Field
          label={nameLabel[kind]}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          required
          autoFocus
        />
        {existing && !existing.active && (
          <Button small variant="secondary" onClick={() => void setActive(existing, true, '')} disabled={busy}>
            {t.reactivateIt}
          </Button>
        )}
        {kind === 'firms' && (
          <TypeAhead
            label={t.fields.firmStation}
            hint={t.fields.firmStationHint}
            error={errors.station}
            listLabel={t.fields.stationList}
            value={station.text}
            onChange={(text) => setStation({ text, id: null })}
            onPick={(o) => setStation({ text: o.label, id: Number(o.id) })}
            options={pickable.map((s) => ({ id: String(s.id), label: s.name }))}
          />
        )}
        {(kind === 'firms' || kind === 'drivers') && (
          <Field label={t.fields.phone} hint={t.fields.phoneHint} error={errors.phone} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>
            {editing ? t.saveChanges : t.save}
          </Button>
          {editing && (
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {t.cancelEdit}
            </Button>
          )}
          {editing && editing.active && (
            <Button variant="danger" small onClick={() => setPinFor('deactivate')} disabled={busy}>
              {t.deactivate}
            </Button>
          )}
          {editing && !editing.active && (
            <Button variant="secondary" small onClick={() => void setActive(editing, true, '')} disabled={busy}>
              {t.reactivate}
            </Button>
          )}
        </div>
      </form>

      <PinDialog
        open={pinFor !== null}
        title={pinFor === 'deactivate' ? t.pinDeactivateTitle : t.pinSaveTitle}
        onCancel={() => setPinFor(null)}
        onSubmit={checkPin}
      />
      <Dialog
        open={similar !== null}
        title={t.similarTitle}
        cancelLabel={t.goBack}
        confirmLabel={editing ? t.saveAnyway : t.addAnyway}
        onCancel={() => {
          setSimilar(null);
          pin.current = '';
        }}
        onConfirm={() => {
          setSimilar(null);
          if (editing) void save(pin.current, true);
          else add(true);
        }}
      >
        <p>{t.similarText}</p>
        <ul className={styles.similarList}>
          {similar?.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p>{t.similarAsk}</p>
      </Dialog>
    </Card>
  );
}

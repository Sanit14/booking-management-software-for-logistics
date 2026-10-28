import { useState } from 'react';
import type { ChargeOption, LrDefaults, MastersAll } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import SelectField from '../ui/SelectField';
import { useToast } from '../ui/Toast';
import { useKeeperData } from '../useKeeperData';
import styles from './SettingsPage.module.css';

const t = strings.lrDefaults;
const NONE: MastersAll = { stations: [], firms: [], trucks: [], drivers: [] };
const OPTIONS = (Object.keys(strings.lr.chargeOptions) as ChargeOption[]).map((value) => ({ value, label: strings.lr.chargeOptions[value] }));

/** What a new LR starts with. Whatever is changed here is saved with the Admin PIN, checked by the keeper. */
export default function LrDefaultsCard() {
  const defaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(null), ['settings'], null);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), ['stations'], NONE);
  if (!defaults.data || !masters.loaded) return null;
  return <LrDefaultsForm start={defaults.data} stations={masters.data.stations.filter((s) => s.active)} />;
}

function LrDefaultsForm({ start, stations }: { start: LrDefaults; stations: MastersAll['stations'] }) {
  const toast = useToast();
  const [station, setStation] = useState(start.bookingStationId === null ? '' : String(start.bookingStationId));
  const [option, setOption] = useState<ChargeOption>(start.chargeOption);
  const [stax, setStax] = useState(start.staxPercent);
  const [error, setError] = useState<string | undefined>();
  const [asking, setAsking] = useState(false);

  const checkPin = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.settings.setLrDefaults({ bookingStationId: station === '' ? null : Number(station), chargeOption: option, staxPercent: stax }, pin);
    if (!r.ok && r.code === 'wrong-pin') return false;
    setAsking(false);
    if (r.ok) {
      setError(undefined);
      toast.success(t.saved);
    } else if (r.code === 'lr-invalid') {
      setError(r.fields?.staxPercent ? strings.lr.fieldError[r.fields.staxPercent] : strings.result(r.code));
    } else {
      toast.error(strings.result(r.code, r.detail));
    }
    return true;
  };

  return (
    <Card title={t.title}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          setAsking(true);
        }}
      >
        <p>{t.text}</p>
        <SelectField
          label={t.bookingStation}
          value={station}
          onChange={(e) => setStation(e.target.value)}
          options={[{ value: '', label: t.noStation }, ...stations.map((s) => ({ value: String(s.id), label: s.name }))]}
        />
        <SelectField label={t.chargeOption} value={option} onChange={(e) => setOption(e.target.value as ChargeOption)} options={OPTIONS} />
        <Field label={t.staxPercent} inputMode="decimal" error={error} value={stax} onChange={(e) => setStax(e.target.value)} />
        <Button type="submit" variant="secondary">
          {t.save}
        </Button>
      </form>
      <PinDialog open={asking} title={t.pinTitle} prompt={t.pinPrompt} label={t.pinLabel} onCancel={() => setAsking(false)} onSubmit={checkPin} />
    </Card>
  );
}

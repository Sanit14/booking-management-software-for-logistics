import { useState } from 'react';
import type { LrDefaults, MastersAll } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import PinDialog from '../ui/PinDialog';
import SelectField from '../ui/SelectField';
import { useToast } from '../ui/Toast';
import { useKeeperData } from '../useKeeperData';
import styles from './SettingsPage.module.css';

const t = strings.lrDefaults;
const NONE: MastersAll = { stations: [], firms: [], trucks: [], drivers: [], agents: [] };

/** What a new LR starts with: the booking station. It is saved with the Admin PIN, checked by the keeper. */
export default function LrDefaultsCard() {
  const defaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(null), ['settings'], null);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), ['stations'], NONE);
  if (!defaults.data || !masters.loaded) return null;
  return <LrDefaultsForm start={defaults.data} stations={masters.data.stations.filter((s) => s.active)} />;
}

function LrDefaultsForm({ start, stations }: { start: LrDefaults; stations: MastersAll['stations'] }) {
  const toast = useToast();
  const [station, setStation] = useState(start.bookingStationId === null ? '' : String(start.bookingStationId));
  const [asking, setAsking] = useState(false);

  const checkPin = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.settings.setLrDefaults({ bookingStationId: station === '' ? null : Number(station) }, pin);
    if (!r.ok && r.code === 'wrong-pin') return false;
    setAsking(false);
    if (r.ok) toast.success(t.saved);
    else toast.error(strings.result(r.code, r.detail));
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
        <Button type="submit" variant="secondary">
          {t.save}
        </Button>
      </form>
      <PinDialog open={asking} title={t.pinTitle} prompt={t.pinPrompt} label={t.pinLabel} onCancel={() => setAsking(false)} onSubmit={checkPin} />
    </Card>
  );
}

import { useState } from 'react';
import type { PrintCompany } from '../../shared';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import PinDialog from '../ui/PinDialog';
import { useToast } from '../ui/Toast';
import { useKeeperData } from '../useKeeperData';
import styles from './SettingsPage.module.css';

const t = strings.companyCard;
type Box = keyof PrintCompany;

/** The lines at the top of every printout. Saving asks for the Admin PIN, which the keeper checks. */
export default function CompanyCard() {
  const company = useKeeperData<PrintCompany | null>(() => window.bm.keeper.print.company(), ['settings'], null);
  if (!company.data) return null;
  return <CompanyForm start={company.data} />;
}

function CompanyForm({ start }: { start: PrintCompany }) {
  const toast = useToast();
  const [lines, setLines] = useState<PrintCompany>(start);
  const [error, setError] = useState<Partial<Record<Box, string>>>({});
  const [asking, setAsking] = useState(false);
  const set = (box: Box, value: string) => {
    setLines((l) => ({ ...l, [box]: value }));
    setError({});
  };

  // The keeper checks the PIN first and the boxes after it: a wrong PIN only shakes the dots.
  const checkPin = async (pin: string): Promise<boolean> => {
    const r = await window.bm.keeper.print.setCompany(lines, pin);
    if (!r.ok && r.code === 'wrong-pin') return false;
    setAsking(false);
    if (r.ok) {
      setLines(r.value);
      toast.success(t.saved);
    } else if (r.code === 'company-invalid') {
      const box = r.detail as Box;
      setError({ [box]: box === 'name' && lines.name.trim() === '' ? t.nameNeeded : t.tooLong });
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
        <Field className={styles.stretch} label={t.name} required maxLength={100} error={error.name} value={lines.name} onChange={(e) => set('name', e.target.value)} />
        <Field className={styles.stretch} label={t.address} maxLength={100} error={error.address} value={lines.address} onChange={(e) => set('address', e.target.value)} />
        <Field className={styles.stretch} label={t.phone} maxLength={100} error={error.phone} value={lines.phone} onChange={(e) => set('phone', e.target.value)} />
        <Field className={styles.stretch} label={t.gstin} maxLength={100} error={error.gstin} value={lines.gstin} onChange={(e) => set('gstin', e.target.value)} />
        <Button type="submit" variant="secondary">
          {t.save}
        </Button>
      </form>
      <PinDialog open={asking} title={t.pinTitle} prompt={strings.lrDefaults.pinPrompt} label={strings.lrDefaults.pinLabel} onCancel={() => setAsking(false)} onSubmit={checkPin} />
    </Card>
  );
}

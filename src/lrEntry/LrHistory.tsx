import { useEffect, useState } from 'react';
import type { ChargeOption, LrChange, LrDetail, LrEditField, LrHistoryEntry } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import { formatPaise } from '../logic/rupees';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import styles from './LrEntryPage.module.css';

const t = strings.lr;
const MONEY: readonly LrEditField[] = ['toPay', 'paid', 'godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali', 'wasuli'];

/** One side of a change as a person reads it: rupees for money, the option's name, a date as dd-mm-yyyy. */
function show(field: LrEditField, v: LrChange['from']): string {
  if (v === null) return t.none;
  if (MONEY.includes(field)) return `${strings.ui.rupee}${formatPaise(Number(v))}`;
  if (field === 'chargeOption') return t.chargeOptions[v as ChargeOption] ?? String(v);
  if (field === 'staxPercent') return `${v}%`;
  if (field === 'date') return isoToDisplay(String(v));
  return String(v);
}

function Entry({ e }: { e: LrHistoryEntry }) {
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyHead}>
        <strong>{t.historyAction[e.action]}</strong>
        <span>{t.historyBy(e.seat, e.at)}</span>
      </div>
      {e.reason !== undefined && <div>{t.historyReason(e.reason)}</div>}
      {e.changes.map((c) => (
        <div key={c.field}>{t.historyChange(t.historyFields[c.field], show(c.field, c.from), show(c.field, c.to))}</div>
      ))}
    </li>
  );
}

/** What happened to one LR, from the audit log: newest first. Fetched each time it opens (and again if the LR changes meanwhile). */
export default function LrHistory({ lr, open, onClose }: { lr: LrDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [entries, setEntries] = useState<LrHistoryEntry[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void window.bm.keeper.lrs.history(lr.id).then((r) => {
      if (!current) return;
      if (r.ok) setEntries(r.value);
      else toast.error(strings.result(r.code, r.detail));
    });
    return () => {
      current = false;
      setEntries(null);
    };
    // the toast function is stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lr.id, lr.version]);

  return (
    <Dialog open={open} title={t.historyTitle(lr.lrNo)} cancelLabel={t.historyClose} onCancel={onClose}>
      {/* A scroll box is not keyboard-focusable in Chrome 108 unless it says so. */}
      <ul className={styles.historyList} tabIndex={0} aria-label={t.historyTitle(lr.lrNo)}>
        {entries?.map((e, i) => <Entry key={`${e.at}-${i}`} e={e} />)}
        {entries?.length === 0 && <li>{t.historyEmpty}</li>}
      </ul>
    </Dialog>
  );
}

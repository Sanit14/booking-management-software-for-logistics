import { useEffect, useState } from 'react';
import type { MemoChange, MemoChangeField, MemoHistoryEntry } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import { formatPaise } from '../logic/rupees';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;
const MONEY: readonly MemoChangeField[] = ['truckHire', 'loadingHamali', 'toPay', 'paid', 'charges', 'stax'];

/** One side of a change as a person reads it: rupees for money, a date as dd-mm-yyyy. */
function show(field: MemoChangeField, v: MemoChange['from']): string {
  if (v === null) return strings.lr.none;
  if (MONEY.includes(field)) return `${strings.ui.rupee}${formatPaise(Number(v))}`;
  return field === 'date' ? isoToDisplay(String(v)) : String(v);
}

function Entry({ e }: { e: MemoHistoryEntry }) {
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyHead}>
        <strong>{t.historyAction[e.action]}</strong>
        <span>{t.historyBy(e.seat, e.at)}</span>
      </div>
      {e.lrNos.length > 0 && (
        <div>
          {t.historyLrs(e.lrNos)}
          {e.otherNo !== undefined && ` ${t.historyOther(e.action, e.otherNo)}`}
        </div>
      )}
      {e.reason !== undefined && <div>{t.historyReason(e.reason)}</div>}
      {e.changes.map((c) => (
        <div key={c.field}>{t.historyChange(t.historyFields[c.field], show(c.field, c.from), show(c.field, c.to))}</div>
      ))}
    </li>
  );
}

/** What happened to one memo, from the audit log: newest first. Fetched each time it opens (and again if the memo changes meanwhile). */
export default function MemoHistory({ id, no, version, open, onClose }: { id: number; no: number; version: number; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [entries, setEntries] = useState<MemoHistoryEntry[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void window.bm.keeper.memos.history(id).then((r) => {
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
  }, [open, id, version]);

  return (
    <Dialog open={open} title={t.historyTitle(no)} cancelLabel={t.historyClose} onCancel={onClose}>
      {/* A scroll box is not keyboard-focusable in Chrome 108 unless it says so. */}
      <ul className={styles.historyList} tabIndex={0} aria-label={t.historyTitle(no)}>
        {entries?.map((e, i) => <Entry key={`${e.at}-${i}`} e={e} />)}
        {entries?.length === 0 && <li>{t.historyEmpty}</li>}
      </ul>
    </Dialog>
  );
}

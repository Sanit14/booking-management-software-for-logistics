import type { MemoDetail } from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import { strings } from '../strings';
import Chip from '../ui/Chip';
import Table from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import { lrColumns, rupees } from './columns';
import styles from './LoadingMemoPage.module.css';

const t = strings.memo;

/**
 * A saved memo, read-only: its header, the totals frozen when it was saved (the keeper's numbers, nothing added up here)
 * and its LRs. Editing and cancelling a memo come in 3.2.
 */
export default function MemoView({ id }: { id: number }) {
  const memo = useKeeperData<MemoDetail | null>(() => window.bm.keeper.memos.get(id), ['memos'], null, [id]).data;
  if (!memo) return null; // a memo that is not there says so in a toast
  const f = memo.frozen;
  return (
    <>
      <h3 className={styles.viewHead}>
        {t.viewHead(memo.challanNo, isoToDisplay(memo.date))}
        <Chip kind={memo.status} />
      </h3>
      <dl className={styles.details}>
        {(
          [
            ['truck', memo.truck],
            ['driver', memo.driver],
            ['from', memo.fromStation],
            ['to', memo.toStation],
            ['truckHire', rupees(memo.truckHirePaise)],
            ['loadingHamali', rupees(memo.loadingHamaliPaise)],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{t.viewDetails[k]}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.frozen}>
        <span className={styles.frozenTitle}>{t.frozenTitle}</span>
        <span>
          {t.frozen.lrs} <strong>{f.lrs}</strong>
        </span>
        <span>
          {t.frozen.qty} <strong>{f.qty}</strong>
        </span>
        <span>
          {t.frozen.toPay} <strong>{rupees(f.toPayPaise)}</strong>
        </span>
        <span>
          {t.frozen.paid} <strong>{rupees(f.paidPaise)}</strong>
        </span>
        <span>
          {t.frozen.charges} <strong>{rupees(f.chargesPaise)}</strong>
        </span>
        <span>
          {t.frozen.stax} <strong>{rupees(f.staxPaise)}</strong>
        </span>
      </div>
      <Table label={t.lrsLabel} columns={lrColumns} rows={memo.lrs} rowKey={(r) => String(r.id)} empty={t.empty} maxHeight={260} />
    </>
  );
}

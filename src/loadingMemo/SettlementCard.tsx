import { Lock } from 'lucide-react';
import type { MemoDetail } from '../../shared';
import { percentText, roundText, settlementLines, type SettlementLine } from '../logic/memoDetails';
import { formatFixed } from '../logic/rupees';
import { strings } from '../strings';
import Button from '../ui/Button';
import styles from './SettlementCard.module.css';

const t = strings.memo.details;

/** The steps of a settlement, one ruled line each (the window and the card on a saved memo draw them the same way). Every figure comes from the keeper. */
export function Steps({ lines }: { lines: SettlementLine[] }) {
  return (
    <dl className={styles.steps}>
      {lines.map((l, i) => (
        <div key={`${l.key}${i}`} className={`${styles.line} ${l.weight === 'rule' ? styles.rule : ''} ${l.weight === 'total' ? styles.total : ''}`.trim()}>
          <dt>
            {l.label}
            {l.how && <span className={styles.how}> ({l.how})</span>}
          </dt>
          <dd>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Props {
  memo: MemoDetail;
  /** Edit rate / commission: asks the System PIN, then opens the same window. */
  onEdit: () => void;
}

/**
 * "Details of report" on a saved memo: the rate and % it was saved with, the steps, the round figure, and the way to change the two (System PIN, kept in
 * History). A memo saved before 4.6 says it has none yet, with the same button to give it its first.
 */
export default function SettlementCard({ memo, onEdit }: Props) {
  const s = memo.settlement;
  const cancelled = memo.status === 'cancelled';
  return (
    <section className={styles.card} aria-label={t.cardTitle}>
      <h4 className={styles.title}>{t.cardTitle}</h4>
      {s ? (
        <>
          <div className={styles.pills}>
            <span className={styles.pill}>{t.ratePill(formatFixed(s.ratePaise))}</span>
            <span className={styles.pill}>{t.commissionPill(percentText(s.commissionBp))}</span>
          </div>
          <Steps lines={settlementLines(s)} />
          <div className={styles.round}>
            <strong>{t.round}</strong>
            <output aria-label={t.round}>{strings.ui.rupee} {roundText(s)}</output>
          </div>
        </>
      ) : (
        <div className={styles.none}>
          <strong>{t.none}</strong>
          <span>{t.noneText}</span>
        </div>
      )}
      {!cancelled && (
        <>
          <Button small variant="outline" icon={<Lock size={16} aria-hidden="true" />} onClick={onEdit}>
            {t.edit}
          </Button>
          <p className={styles.note}>{t.editNote}</p>
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import type { LrDefaults, LrSaved } from '../../shared';
import { formatPaise } from '../logic/rupees';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import { useKeeperData } from '../useKeeperData';
import LrForm from './LrForm';
import { MASTER_TABLES, NONE } from './LrEntryPage';
import styles from './LrEntryPage.module.css';

const t = strings.quick;

/**
 * Quick LR: the LR form of LR Entry in a dialog over whatever page the clerk is on. Same form, same keeper calls, same
 * rules. A save clears the form for the next LR and the dialog stays; Esc closes it and the clerk is where they were.
 * The lists are fetched here, in the part that is always mounted, so the form is on screen (and has the cursor) the
 * moment the dialog opens: keys typed at once are not lost to the Close button.
 */
export default function QuickLr({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(null); // null = today; a backdate is unlocked with the System PIN, as on LR Entry
  const [last, setLast] = useState<LrSaved | null>(null);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const defaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(date), ['settings', 'lrs'], null, [date]);

  // Every time it opens it starts as today (the PIN that unlocked a date died with the form) with nothing "last saved".
  const close = () => {
    setDate(null);
    setLast(null);
    onClose();
  };

  return (
    <Dialog open={open} wide title={t.title} cancelLabel={t.close} onCancel={close}>
      {defaults.data && masters.loaded ? (
        <LrForm
          draftSlot="quick"
          stations={masters.data.stations}
          firms={masters.data.firms}
          defaults={defaults.data}
          date={date}
          onDate={setDate}
          onOpen={() => undefined} // a new LR only: nothing here opens a saved one
          onSaved={setLast}
        />
      ) : null}
      <p className={styles.lastSaved} aria-live="polite">
        {last ? t.lastSaved(last.row.lrNo, last.row.consignee, `${strings.ui.rupee}${formatPaise(last.amounts.total)}`) : t.noneYet}
      </p>
    </Dialog>
  );
}

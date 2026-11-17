import { useEffect, useRef, useState } from 'react';
import type { MemoDefaults } from '../../shared';
import type { Jump } from '../logic/searchResults';
import { MASTER_TABLES, NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import { PageHeader } from '../ui/Card';
import Dialog from '../ui/Dialog';
import { useKeeperData } from '../useKeeperData';
import styles from './LoadingMemoPage.module.css';
import MemoView from './MemoView';
import SavedMemos from './SavedMemos';

const t = strings.memo;
const noop = () => undefined;

interface Props {
  /** A search pick, LR Entry or History asking for a challan. */
  jump: Jump | null;
  onJumpUsed: () => void;
}

/**
 * Saved Memos: the memos made, today's by default, newest first. A row (or a pick from search, LR Entry or History) opens the memo in a dialog, where it can be
 * corrected, printed or cancelled.
 */
export default function SavedMemosPage({ jump, onJumpUsed }: Props) {
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const today = useKeeperData<MemoDefaults | null>(() => window.bm.keeper.memos.defaults(null), ['memos'], null).data?.today ?? '';
  const [view, setView] = useState<number | null>(null); // the saved memo shown in the dialog

  // A pick of a challan opens it; the pick is used up.
  const take = useRef(noop);
  useEffect(() => {
    take.current = () => {
      if (jump?.to !== 'memo') return;
      setView(jump.id);
      onJumpUsed();
    };
  });
  useEffect(() => {
    if (jump?.to === 'memo') take.current();
  }, [jump]);

  return (
    <>
      <PageHeader title={strings.pages.savedMemos} />
      <div className={styles.page}>
        <SavedMemos masters={masters.data} today={today} onOpen={setView} />
      </div>
      <Dialog open={view !== null} wide title={t.viewTitle} cancelLabel={t.viewClose} onCancel={() => setView(null)}>
        {view !== null && <MemoView key={view} id={view} masters={masters.data} today={today} />}
      </Dialog>
    </>
  );
}

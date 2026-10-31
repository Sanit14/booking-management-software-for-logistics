import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MemoDefaults } from '../../shared';
import type { Ticks } from '../logic/memoPick';
import { untick } from '../logic/memoPick';
import type { Jump } from '../logic/searchResults';
import { MASTER_TABLES, NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Dialog from '../ui/Dialog';
import { useKeeperData } from '../useKeeperData';
import styles from './LoadingMemoPage.module.css';
import MemoPanel from './MemoPanel';
import MemoView from './MemoView';
import PendingPicker from './PendingPicker';
import SavedMemos from './SavedMemos';

const t = strings.memo;
type Tab = 'new' | 'saved';
const TABS: Tab[] = ['new', 'saved'];
const noop = () => undefined;

interface Props {
  jump: Jump | null;
  onJumpUsed: () => void;
  /** The oldest booked LR's date, shown in "Booked from" while the box is untouched. */
  oldestPending: string | null;
}

/**
 * Loading Memo: two tabs. "New memo" is the pending list and the memo panel (tick the LRs going on one truck, fill the memo,
 * save); "Saved memos" lists the memos made and opens one to correct it. Both stay mounted, so the ticks and a half-typed memo
 * survive a look at the saved ones; a saved memo opens in a dialog from either tab, a search pick, or LR Entry.
 */
export default function LoadingMemoPage({ jump, onJumpUsed, oldestPending }: Props) {
  const page = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const today = useKeeperData<MemoDefaults | null>(() => window.bm.keeper.memos.defaults(null), ['memos'], null).data?.today ?? '';

  const [tab, setTab] = useState<Tab>('new');
  const [ticks, setTicks] = useState<Ticks>(new Set());
  const [filterStation, setFilterStation] = useState<{ id: number; name: string } | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [view, setView] = useState<number | null>(null); // the saved memo shown in the dialog

  // A pick from search, LR Entry or the Dashboard: a challan opens in its dialog (on the Saved memos tab behind it); a station
  // sets the To-station filter of the new memo.
  const stationJump = jump?.to === 'pending' ? jump.stationId : null;
  const take = useRef(noop);
  useEffect(() => {
    take.current = () => {
      if (jump?.to === 'memo') {
        setTab('saved');
        setView(jump.id);
        onJumpUsed();
      } else setTab('new'); // a station pick: the filter takes it (PendingPicker clears the pick)
    };
  });
  useEffect(() => {
    if (jump !== null && (jump.to === 'memo' || jump.to === 'pending')) take.current();
  }, [jump]);

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next]);
    tabButtons.current[next]?.focus();
  };

  return (
    <>
      <div ref={page} className={styles.page}>
        <div className={styles.tabs} role="tablist" aria-label={t.tabsLabel}>
          {TABS.map((k, i) => (
            <button
              key={k}
              ref={(el) => {
                tabButtons.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={k === tab}
              tabIndex={k === tab ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(k)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.tabs[k]}
            </button>
          ))}
        </div>

        <div className={styles.tabBody} hidden={tab !== 'new'}>
          <PendingPicker
            masters={masters.data}
            mastersLoaded={masters.loaded}
            today={today}
            oldestPending={oldestPending}
            ticks={ticks}
            onTicks={setTicks}
            stationJump={stationJump}
            onStationUsed={onJumpUsed}
            onFilterStation={setFilterStation}
            reloadSignal={reloadSignal}
          />
          <MemoPanel
            masters={masters.data}
            ticks={ticks}
            filterStation={filterStation}
            onSaved={() => {
              setTicks(new Set());
              page.current?.querySelector<HTMLElement>(`form[aria-label="${t.filtersLabel}"] input`)?.focus();
            }}
            onTaken={(ids) => {
              setTicks((now) => untick(now, ids));
              setReloadSignal((n) => n + 1);
            }}
            onOpen={setView}
          />
        </div>
        <div className={styles.tabBody} hidden={tab !== 'saved'}>
          <SavedMemos masters={masters.data} today={today} active={tab === 'saved'} onOpen={setView} />
        </div>
      </div>
      <Dialog open={view !== null} wide title={t.viewTitle} cancelLabel={t.viewClose} onCancel={() => setView(null)}>
        {view !== null && <MemoView key={view} id={view} masters={masters.data} today={today} oldestPending={oldestPending} />}
      </Dialog>
    </>
  );
}

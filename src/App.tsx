import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSummary, KeeperStatus } from '../shared';
import styles from './App.module.css';
import ComponentsPage from './ComponentsPage';
import DashboardPage from './dashboard/DashboardPage';
import { matches } from './logic/keymap';
import type { Jump } from './logic/searchResults';
import LoadingMemoPage from './loadingMemo/LoadingMemoPage';
import LrEntryPage from './lrEntry/LrEntryPage';
import QuickLr from './lrEntry/QuickLr';
import MastersPage from './masters/MastersPage';
import SearchOverlay from './search/SearchOverlay';
import Notice from './shell/Notice';
import PinSetup from './PinSetup';
import Page from './shell/Page';
import type { PageId } from './shell/pages';
import SettingsPage from './shell/SettingsPage';
import Sidebar from './shell/Sidebar';
import StatusBox from './shell/StatusBox';
import SafeMode from './SafeMode';
import { strings } from './strings';
import Dialog from './ui/Dialog';
import { useKeeperData } from './useKeeperData';
import { useKeys } from './useKeys';

const pageOf = (j: Jump): PageId => (j.to === 'lr' ? 'lrEntry' : j.to === 'master' ? 'masters' : 'loadingMemo');

// `npm run dev -- --components` opens the Components page straight away, without needing the keeper.
const COMPONENTS_ONLY = window.location.hash === '#components';

export default function App() {
  const { keys } = useKeys();
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [link, setLink] = useState<'ok' | 'reconnecting' | 'lost'>('ok'); // main's watchdog, once the shell is up
  const [page, setPage] = useState<PageId>('dashboard');
  const [components, setComponents] = useState(COMPONENTS_ONLY);
  const [quick, setQuick] = useState(false); // the Quick LR dialog
  const [searching, setSearching] = useState(false); // the Ctrl+K search window
  const [jump, setJump] = useState<Jump | null>(null); // a search pick on its way to the page that shows it
  const editing = useRef(false); // LR Entry holds an LR being edited: leaving the page would throw the changes away
  const [leaving, setLeaving] = useState<PageId | null>(null); // the page asked for while an edit is open

  const load = useCallback(() => {
    window.bm.keeper.health().then(setStatus, (e: unknown) =>
      setStatus({ kind: 'error', code: 'keeper-unreachable', detail: e instanceof Error ? e.message : '' }),
    );
  }, []);

  // Once on entry; pages refetch on the keeper's change events (useKeeperData), no polling. Main's 15 s liveness ping
  // pushes "reconnecting" and then the new status when it has to start the keeper again.
  useEffect(() => {
    if (COMPONENTS_ONLY) return;
    load();
    return window.bm.keeper.onStatus((push) => {
      if (push.kind === 'reconnecting') return setLink('reconnecting');
      // An error while the shell is up must not wipe the page the clerk is on: keep it, say so in the status box.
      if (push.kind === 'error') return setLink('lost');
      setLink('ok');
      setStatus(push);
    });
  }, [load]);

  // Any other way to a page drops a search pick still waiting for its own page.
  const go = (next: PageId) => {
    setJump((j) => (j && pageOf(j) === next ? j : null));
    if (editing.current && next !== page) setLeaving(next);
    else setPage(next);
  };
  // A search pick: the page that shows it takes the jump once it is there (and clears it).
  const pick = (j: Jump) => {
    setJump(j);
    go(pageOf(j));
  };

  // This seat's page and Quick LR keys (Save LR and New LR belong to the form). Nothing reacts while a dialog is open.
  const now = useRef({ keys, go });
  useEffect(() => {
    now.current = { keys, go };
  });
  const shellUp = status?.kind === 'connected' && status.health.pinsSet !== false && !components;
  // The Dashboard's counts and the sidebar badges: refetched only when the keeper announces an LR or memo change.
  const summary = useKeeperData<DashboardSummary | null>(
    () => (shellUp ? window.bm.keeper.dashboard.summary(null) : Promise.resolve({ ok: true as const, value: null })),
    ['lrs', 'memos'],
    null,
    [shellUp],
  ).data;
  useEffect(() => {
    if (!shellUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || document.querySelector('dialog[open]')) return;
      const { keys: k, go: to } = now.current;
      const action = matches(k.globalSearch, e)
        ? () => setSearching(true)
        : matches(k.quickLr, e)
          ? () => setQuick(true)
          : matches(k.goDashboard, e)
            ? () => to('dashboard')
            : matches(k.goLrEntry, e)
              ? () => to('lrEntry')
              : matches(k.goLoadingMemo, e)
                ? () => to('loadingMemo')
                : null;
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shellUp]);

  if (components) return <ComponentsPage onBack={COMPONENTS_ONLY ? undefined : () => setComponents(false)} />;

  if (status === null) return <Notice text={strings.keeperStarting} />;
  if (status.kind === 'error') return <Notice alert text={strings.keeperStatus(status)} />;
  if (status.kind === 'safe-mode') return <SafeMode message={strings.keeperStatus(status)} onRestored={load} />;

  // First run, or a database restored from before the PINs existed: nothing else until both PINs are set.
  if (status.health.pinsSet === false) return <PinSetup onDone={load} />;

  return (
    <div className={styles.app}>
      <Sidebar page={page} onSelect={go} onQuickLr={() => setQuick(true)} badges={summary ? { lrEntry: summary.booked + summary.loaded, loadingMemo: summary.pending } : undefined}>
        <StatusBox seat={status.seat} backup={status.health.backup} link={link} />
      </Sidebar>
      <main className={styles.main}>
        {page === 'settings' ? (
          <SettingsPage health={status.health} onExported={load} onComponents={() => setComponents(true)} />
        ) : page === 'masters' ? (
          <MastersPage jump={jump} onJumpUsed={() => setJump(null)} />
        ) : page === 'lrEntry' ? (
          <LrEntryPage
            jump={jump}
            onJumpUsed={() => setJump(null)}
            onEditing={(on) => {
              editing.current = on;
            }}
          />
        ) : page === 'loadingMemo' ? (
          <LoadingMemoPage jump={jump} onJumpUsed={() => setJump(null)} oldestPending={summary?.oldestPending ?? null} />
        ) : page === 'dashboard' ? (
          <DashboardPage summary={summary} onMakeMemo={() => go('loadingMemo')} onPick={pick} />
        ) : (
          <Page id={page} />
        )}
      </main>
      <QuickLr open={quick} onClose={() => setQuick(false)} />
      <SearchOverlay open={searching} onClose={() => setSearching(false)} onPick={pick} />
      <Dialog
        open={leaving !== null}
        title={strings.leave.title}
        cancelLabel={strings.leave.keep}
        confirmLabel={strings.leave.discard}
        danger
        onCancel={() => {
          setLeaving(null);
          setJump(null); // a search pick that led here is dropped with it
        }}
        onConfirm={() => {
          editing.current = false;
          if (leaving) setPage(leaving);
          setLeaving(null);
        }}
      >
        <p>{strings.leave.text}</p>
      </Dialog>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { KeeperStatus } from '../shared';
import styles from './App.module.css';
import ComponentsPage from './ComponentsPage';
import Notice from './shell/Notice';
import PinSetup from './PinSetup';
import Page from './shell/Page';
import type { PageId } from './shell/pages';
import SettingsPage from './shell/SettingsPage';
import Sidebar from './shell/Sidebar';
import StatusBox from './shell/StatusBox';
import SafeMode from './SafeMode';
import { strings } from './strings';
import { useToast } from './ui/Toast';

// `npm run dev -- --components` opens the Components page straight away, without needing the keeper.
const COMPONENTS_ONLY = window.location.hash === '#components';

export default function App() {
  const toast = useToast();
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [link, setLink] = useState<'ok' | 'reconnecting' | 'lost'>('ok'); // main's watchdog, once the shell is up
  const [page, setPage] = useState<PageId>('dashboard');
  const [components, setComponents] = useState(COMPONENTS_ONLY);

  const load = useCallback(() => {
    window.bm.keeper.health().then(setStatus, (e: unknown) =>
      setStatus({ kind: 'error', code: 'keeper-unreachable', detail: e instanceof Error ? e.message : '' }),
    );
  }, []);

  // Once on entry; the keeper pushes change events later (session 2.2), no polling. Main's 15 s liveness ping
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

  if (components) return <ComponentsPage onBack={COMPONENTS_ONLY ? undefined : () => setComponents(false)} />;

  if (status === null) return <Notice text={strings.keeperStarting} />;
  if (status.kind === 'error') return <Notice alert text={strings.keeperStatus(status)} />;
  if (status.kind === 'safe-mode') return <SafeMode message={strings.keeperStatus(status)} onRestored={load} />;

  // First run, or a database restored from before the PINs existed: nothing else until both PINs are set.
  if (status.health.pinsSet === false) return <PinSetup onDone={load} />;

  return (
    <div className={styles.app}>
      <Sidebar page={page} onSelect={setPage} onQuickLr={() => toast.info(strings.quickLrSoon)}>
        <StatusBox seat={status.seat} backup={status.health.backup} link={link} />
      </Sidebar>
      <main className={styles.main}>
        {page === 'settings' ? (
          <SettingsPage health={status.health} onExported={load} onComponents={() => setComponents(true)} />
        ) : (
          <Page id={page} />
        )}
      </main>
    </div>
  );
}

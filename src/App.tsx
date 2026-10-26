import { useCallback, useEffect, useState } from 'react';
import type { KeeperStatus } from '../shared';
import SafeMode from './SafeMode';
import { strings } from './strings';

export default function App() {
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const load = useCallback(() => {
    window.bm.keeper.health().then(setStatus, (e: unknown) =>
      setStatus({ kind: 'error', code: 'keeper-unreachable', detail: e instanceof Error ? e.message : '' }),
    );
  }, []);

  // Once on entry; the keeper pushes change events later (session 2.2), no polling.
  useEffect(load, [load]);

  const exportBackup = () => {
    setExported(null);
    void window.bm.keeper.backups.exportTo().then((r) => {
      if (r.ok) setExported(strings.exportDone(r.value.file));
      else if (r.code !== 'cancelled') setExported(strings.result(r.code, r.detail));
      load(); // the status line shows the newest backup
    });
  };

  return (
    <main>
      <h1>{strings.appTitle}</h1>
      <p>
        {strings.version} {window.bm.version}
      </p>
      <p role="status">{status ? strings.keeperStatus(status) : strings.keeperStarting}</p>
      {status?.kind === 'safe-mode' && <SafeMode onRestored={load} />}
      {status?.kind === 'connected' && (
        <p>
          <button type="button" onClick={exportBackup}>
            {strings.exportBackup}
          </button>{' '}
          {exported}
        </p>
      )}
    </main>
  );
}

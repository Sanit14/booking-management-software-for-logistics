import { useEffect, useState } from 'react';
import type { KeeperStatus } from '../shared';
import { strings } from './strings';

export default function App() {
  const [status, setStatus] = useState<KeeperStatus | null>(null);

  // Once on entry; the keeper pushes change events later (session 2.2), no polling.
  useEffect(() => {
    window.bm.keeper.health().then(setStatus, (e: unknown) =>
      setStatus({ kind: 'error', code: 'keeper-unreachable', detail: e instanceof Error ? e.message : '' }),
    );
  }, []);

  return (
    <main>
      <h1>{strings.appTitle}</h1>
      <p>
        {strings.version} {window.bm.version}
      </p>
      <p role="status">{status ? strings.keeperStatus(status) : strings.keeperStarting}</p>
    </main>
  );
}

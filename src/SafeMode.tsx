import { useEffect, useState } from 'react';
import type { BackupInfo, KeeperResult, RestorePreview } from '../shared';
import { strings } from './strings';

const t = strings.safeMode;

// Plain on purpose: styling comes with session 1.5. Shown instead of the app while the keeper is in safe mode.
export default function SafeMode({ onRestored }: { onRestored: () => void }) {
  const [list, setList] = useState<KeeperResult<BackupInfo[]> | null>(null);
  const [preview, setPreview] = useState<KeeperResult<RestorePreview> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void window.bm.keeper.backups.list().then(setList);
  }, []);

  const choose = (file: string) => {
    setBusy(true);
    setProblem(null);
    void window.bm.keeper.restore
      .preview(file)
      .then((r) => {
        setPreview(r);
        if (!r.ok) setProblem(strings.result(r.code, r.detail));
      })
      .finally(() => setBusy(false));
  };

  const restore = () => {
    if (!preview?.ok) return;
    setBusy(true);
    setProblem(null);
    void window.bm.keeper.restore
      .apply(preview.value.file, preview.value.token)
      .then((r) => (r.ok ? onRestored() : setProblem(strings.result(r.code, r.detail))))
      .finally(() => setBusy(false));
  };

  return (
    <section>
      <h2>{t.title}</h2>
      {list === null && <p>{t.loading}</p>}
      {list && !list.ok && <p role="alert">{strings.result(list.code, list.detail)}</p>}
      {list?.ok && list.value.length === 0 && <p>{t.noBackups}</p>}
      {list?.ok && list.value.length > 0 && (
        <>
          <h3>{t.backups}</h3>
          <table>
            <thead>
              <tr>
                {Object.values(t.columns).map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {list.value.map((b) => (
                <tr key={b.file}>
                  <td>{t.time(b.at)}</td>
                  <td>{t.kb(b.sizeBytes)}</td>
                  <td>{b.summary?.lrs ?? ''}</td>
                  <td>{b.summary?.memos ?? ''}</td>
                  <td>{b.summary?.masters ?? ''}</td>
                  <td>{b.summary ? (b.summary.newestLrDate ?? '') : ''}</td>
                  <td>{b.damaged ? t.status.damaged : t.status.ok}</td>
                  <td>
                    <button type="button" disabled={b.damaged || busy} onClick={() => choose(b.file)}>
                      {t.choose}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {preview?.ok && (
        <div>
          <h3>{t.previewTitle}</h3>
          <table>
            <thead>
              <tr>
                <th>
                  {t.backupSide} ({t.time(list?.ok ? (list.value.find((b) => b.file === preview.value.file)?.at ?? '') : '')})
                </th>
                <th>{t.liveSide}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <ul>
                    {t.summary(preview.value.backup).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </td>
                <td>
                  {typeof preview.value.live === 'object' ? (
                    <ul>
                      {t.summary(preview.value.live).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    preview.value.live === 'missing' ? t.liveMissing : t.liveDamaged
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <p>{t.keepsOld}</p>
          <button type="button" disabled={busy} onClick={restore}>
            {busy ? t.restoring : t.restore}
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
    </section>
  );
}

import { useEffect, useState } from 'react';
import type { BackupInfo, DbSummary, KeeperResult, RestorePreview } from '../shared';
import styles from './SafeMode.module.css';
import { strings } from './strings';
import Button from './ui/Button';
import { Card } from './ui/Card';
import Table, { type Column } from './ui/Table';

const t = strings.safeMode;

function Summary({ title, summary }: { title: string; summary: DbSummary | string }) {
  return (
    <div className={styles.side}>
      <h3 className={styles.sideTitle}>{title}</h3>
      {typeof summary === 'string' ? (
        <p>{summary}</p>
      ) : (
        <ul>
          {t.summary(summary).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The backups in the backup folder, newest first; choosing one sets it next to the database now so the person can compare before restoring.
 * Safe mode and Settings both use it. `onRestore` gets the checked preview and answers the problem to show (or null when there is none).
 */
export default function BackupPicker({ onRestore }: { onRestore: (preview: RestorePreview) => Promise<string | null> | string | null }) {
  const [list, setList] = useState<KeeperResult<BackupInfo[]> | null>(null);
  const [preview, setPreview] = useState<KeeperResult<RestorePreview> | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false); // the keeper is checking the chosen backup (seconds on a big book)
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void window.bm.keeper.backups.list().then(setList);
  }, []);

  const choose = (file: string) => {
    setBusy(true);
    setChecking(true);
    setProblem(null);
    void window.bm.keeper.restore
      .preview(file)
      .then((r) => {
        setPreview(r);
        if (!r.ok) setProblem(strings.result(r.code, r.detail));
      })
      .finally(() => {
        setBusy(false);
        setChecking(false);
      });
  };

  const restore = () => {
    if (!preview?.ok) return;
    setBusy(true);
    setProblem(null);
    void Promise.resolve(onRestore(preview.value))
      .then(setProblem)
      .finally(() => setBusy(false));
  };

  const chosen = preview?.ok ? preview.value : null;
  const columns: Column<BackupInfo>[] = [
    { key: 'made', header: t.columns.made, width: 170, render: (b) => t.time(b.at) },
    { key: 'size', header: t.columns.size, num: true, width: 80, render: (b) => t.kb(b.sizeBytes) },
    {
      key: 'choose',
      header: '',
      width: 110,
      render: (b) => (
        <Button variant="outline" small disabled={busy} onClick={() => choose(b.file)}>
          {t.choose}
        </Button>
      ),
    },
  ];

  return (
    <>
      {list === null && <p className={styles.note}>{t.loading}</p>}
      {list && !list.ok && <p role="alert" className={styles.problem}>{strings.result(list.code, list.detail)}</p>}
      {list?.ok && list.value.length === 0 && <p className={styles.note}>{t.noBackups}</p>}
      {list?.ok && list.value.length > 0 && (
        <Card title={t.backups}>
          <Table
            label={t.backups}
            columns={columns}
            rows={list.value}
            rowKey={(b) => b.file}
            ticked={chosen ? new Set([chosen.file]) : undefined}
            empty={t.noBackups}
            maxHeight={230}
          />
        </Card>
      )}

      {checking && <p className={styles.note}>{t.checking}</p>}
      {chosen && (
        <Card title={t.previewTitle}>
          <div className={styles.compare}>
            <Summary
              title={`${t.backupSide} (${t.time(list?.ok ? (list.value.find((b) => b.file === chosen.file)?.at ?? '') : '')})`}
              summary={chosen.backup}
            />
            <Summary
              title={t.liveSide}
              summary={typeof chosen.live === 'object' ? chosen.live : chosen.live === 'missing' ? t.liveMissing : t.liveDamaged}
            />
          </div>
          <div className={styles.restore}>
            <p>{t.keepsOld}</p>
            <Button disabled={busy} onClick={restore}>
              {busy ? t.restoring : t.restore}
            </Button>
          </div>
        </Card>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </>
  );
}

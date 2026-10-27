import { useEffect, useState } from 'react';
import type { BackupInfo, DbSummary, KeeperResult, RestorePreview } from '../shared';
import styles from './SafeMode.module.css';
import { strings } from './strings';
import Button from './ui/Button';
import { Card, PageHeader } from './ui/Card';
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

// Shown instead of the app while the keeper is in safe mode. `message` is the keeper's plain explanation.
export default function SafeMode({ message, onRestored }: { message: string; onRestored: () => void }) {
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

  const chosen = preview?.ok ? preview.value : null;
  const columns: Column<BackupInfo>[] = [
    { key: 'made', header: t.columns.made, width: 170, render: (b) => t.time(b.at) },
    { key: 'size', header: t.columns.size, num: true, width: 80, render: (b) => t.kb(b.sizeBytes) },
    { key: 'lrs', header: t.columns.lrs, num: true, width: 70, render: (b) => b.summary?.lrs ?? '' },
    { key: 'memos', header: t.columns.memos, num: true, width: 80, render: (b) => b.summary?.memos ?? '' },
    { key: 'masters', header: t.columns.masters, num: true, width: 90, render: (b) => b.summary?.masters ?? '' },
    { key: 'newest', header: t.columns.newestLr, width: 120, render: (b) => b.summary?.newestLrDate ?? '' },
    {
      key: 'status',
      header: t.columns.status,
      render: (b) => <span className={b.damaged ? styles.damaged : undefined}>{b.damaged ? t.status.damaged : t.status.ok}</span>,
    },
    {
      key: 'choose',
      header: '',
      width: 110,
      render: (b) => (
        <Button variant="outline" small disabled={b.damaged || busy} onClick={() => choose(b.file)}>
          {t.choose}
        </Button>
      ),
    },
  ];

  return (
    <main className={styles.page}>
      <PageHeader title={t.title} subtitle={message} />

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
    </main>
  );
}

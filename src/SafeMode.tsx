import BackupPicker from './BackupPicker';
import styles from './SafeMode.module.css';
import { strings } from './strings';
import { PageHeader } from './ui/Card';

const t = strings.safeMode;

// Shown instead of the app while the keeper is in safe mode. `message` is the keeper's plain explanation.
export default function SafeMode({ message, onRestored }: { message: string; onRestored: () => void }) {
  return (
    <main className={styles.page}>
      <PageHeader title={t.title} subtitle={message} />
      <BackupPicker
        onRestore={async (preview) => {
          const r = await window.bm.keeper.restore.apply(preview.file, preview.token);
          if (r.ok) {
            onRestored();
            return null;
          }
          return strings.result(r.code, r.detail);
        }}
      />
    </main>
  );
}

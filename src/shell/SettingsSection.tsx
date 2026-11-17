import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { strings } from '../strings';
import styles from './SettingsPage.module.css';

/** One section of Settings: an orange icon and the title, an ADMIN ONLY chip when every button in it asks for the Admin PIN. No paragraphs inside. */
export default function SettingsSection({ icon: Icon, title, adminOnly = false, children }: { icon: LucideIcon; title: string; adminOnly?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.head}>
        <Icon size={18} className={styles.icon} aria-hidden="true" />
        {title}
        {adminOnly && <span className={styles.adminChip}>{strings.settings.adminOnly}</span>}
      </h2>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

import type { ReactNode } from 'react';
import styles from './Card.module.css';

/** White panel. With a title it gets the header strip used on the dashboard and lists. */
export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`${styles.card} ${className ?? ''}`.trim()}>
      {title && (
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/** A big number with its label and up to two small lines. Counts only, never money (CLAUDE.md). */
export function StatCard({
  icon,
  tag,
  value,
  label,
  lines = [],
  tone = 'teal',
}: {
  icon: ReactNode;
  tag?: ReactNode;
  value: number;
  label: string;
  lines?: [string, string | number][];
  tone?: 'teal' | 'orange';
}) {
  return (
    <div className={`${styles.stat} ${tone === 'orange' ? styles.statOrange : ''}`.trim()}>
      <div className={styles.statTop}>
        <span className={styles.statIcon}>{icon}</span>
        {tag}
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {lines.map(([name, v]) => (
        <div key={name} className={styles.statLine}>
          {name}
          <span className={styles.statLineValue}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Teal banner at the top of every page: title, optional subtitle, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.headerTitle}>{title}</h1>
        {subtitle && <div className={styles.headerSub}>{subtitle}</div>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

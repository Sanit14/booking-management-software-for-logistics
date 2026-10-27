import type { ReactNode } from 'react';
import { strings } from '../strings';
import { Card, PageHeader } from '../ui/Card';
import { pageIcons, type PageId } from './pages';
import styles from './Page.module.css';

/** Every page for now: its teal header and an empty state (or the content a session has already built). */
export default function Page({ id, children }: { id: PageId; children?: ReactNode }) {
  const Icon = pageIcons[id];
  return (
    <>
      <PageHeader title={strings.pages[id]} subtitle={id === 'dashboard' ? strings.company : undefined} />
      {children ?? (
        <Card className={styles.fill}>
          <div className={styles.empty}>
            <Icon size={40} strokeWidth={1.6} aria-hidden="true" />
            <p className={styles.title}>{strings.pageEmpty}</p>
            <p>{strings.pageEmptyHint}</p>
          </div>
        </Card>
      )}
    </>
  );
}

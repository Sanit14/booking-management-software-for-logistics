import type { ReactNode } from 'react';
import { Plus, Truck } from 'lucide-react';
import { strings } from '../strings';
import Button from '../ui/Button';
import { adminPages, mainPages, pageIcons, type PageId } from './pages';
import styles from './Sidebar.module.css';

interface Props {
  page: PageId;
  onSelect: (page: PageId) => void;
  onQuickLr: () => void;
  /** Count badges per page. No real counts exist yet (they arrive with the data sessions). */
  badges?: Partial<Record<PageId, number>>;
  /** The status box at the foot. */
  children?: ReactNode;
}

export default function Sidebar({ page, onSelect, onQuickLr, badges = {}, children }: Props) {
  const group = (label: string, ids: PageId[]) => (
    <>
      <div className={styles.group}>{label}</div>
      <nav aria-label={label} className={styles.nav}>
        {ids.map((id) => {
          const Icon = pageIcons[id];
          const count = badges[id];
          return (
            <button
              key={id}
              type="button"
              className={`${styles.item} ${id === page ? styles.current : ''}`.trim()}
              aria-current={id === page ? 'page' : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon size={18} aria-hidden="true" />
              {strings.pages[id]}
              {count !== undefined && <span className={styles.badge}>{count}</span>}
            </button>
          );
        })}
      </nav>
    </>
  );

  return (
    <aside className={styles.sidebar} aria-label={strings.navLabel}>
      <div className={styles.brand}>
        <div className={styles.logo}>
          <Truck size={24} strokeWidth={2.2} color="var(--orange)" aria-hidden="true" />
        </div>
        <div>
          <div className={styles.name}>{strings.appTitle}</div>
          <div className={styles.company}>{strings.company}</div>
        </div>
      </div>
      <Button className={styles.quick} icon={<Plus size={18} strokeWidth={2.4} aria-hidden="true" />} onClick={onQuickLr}>
        {strings.quickLr}
      </Button>
      {group(strings.nav.main, mainPages)}
      {group(strings.nav.admin, adminPages)}
      {children}
    </aside>
  );
}

import type { ReactNode } from 'react';
import { Plus, Truck } from 'lucide-react';
import { COMPANY_LOCATION, COMPANY_NAME } from '../../shared';
import { keyLabel, type ActionId } from '../logic/keymap';
import { strings } from '../strings';
import Button from '../ui/Button';
import { useKeys } from '../useKeys';
import { ADMIN_PAGES, MAIN_PAGES } from '../logic/sidebar';
import { pageIcons, type PageId } from './pages';
import styles from './Sidebar.module.css';

// The pages that have a key of their own (Settings > Keyboard shortcuts); the tooltip names it.
const pageAction: Partial<Record<PageId, ActionId>> = { dashboard: 'goDashboard', lrEntry: 'goLrEntry', loadingMemo: 'goLoadingMemo' };

interface Props {
  page: PageId;
  onSelect: (page: PageId) => void;
  onQuickLr: () => void;
  /** Count badges per page (counts only, never money); a page without a number shows none. */
  badges?: Partial<Record<PageId, number>>;
  /** The status box at the foot. */
  children?: ReactNode;
}

export default function Sidebar({ page, onSelect, onQuickLr, badges = {}, children }: Props) {
  const { keys } = useKeys();
  const group = (label: string, ids: PageId[]) => (
    <>
      <div className={styles.group}>{label}</div>
      <nav aria-label={label} className={styles.nav}>
        {ids.map((id) => {
          const Icon = pageIcons[id];
          const count = badges[id];
          const action = pageAction[id];
          return (
            <button
              key={id}
              type="button"
              title={action ? `${strings.pages[id]} (${keyLabel(keys[action])})` : undefined}
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
          <Truck size={22} strokeWidth={2.2} color="#ffffff" aria-hidden="true" />
        </div>
        <div>
          <div className={styles.name}>{COMPANY_NAME}</div>
          <div className={styles.company}>{COMPANY_LOCATION}</div>
        </div>
      </div>
      <Button className={styles.quick} icon={<Plus size={18} strokeWidth={2.4} aria-hidden="true" />} keyCap={keyLabel(keys.quickLr)} title={`${strings.quickLr} (${keyLabel(keys.quickLr)})`} onClick={onQuickLr}>
        {strings.quickLr}
      </Button>
      {group(strings.nav.main, MAIN_PAGES)}
      {group(strings.nav.admin, ADMIN_PAGES)}
      {children}
    </aside>
  );
}

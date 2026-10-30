import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChangeTable, Firm, MasterKind, MasterRow, MastersAll } from '../../shared';
import { rowText, visibleRows } from '../logic/masterList';
import type { Jump } from '../logic/searchResults';
import Page from '../shell/Page';
import { strings } from '../strings';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import MasterForm from './MasterForm';
import styles from './MastersPage.module.css';

const t = strings.masters;
const KINDS: MasterKind[] = ['stations', 'firms', 'trucks', 'drivers'];
const NONE: MastersAll = { stations: [], firms: [], trucks: [], drivers: [] };
const MASTER_TABLES: ChangeTable[] = ['stations', 'firms', 'trucks', 'drivers'];
const fetchAll = () => window.bm.keeper.masters.all();

/**
 * Masters: one tab per kind, the list on the left (searched in memory, the keeper has sent everything), the add /
 * edit form on the right. The page loads every master when it opens and again whenever the keeper says one changed
 * (this seat's saves and every other seat's alike). A pick from the search box lands here with that row selected.
 */
export default function MastersPage({ jump, onJumpUsed }: { jump: Jump | null; onJumpUsed: () => void }) {
  const { data, loaded } = useKeeperData(fetchAll, MASTER_TABLES, NONE);
  const [kind, setKind] = useState<MasterKind>('stations');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  // A new key remounts the form: empty fields, first field focused. Bumped after every save, pick, cancel and tab change.
  const [formKey, setFormKey] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const liveForm = useRef(formKey); // the form on screen now
  const focusTab = useRef<number | null>(null); // set by an arrow key: the tab keeps focus after the new form has mounted
  useEffect(() => {
    liveForm.current = formKey;
    if (focusTab.current !== null) tabs.current[focusTab.current]?.focus();
    focusTab.current = null;
  }, [formKey]);

  const show = (k: MasterKind, row: MasterRow | null) => {
    setKind(k);
    setEditing(row);
    setFormKey((n) => n + 1);
  };
  // A search pick: its tab, the row shown in the form and ticked, once the lists are in (an inactive row needs Show inactive).
  const take = useRef(() => {});
  useEffect(() => {
    take.current = () => {
      if (jump?.to !== 'master') return;
      onJumpUsed();
      const row = (data[jump.kind] as MasterRow[]).find((r) => r.id === jump.id);
      if (!row) return;
      setQuery('');
      if (!row.active) setShowInactive(true);
      show(jump.kind, row);
    };
  });
  useEffect(() => {
    if (jump?.to === 'master' && loaded) take.current();
  }, [jump, loaded]);
  const pickTab = (k: MasterKind) => {
    setQuery('');
    show(k, null);
  };
  // Arrow keys move between the tabs and open the next one, as a tab list does.
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (i + step + KINDS.length) % KINDS.length;
    focusTab.current = next;
    pickTab(KINDS[next]);
  };

  const stationName = (id: number | null) => data.stations.find((s) => s.id === id)?.name ?? '';
  const nameCell = (r: MasterRow) => (
    <span className={styles.nameCell}>
      <span className={r.active ? styles.nameText : `${styles.nameText} ${styles.dim}`} title={rowText(r)}>
        {rowText(r)}
      </span>
      {!r.active && <Chip kind="inactive" />}
    </span>
  );
  const col = {
    name: { key: 'name', header: t.columns.name, render: nameCell },
    number: { key: 'number', header: t.columns.number, render: nameCell },
    station: { key: 'station', header: t.columns.station, width: 110, render: (r: MasterRow) => stationName((r as Firm).stationId) },
    phone: { key: 'phone', header: t.columns.phone, width: 112, render: (r: MasterRow) => ('phone' in r ? r.phone : '') },
  } satisfies Record<string, Column<MasterRow>>;
  const columns: Column<MasterRow>[] = { stations: [col.name], firms: [col.name, col.station, col.phone], trucks: [col.number], drivers: [col.name, col.phone] }[kind];

  const rows = visibleRows(data[kind], kind, query, showInactive);

  return (
    <Page id="masters">
      <div className={styles.page}>
        <div className={styles.tabs} role="tablist" aria-label={t.tabsLabel}>
          {KINDS.map((k, i) => (
            <button
              key={k}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={k === kind}
              tabIndex={k === kind ? 0 : -1}
              className={styles.tab}
              onClick={() => pickTab(k)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.tabs[k]}
              <span className={styles.count}>{data[k].filter((r) => r.active).length}</span>
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {/* The form comes first in the page so Tab starts there; the grid puts it on the right. */}
          <MasterForm
            key={formKey}
            kind={kind}
            editing={editing}
            stations={data.stations}
            // A save that finishes after the clerk has moved to another tab or row must not undo that. The list
            // refreshes by itself: the keeper announces every committed write.
            onDone={() => {
              if (liveForm.current === formKey) show(kind, null);
            }}
            onStale={(current) => {
              if (liveForm.current === formKey) show(kind, current);
            }}
            onCancel={() => show(kind, null)}
          />
          <Card className={styles.listCard}>
            <div className={styles.toolbar}>
              <Field className={styles.search} label={t.searchLabel} placeholder={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className={styles.toggle}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                {t.showInactive}
              </label>
            </div>
            <div className={styles.tableBox}>
              <Table
                label={t.listLabel(kind)}
                columns={columns}
                rows={rows}
                rowKey={(r) => String(r.id)}
                ticked={editing ? new Set([String(editing.id)]) : undefined}
                empty={query.trim() ? t.emptySearch : t.empty}
                onRowActivate={(r) => show(kind, r)}
              />
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

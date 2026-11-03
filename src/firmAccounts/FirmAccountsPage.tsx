import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FirmAccountCursor, FirmAccountFilters, FirmAccountPage, FirmAccountRow } from '../../shared';
import { periodOf, type Preset } from '../logic/firmPeriod';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import { NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import SelectField from '../ui/SelectField';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import styles from './FirmAccountsPage.module.css';
import StatementView, { type StatementState } from './StatementView';

const t = strings.firmAccounts;
/** A page of firms with the filters it answers (so "Enter opens the first firm" never acts on rows of older text). */
type Answer = FirmAccountPage & { key: string };
const NO_PAGE: Answer = { rows: [], next: null, count: 0, key: '' };
const LRS_IN: ('any' | Preset)[] = ['any', 'today', 'month', 'lastMonth', 'year'];
const WAIT_MS = 150; // after the last key, so a fast typist asks once

interface ListState {
  text: string;
  stationId: string;
  showInactive: boolean;
  lrsIn: 'any' | Preset;
}
interface View {
  list: ListState;
  /** The firm whose account is open, or null for the list. */
  firm: { id: number; name: string } | null;
  statement: StatementState;
}
const START: View = {
  list: { text: '', stationId: '', showInactive: false, lrsIn: 'any' },
  firm: null,
  statement: { preset: 'month', from: '', to: '', role: 'both', tab: 'lrs', year: null },
};
// The page is unmounted whenever another page is shown (to open an LR from the account, say): coming back finds the list and the account as they were.
let last: View = START;

function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

interface Props {
  /** The keeper PC's today (null until the Dashboard's summary is in): what Today, This month and the other presets mean. */
  today: string | null;
  /** A search pick on its way here: a firm's account. */
  jump: Jump | null;
  onJumpUsed: () => void;
  /** An LR or a challan clicked in the account opens on its own page. */
  onPick: (jump: Jump) => void;
}

/**
 * Firm Accounts: every firm in the masters with the LRs it has had, and, one click on, its account for a period (StatementView).
 * Read only: the keeper builds every figure from the LRs, memos and wasuli that already exist. Walk-in parties have no firm row and are
 * not here.
 */
export default function FirmAccountsPage({ today, jump, onJumpUsed, onPick }: Props) {
  const [view, setView] = useState<View>(last);
  useEffect(() => {
    last = view;
  }, [view]);
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), ['stations', 'firms'], NONE);

  // A search pick: that firm's account, once the masters are in (they give its name).
  const take = useRef(() => {});
  useEffect(() => {
    take.current = () => {
      if (jump?.to !== 'account') return;
      onJumpUsed();
      const firm = masters.data.firms.find((f) => f.id === jump.id);
      if (firm) setView((v) => ({ ...v, firm: { id: firm.id, name: firm.name }, statement: START.statement }));
    };
  });
  useEffect(() => {
    if (jump?.to === 'account' && masters.loaded) take.current();
  }, [jump, masters.loaded]);

  // Esc goes back to the list (not while a dialog or the date picker has it).
  const open = view.firm !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) setView((v) => ({ ...v, firm: null }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const typed = view.list.text;
  const settled = useDebounced(typed, WAIT_MS);
  const filters: FirmAccountFilters = {
    text: settled,
    stationId: view.list.stationId === '' ? null : Number(view.list.stationId),
    showInactive: view.list.showInactive,
    period: view.list.lrsIn === 'any' || !today ? null : periodOf(view.list.lrsIn, today),
  };
  const filtersKey = JSON.stringify(filters);
  // "Load more" asks for one more page; changing a filter starts again from the first.
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === filtersKey ? loaded.pages : 1;
  const list = useKeeperData<Answer>(
    async () => {
      let cursor: FirmAccountCursor | null = null;
      const rows: FirmAccountRow[] = [];
      let lastPage: FirmAccountPage = NO_PAGE;
      for (let i = 0; i < pages; i++) {
        const r = await window.bm.keeper.firms.accounts(filters, cursor);
        if (!r.ok) return r;
        lastPage = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { ...lastPage, rows, key: filtersKey } };
    },
    ['firms', 'lrs', 'stations'], // a row counts LRs and shows the firm's station
    NO_PAGE,
    [filtersKey, pages],
  );
  const { rows, next, count } = list.data;

  const patchList = (patch: Partial<ListState>) => setView((v) => ({ ...v, list: { ...v.list, ...patch } }));
  // A firm opened from the list or a search starts on the defaults (This month, Both, LRs); the view kept for a visit to an LR and back is not reset.
  const openFirm = (r: Pick<FirmAccountRow, 'id' | 'name'>) => setView((v) => ({ ...v, firm: { id: r.id, name: r.name }, statement: START.statement }));
  const stations = useMemo(
    () => [{ value: '', label: t.allStations }, ...masters.data.stations.filter((s) => s.active).map((s) => ({ value: String(s.id), label: s.name }))],
    [masters.data.stations],
  );
  const lrsInOptions = LRS_IN.map((p) => ({ value: p, label: p === 'any' ? t.anyTime : t.presets[p] }));

  if (view.firm) {
    if (!today) return null;
    return (
      <StatementView
        key={view.firm.id}
        // the masters are refetched when a firm is renamed: the header and the print toast follow
        firm={{ id: view.firm.id, name: masters.data.firms.find((f) => f.id === view.firm?.id)?.name ?? view.firm.name }}
        today={today}
        state={view.statement}
        onChange={(patch) => setView((v) => ({ ...v, statement: { ...v.statement, ...patch } }))}
        onBack={() => setView((v) => ({ ...v, firm: null }))}
        onPick={onPick}
      />
    );
  }

  const c = t.columns;
  const columns: Column<FirmAccountRow>[] = [
    {
      key: 'firm',
      header: c.firm,
      render: (r) => (
        <span className={styles.nameCell}>
          <span className={r.active ? styles.cell : `${styles.cell} ${styles.dim}`} title={r.name}>
            {r.name}
          </span>
          {!r.active && <Chip kind="inactive" />}
        </span>
      ),
    },
    { key: 'station', header: c.station, width: 130, render: (r) => text(r.station ?? '') },
    { key: 'asConsignor', header: c.asConsignor, width: 120, num: true, render: (r) => r.asConsignor },
    { key: 'asConsignee', header: c.asConsignee, width: 120, num: true, render: (r) => r.asConsignee },
    { key: 'lastLr', header: c.lastLr, width: 112, render: (r) => (r.lastLrDate ? isoToDisplay(r.lastLrDate) : '–') },
  ];
  // Enter in the search box opens the first firm shown, once the list has caught up with what was typed.
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (typed === settled && list.data.key === filtersKey && rows.length > 0) openFirm(rows[0]);
  };
  const filtered = settled.trim() !== '' || filters.stationId !== null || filters.period !== null;

  return (
    <div className={styles.page}>
      <Card className={styles.filters}>
        <div className={styles.filterRow}>
          <Field
            className={styles.search}
            label={t.searchLabel}
            placeholder={t.searchPlaceholder}
            autoFocus
            value={typed}
            onChange={(e) => patchList({ text: e.target.value })}
            onKeyDown={onSearchKey}
          />
          <SelectField className={styles.station} label={t.stationLabel} value={view.list.stationId} options={stations} onChange={(e) => patchList({ stationId: e.target.value })} />
          <SelectField
            className={styles.lrsIn}
            label={t.lrsInLabel}
            value={view.list.lrsIn}
            options={lrsInOptions}
            onChange={(e) => patchList({ lrsIn: e.target.value as ListState['lrsIn'] })}
          />
          <label className={styles.toggle}>
            <input type="checkbox" checked={view.list.showInactive} onChange={(e) => patchList({ showInactive: e.target.checked })} />
            {t.showInactive}
          </label>
        </div>
      </Card>
      <Card className={styles.listCard}>
        <div className={styles.tableBox}>
          <Table label={t.listLabel} columns={columns} rows={rows} rowKey={(r) => String(r.id)} empty={filtered ? t.emptyFilter : t.empty} onRowActivate={openFirm} />
        </div>
        <div className={styles.totals}>
          <span>{t.shown(rows.length, count)}</span>
          {next && (
            <Button small variant="outline" onClick={() => setLoaded({ key: filtersKey, pages: pages + 1 })}>
              {t.loadMore(count - rows.length)}
            </Button>
          )}
          <span className={styles.hint}>{t.openHint}</span>
        </div>
      </Card>
    </div>
  );
}

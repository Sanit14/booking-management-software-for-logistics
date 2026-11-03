import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { FirmKpis, FirmMonth, FirmRole, KeeperResult, StatementCursor, StatementPage, StatementQuery, StatementRow, StatementTop, TopItem } from '../../shared';
import { growthLabel, isRange, periodOf, yearChoices, type Preset } from '../logic/firmPeriod';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import { rupees } from '../loadingMemo/columns';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import Table, { type Column } from '../ui/Table';
import { useKeeperData } from '../useKeeperData';
import { usePrint } from '../usePrint';
import GrowthChart from './GrowthChart';
import styles from './FirmAccountsPage.module.css';

const t = strings.firmAccounts;
// A statement reads LRs, their memos and wasuli, and shows station and truck names: any of those changing on any seat refetches it.
const TABLES = ['lrs', 'memos', 'wasuli', 'stations', 'trucks'] as const;
const PRESETS: Preset[] = ['today', 'month', 'lastMonth', 'year'];
const ROLES: FirmRole[] = ['both', 'consignor', 'consignee'];
const NO_STATEMENT: StatementPage = {
  rows: [],
  next: null,
  totals: { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, chargesPaise: 0, staxPaise: 0, totalPaise: 0, wasuliOwedPaise: 0, wasuliCollectedPaise: 0 },
};
const nothing = <T,>(value: T): Promise<KeeperResult<T>> => Promise.resolve({ ok: true as const, value });
const money = (paise: number) => (paise > 0 ? rupees(paise) : '–');

/** What the clerk chose on this firm's account: the period, which side of the LR, which view. Kept by the page, so leaving to open an LR and coming back finds it. */
export interface StatementState {
  preset: Preset | 'custom';
  from: string;
  to: string;
  role: FirmRole;
  tab: 'lrs' | 'growth';
  year: number | null;
}

interface Props {
  firm: { id: number; name: string };
  /** The keeper PC's today. */
  today: string;
  state: StatementState;
  onChange: (patch: Partial<StatementState>) => void;
  onBack: () => void;
  onPick: (jump: Jump) => void;
}

const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

function TopList({ title, items }: { title: string; items: TopItem[] }) {
  const most = Math.max(1, ...items.map((i) => i.lrs));
  return (
    <Card className={styles.top}>
      <h3 className={styles.topTitle}>{title}</h3>
      {items.length === 0 ? (
        <div className={styles.none}>{t.topNone}</div>
      ) : (
        <ul className={styles.topList}>
          {items.map((i) => (
            <li key={i.name}>
              <span className={styles.topName} title={i.name}>
                {i.name}
              </span>
              <span className={styles.topCount}>{t.topLrs(i.lrs)}</span>
              <span className={styles.topBar}>
                <i style={{ width: `${Math.round((i.lrs / most) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One firm's account for a period: the KPI cards with growth against the period before, then either its LRs (with the totals of the
 * whole period) or the 12-month growth chart and the top lists. Read only; the keeper adds everything up, this draws it. Clicking an
 * LR or a challan number opens it.
 */
export default function StatementView({ firm, today, state, onChange, onBack, onPick }: Props) {
  const print = usePrint();
  const range = state.preset === 'custom' ? { from: state.from, to: state.to } : periodOf(state.preset, today);
  const valid = isRange(range.from, range.to);
  const query: StatementQuery = { firmId: firm.id, from: range.from, to: range.to, role: state.role };
  const queryKey = JSON.stringify(query);

  const kpis = useKeeperData<FirmKpis | null>(() => (valid ? window.bm.keeper.firms.kpis(query) : nothing(null)), TABLES, null, [queryKey, valid]);

  // "Load more" asks for one more page; changing the period or the side starts again from the first.
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === queryKey ? loaded.pages : 1;
  const list = useKeeperData<StatementPage>(
    async () => {
      if (!valid) return nothing(NO_STATEMENT);
      let cursor: StatementCursor | null = null;
      const rows: StatementRow[] = [];
      let last = NO_STATEMENT;
      for (let i = 0; i < pages; i++) {
        const r = await window.bm.keeper.firms.statement(query, cursor);
        if (!r.ok) return r;
        last = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { ...last, rows } };
    },
    TABLES,
    NO_STATEMENT,
    [queryKey, pages, valid],
  );

  // The second view is read only when it is open.
  const growthOpen = state.tab === 'growth';
  const year = state.year ?? Number(today.slice(0, 4));
  const top = useKeeperData<StatementTop | null>(() => (growthOpen && valid ? window.bm.keeper.firms.statementTop(query) : nothing(null)), TABLES, null, [queryKey, growthOpen, valid]);
  const months = useKeeperData<FirmMonth[]>(() => (growthOpen ? window.bm.keeper.firms.months(firm.id, year, state.role) : nothing([])), TABLES, [], [growthOpen, year, state.role, firm.id]);

  const pick = (preset: Preset | 'custom') => onChange(preset === 'custom' ? { preset, from: state.from || range.from, to: state.to || range.to } : { preset });

  const k = kpis.data;
  const cards = [
    { key: 'lrs', label: t.kpis.lrs, value: k ? String(k.now.lrs) : '–', growth: k?.growth.lrs ?? null },
    { key: 'trips', label: t.kpis.trips, value: k ? String(k.now.trips) : '–', growth: k?.growth.trips ?? null },
    { key: 'freight', label: t.kpis.freight, value: k ? rupees(k.now.freightPaise) : '–', growth: k?.growth.freightPaise ?? null },
    { key: 'total', label: t.kpis.total, value: k ? rupees(k.now.totalPaise) : '–', growth: k?.growth.totalPaise ?? null },
    { key: 'wasuli', label: t.kpis.wasuli, value: k ? rupees(k.now.wasuliCollectedPaise) : '–', growth: k?.growth.wasuliCollectedPaise ?? null },
  ];

  const c = t.statementColumns;
  const columns: Column<StatementRow>[] = [
    {
      key: 'lr',
      header: c.lr,
      width: 56,
      num: true,
      render: (r) => (
        <button
          type="button"
          className={styles.link}
          tabIndex={-1} // the row is the one Tab stop (Enter opens the LR); a click on the number does the same
          title={t.openLr(r.lrNo)}
          aria-label={t.openLr(r.lrNo)}
          onClick={(e) => {
            e.stopPropagation();
            onPick({ to: 'lr', id: r.lrId });
          }}
        >
          {r.lrNo}
        </button>
      ),
    },
    { key: 'date', header: c.date, width: 100, render: (r) => isoToDisplay(r.date) },
    {
      key: 'party',
      header: c.party,
      render: (r) => {
        // The line under the party is cut to fit; the tooltip has all of it, From included.
        const shown = `${r.toStation} · ${r.particular} · ${c.qty} ${r.qty}`;
        // Which side the firm is on matters only when both sides are listed.
        const side = state.role === 'both' ? t.roleTag[r.role] : '';
        return (
          <>
            {text(r.party)}
            <span className={styles.sub} title={`${side ? `${side} · ` : ''}${r.fromStation} → ${shown}`}>
              {side && <b className={styles.role}>{side} · </b>}
              {shown}
            </span>
          </>
        );
      },
    },
    {
      key: 'freight',
      header: c.freight,
      width: 92,
      num: true,
      render: (r) => (
        <>
          {money(r.toPayPaise > 0 ? r.toPayPaise : r.paidPaise)}
          <span className={styles.sub}>{r.toPayPaise > 0 ? c.toPay : r.paidPaise > 0 ? c.paid : ''}</span>
        </>
      ),
    },
    {
      key: 'charges',
      header: c.chargesTax,
      width: 92,
      num: true,
      render: (r) => (
        <>
          {money(r.chargesPaise)}
          <span className={styles.sub}>{`${c.taxShort} ${money(r.staxPaise)}`}</span>
        </>
      ),
    },
    { key: 'total', header: c.total, width: 92, num: true, render: (r) => rupees(r.totalPaise) },
    {
      key: 'challan',
      header: c.challan,
      width: 88,
      num: true,
      render: (r) =>
        r.memoId !== null && r.challanNo !== null ? (
          <button
            type="button"
            className={styles.link}
            tabIndex={-1}
            title={t.openChallan(r.challanNo)}
            aria-label={t.openChallan(r.challanNo)}
            onClick={(e) => {
              e.stopPropagation(); // not also the row's own click (the LR)
              onPick({ to: 'memo', id: r.memoId as number });
            }}
          >
            {r.challanNo}
          </button>
        ) : (
          <Chip kind="booked" />
        ),
    },
    {
      key: 'wasuli',
      header: c.wasuli,
      width: 100,
      num: true,
      render: (r) =>
        r.wasuliStatus === null ? (
          ''
        ) : (
          <>
            {rupees(r.wasuliPaise)}
            <span className={styles.sub}>{r.wasuliStatus === 'collected' ? t.wasuliIn(rupees(r.wasuliCollectedPaise)) : t.wasuliState[r.wasuliStatus]}</span>
          </>
        ),
    },
  ];

  const x = list.data.totals;
  const prev = k?.previous;
  return (
    <div className={styles.page}>
      <Card>
        <div className={styles.head}>
          <Button small variant="ghost" icon={<ArrowLeft size={18} aria-hidden="true" />} aria-label={t.backLabel} onClick={onBack}>
            {t.back}
          </Button>
          <h1 className={styles.firmName} title={firm.name}>
            {firm.name}
          </h1>
          <Button small variant="outline" disabled={!valid} aria-label={t.printLabel} onClick={() => void print.firmStatement(query, firm.name, 'print')}>
            {t.print}
          </Button>
          <Button small variant="outline" disabled={!valid} aria-label={t.savePdfLabel} onClick={() => void print.firmStatement(query, firm.name, 'pdf')}>
            {t.savePdf}
          </Button>
        </div>
        <div className={styles.controls}>
          <span className={styles.pills} role="group" aria-label={t.periodLabel}>
            {PRESETS.map((p) => (
              <button key={p} type="button" className={styles.pill} aria-pressed={state.preset === p} onClick={() => pick(p)}>
                {t.presets[p]}
              </button>
            ))}
            <button type="button" className={styles.pill} aria-pressed={state.preset === 'custom'} onClick={() => pick('custom')}>
              {t.presets.custom}
            </button>
          </span>
          {state.preset === 'custom' && (
            <span className={styles.dates}>
              <Field className={styles.dateField} label={t.from} type="date" value={state.from} onChange={(e) => onChange({ from: e.target.value })} />
              <Field className={styles.dateField} label={t.to} type="date" value={state.to} onChange={(e) => onChange({ to: e.target.value })} />
              {!valid && <span className={styles.dateNote}>{t.customNeeds}</span>}
            </span>
          )}
          <span className={styles.pills} role="group" aria-label={t.roleLabel}>
            {ROLES.map((r) => (
              <button key={r} type="button" className={styles.pill} aria-pressed={state.role === r} onClick={() => onChange({ role: r })}>
                {t.roles[r]}
              </button>
            ))}
          </span>
        </div>
      </Card>

      <div className={styles.kpis}>
        {cards.map((card) => {
          const g = growthLabel(card.growth);
          return (
            <div key={card.key} className={styles.kpi}>
              <div className={styles.kpiValue} title={card.value}>
                {card.value}
              </div>
              <div className={styles.kpiLabel}>{card.label}</div>
              <div className={`${styles.kpiGrowth} ${styles[g.tone]}`}>
                {g.text} <span>{t.vsBefore}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.compared}>{prev ? t.comparedWith(isoToDisplay(prev.from), isoToDisplay(prev.to)) : <>&nbsp;</>}</p>

      <div className={styles.tabs} role="tablist" aria-label={t.tabsLabel}>
        {(['lrs', 'growth'] as const).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={state.tab === tab} className={styles.tab} onClick={() => onChange({ tab })}>
            {t.tabs[tab]}
          </button>
        ))}
      </div>

      {state.tab === 'lrs' ? (
        <Card className={styles.listCard}>
          <div className={styles.lrBox}>
            <Table label={t.statementLabel} columns={columns} rows={list.data.rows} rowKey={(r) => String(r.lrId)} empty={t.emptyStatement} onRowActivate={(r) => onPick({ to: 'lr', id: r.lrId })} />
          </div>
          <div className={styles.totals}>
            <span>
              {t.totals.lrs} <strong>{x.lrs}</strong>
            </span>
            <span>
              {t.totals.qty} <strong>{x.qty}</strong>
            </span>
            <span>
              {t.totals.toPay} <strong>{rupees(x.toPayPaise)}</strong>
            </span>
            <span>
              {t.totals.paid} <strong>{rupees(x.paidPaise)}</strong>
            </span>
            <span>
              {t.totals.charges} <strong>{rupees(x.chargesPaise)}</strong>
            </span>
            <span>
              {t.totals.stax} <strong>{rupees(x.staxPaise)}</strong>
            </span>
            <span>
              {t.totals.total} <strong>{rupees(x.totalPaise)}</strong>
            </span>
            {x.wasuliOwedPaise > 0 && (
              <span>
                {t.totals.wasuli} <strong>{rupees(x.wasuliOwedPaise)}</strong> · {t.totals.wasuliCollected} <strong>{rupees(x.wasuliCollectedPaise)}</strong>
              </span>
            )}
            {list.data.next && (
              <Button small variant="outline" onClick={() => setLoaded({ key: queryKey, pages: pages + 1 })}>
                {t.loadMoreLrs(x.lrs - list.data.rows.length)}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className={styles.growth}>
          <Card>
            <div className={styles.growthHead}>
              <h2 className={styles.growthTitle}>{t.growthTitle}</h2>
              <span className={styles.pills} role="group" aria-label={t.yearLabel}>
                {yearChoices(today).map((y) => (
                  <button key={y} type="button" className={styles.pill} aria-pressed={y === year} onClick={() => onChange({ year: y })}>
                    {y}
                  </button>
                ))}
              </span>
            </div>
            {months.data.length === 12 && <GrowthChart year={Number(months.data[0].month.slice(0, 4))} months={months.data} />}
            <p className={styles.note}>{t.growthNote}</p>
          </Card>
          <div className={styles.tops}>
            <TopList title={t.top.parties[state.role]} items={top.data?.parties ?? []} />
            <TopList title={t.top.stations} items={top.data?.stations ?? []} />
            <TopList title={t.top.trucks} items={top.data?.trucks ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { REPORT_FILTERS, type ReportKind } from '../../shared';
import { isRange, type Preset } from '../logic/firmPeriod';
import { NO_PAGES, startPages, withFirstPage, withMorePage, type FirstPage, type Paged } from '../logic/reportPages';
import { periodFor, queryOf, START_VIEW, type ReportsView } from '../logic/reportQuery';
import type { Jump } from '../logic/searchResults';
import { NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import SelectField from '../ui/SelectField';
import Table from '../ui/Table';
import { useToast } from '../ui/Toast';
import { useDebounced } from '../useDebounced';
import { useKeeperData } from '../useKeeperData';
import { usePrint } from '../usePrint';
import { DEFS, type Action } from './defs';
import ReportLrs, { type Drill } from './ReportLrs';
import styles from './ReportsPage.module.css';

const t = strings.reports;
const KINDS = Object.keys(REPORT_FILTERS) as ReportKind[]; // the order they are listed in
const PRESETS: Preset[] = ['today', 'month', 'lastMonth', 'year'];
// A report reads LRs, memos and collections, and shows names from the masters: any of those changing on any seat refetches it.
const TABLES = ['lrs', 'memos', 'wasuli', 'firms', 'stations', 'trucks', 'agents'] as const;
const WAIT_MS = 150; // after the last key in the name box, so a fast typist asks once

/** What the first page answers before there is an answer (no report asked for yet). */
const NO_FIRST: FirstPage = { key: '', rows: [], next: null, totals: null };

interface Saved {
  view: ReportsView;
  drill: Drill | null;
}
// The page is unmounted whenever another page is shown (to open an LR or a memo from a row): coming back finds the report as left.
let last: Saved = { view: START_VIEW, drill: null };

interface Props {
  /** The keeper PC's today (null until the Dashboard's summary is in): what Today, This month and the other presets mean. */
  today: string | null;
  /** A row opens an LR, a memo, a day or a firm's account on their own page. */
  onPick: (jump: Jump) => void;
}

/**
 * Reports: one of seven, for a period, with its filters, the rows (100 a page) and the totals of the whole filter. Read only: the keeper
 * adds everything up from the LRs, memos and collections that exist; this page asks and draws. A click on a row leads to what is behind it.
 */
export default function ReportsPage({ today, onPick }: Props) {
  const [saved, setSaved] = useState<Saved>(last);
  useEffect(() => {
    last = saved;
  }, [saved]);
  const { view, drill } = saved;
  const patch = (p: Partial<ReportsView>) => setSaved((s) => ({ ...s, view: { ...s.view, ...p } }));
  const print = usePrint();
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), ['stations', 'trucks', 'agents'], NONE);

  // Esc goes back from the LRs behind a row to the report (not while a dialog has it).
  const drilling = drill !== null;
  useEffect(() => {
    if (!drilling) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) setSaved((s) => ({ ...s, drill: null }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drilling]);

  const settled = useDebounced(view.text, WAIT_MS);
  const query = today ? queryOf(view, today, settled) : null;
  const def = DEFS[view.kind];
  const answerKey = JSON.stringify([view.kind, query]);
  // The first page and the totals are read again whenever any seat changes something the report reads. The pages below the first (Load more) are not:
  // they stay as they were, marked out of date, with a Refresh. (Re-reading every loaded page made each LR saved on any seat cost the keeper a full report per page.)
  const first = useKeeperData<FirstPage>(
    async () => {
      if (!query) return { ok: true as const, value: NO_FIRST };
      const r = await def.read(query, null);
      return r.ok ? { ok: true as const, value: { key: answerKey, rows: r.value.rows, next: r.value.next, totals: r.value.totals } } : r;
    },
    TABLES,
    NO_FIRST,
    [answerKey],
  );
  const [paged, setPaged] = useState<Paged>(NO_PAGES);
  const [taken, setTaken] = useState<FirstPage>(NO_FIRST); // the first-page answer that `paged` has taken in
  if (taken !== first.data) {
    setTaken(first.data);
    setPaged((p) => withFirstPage(p, first.data, (row) => def.rowKey(row as never)));
  }
  const answered = paged.key === answerKey; // the answer is to this report, period and filters
  const current = answered ? paged : NO_PAGES;
  const toast = useToast();
  const moreInFlight = useRef(false);
  const latestFirst = useRef(first.data); // the newest first page, for a Load more that is still on its way when a change comes in
  useEffect(() => {
    latestFirst.current = first.data;
  });
  const loadMore = async () => {
    if (!query || !current.next || moreInFlight.current) return;
    moreInFlight.current = true;
    const askedWith = first.data;
    try {
      const r = await def.read(query, current.next);
      if (!r.ok) return void toast.error(strings.result(r.code, r.detail));
      setPaged((p) => (p.key === answerKey ? withMorePage(p, r.value, latestFirst.current !== askedWith) : p));
    } finally {
      moreInFlight.current = false;
    }
  };

  // The row of reports is one Tab stop; the arrow keys walk it and Enter (a click) opens the report.
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState(KINDS.indexOf(view.kind));
  const onListKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    if (!forward && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (forward ? 1 : KINDS.length - 1)) % KINDS.length;
    setFocusAt(next);
    tabs.current[next]?.focus();
  };

  const uses = REPORT_FILTERS[view.kind];
  const options = useMemo(() => {
    const pick = <T extends { id: number; active: boolean }>(all: string, rows: T[], name: (r: T) => string) => [
      { value: '', label: all },
      ...rows.map((r) => ({ value: String(r.id), label: r.active ? name(r) : t.inactive(name(r)) })),
    ];
    return {
      stations: pick(t.allStations, masters.data.stations, (r) => r.name),
      trucks: pick(t.allTrucks, masters.data.trucks, (r) => r.number),
      agents: pick(t.allAgents, masters.data.agents, (r) => r.name),
    };
  }, [masters.data]);

  if (!today) return null;
  const act = (a: Action) => {
    if ('jump' in a) onPick(a.jump);
    else if (query) setSaved((s) => ({ ...s, drill: { ...a.drill, query } }));
  };
  if (drill) return <ReportLrs drill={drill} onBack={() => setSaved((s) => ({ ...s, drill: null }))} onPick={onPick} />;

  const name = strings.paper.report.kinds[view.kind].name;
  const range = periodFor(view, today);
  const valid = query !== null && isRange(range.from, range.to);
  const labels = strings.paper.report.kinds[view.kind].totals;
  const values = current.totals === null ? [] : def.totals(current.totals);
  const open = def.open;
  return (
    <div className={styles.page}>
      <div role="tablist" aria-label={t.listLabel} className={styles.tabs}>
        {KINDS.map((kind, i) => (
          <button
            key={kind}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={view.kind === kind}
            tabIndex={i === focusAt ? 0 : -1}
            className={styles.reportTab}
            onKeyDown={(e) => onListKey(e, i)}
            onClick={() => {
              setFocusAt(i);
              patch({ kind });
            }}
          >
            {strings.paper.report.kinds[kind].name}
          </button>
        ))}
      </div>

      <div className={styles.pane}>
        <Card>
          <div className={styles.head}>
            <h1 className={styles.title}>{name}</h1>
            <Button small variant="outline" disabled={!valid} aria-label={t.printLabel} onClick={() => query && void print.report(view.kind, query, 'print')}>
              {t.print}
            </Button>
            <Button small variant="outline" disabled={!valid} aria-label={t.savePdfLabel} onClick={() => query && void print.report(view.kind, query, 'pdf')}>
              {t.savePdf}
            </Button>
          </div>
          <div className={styles.controls}>
            <span className={styles.pills} role="group" aria-label={t.periodLabel}>
              {PRESETS.map((p) => (
                <button key={p} type="button" className={styles.pill} aria-pressed={view.preset === p} onClick={() => patch({ preset: p })}>
                  {t.presets[p]}
                </button>
              ))}
              <button
                type="button"
                className={styles.pill}
                aria-pressed={view.preset === 'custom'}
                onClick={() => patch({ preset: 'custom', from: view.from || range.from, to: view.to || range.to })}
              >
                {t.presets.custom}
              </button>
            </span>
            {view.preset === 'custom' && (
              <span className={styles.dates}>
                <Field className={styles.dateField} label={t.from} type="date" value={view.from} onChange={(e) => patch({ from: e.target.value })} />
                <Field className={styles.dateField} label={t.to} type="date" value={view.to} onChange={(e) => patch({ to: e.target.value })} />
                {!valid && <span className={styles.dateNote}>{t.customNeeds}</span>}
              </span>
            )}
          </div>
          <div className={styles.filterRow} role="group" aria-label={t.filtersLabel}>
            {uses.includes('toStationId') && <SelectField label={t.station} value={view.toStationId} options={options.stations} onChange={(e) => patch({ toStationId: e.target.value })} />}
            {uses.includes('truckId') && <SelectField label={t.truck} value={view.truckId} options={options.trucks} onChange={(e) => patch({ truckId: e.target.value })} />}
            {uses.includes('agentId') && <SelectField label={t.agent} value={view.agentId} options={options.agents} onChange={(e) => patch({ agentId: e.target.value })} />}
            {uses.includes('text') && (
              <Field
                label={t.textLabel[view.kind as keyof typeof t.textLabel]}
                placeholder={t.textPlaceholder}
                value={view.text}
                onChange={(e) => patch({ text: e.target.value })}
              />
            )}
          </div>
        </Card>

        <Card className={styles.listCard}>
          <div className={styles.tableBox}>
            <Table
              label={t.tableLabel(name)}
              columns={def.columns}
              rows={current.rows}
              rowKey={def.rowKey}
              empty={answered || query === null ? t.empty : ''}
              keyboardScroll
              onRowActivate={open && query ? (row) => act(open(row, query)) : undefined}
            />
          </div>
          <div className={styles.totals}>
            {labels.map((label, i) => (
              <span key={label}>
                {label} <strong>{values[i] ?? '–'}</strong>
              </span>
            ))}
            {current.next && (
              <Button small variant="outline" onClick={() => void loadMore()}>
                {t.loadMore}
              </Button>
            )}
            {current.stale && (
              <span role="status">
                {t.staleRows}{' '}
                <Button small variant="outline" onClick={() => setPaged(startPages(first.data))}>
                  {t.refresh}
                </Button>
              </span>
            )}
            <span className={styles.hint}>{view.kind === 'firmWise' ? t.firmNote : t.openHint[view.kind]}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

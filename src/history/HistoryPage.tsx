import { useEffect, useState } from 'react';
import { CHANGE_TABLES, HISTORY_KINDS, HISTORY_VERBS, type HistoryCursor, type HistoryRow, type KeeperResult } from '../../shared';
import { isRange } from '../logic/firmPeriod';
import { START_VIEW, parseNumber, periodFor, queryOf, type HistoryPreset, type HistoryView } from '../logic/historyQuery';
import { changeLine, jumpOf, openLabel, sentence } from '../logic/historySentence';
import type { Jump } from '../logic/searchResults';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import SelectField from '../ui/SelectField';
import Table, { type Column } from '../ui/Table';
import { useDebounced } from '../useDebounced';
import { useKeeperData } from '../useKeeperData';
import styles from './HistoryPage.module.css';

const t = strings.history;
const PRESETS: Exclude<HistoryPreset, 'custom'>[] = ['week', 'today', 'month', 'lastMonth'];
const WAIT_MS = 150; // after the last key in a text box, so a fast typist asks once
const SEP = '\u0000';

/** The rows with the request they answer, so rows of another filter are never drawn under these filters. */
interface Answer {
  key: string;
  rows: HistoryRow[];
  next: HistoryCursor | null;
}
const NO_ANSWER: Answer = { key: '', rows: [], next: null };

// The page is unmounted whenever another page is shown (to open an LR from a row): coming back finds the filters as left.
let last: HistoryView = START_VIEW;

const kindOptions = [{ value: '', label: t.allKinds }, ...HISTORY_KINDS.map((k) => ({ value: k, label: t.kinds[k] }))];
const verbOptions = [{ value: '', label: t.allVerbs }, ...HISTORY_VERBS.map((v) => ({ value: v, label: t.verbs[v] }))];

interface Props {
  /** The keeper PC's today (null until the Dashboard's summary is in): what Today, This month and the other presets mean. */
  today: string | null;
  /** A row's record opens on its own page. */
  onPick: (jump: Jump) => void;
}

/**
 * History: everything that was written to the books, newest first — who, when, on which seat, and what changed. Read only: the keeper
 * filters, pages and resolves names; this page asks, words each row and leads to the record behind it. An action it has no sentence for
 * shows its raw code.
 */
export default function HistoryPage({ today, onPick }: Props) {
  const [view, setView] = useState<HistoryView>(last);
  useEffect(() => {
    last = view;
  }, [view]);
  const patch = (p: Partial<HistoryView>) => setView((v) => ({ ...v, ...p }));
  const [shown, setShown] = useState<number | null>(null); // the row whose details are open

  const [seat, lr, challan] = useDebounced([view.seat, view.lr, view.challan].join(SEP), WAIT_MS).split(SEP);
  const query = today ? queryOf(view, today, { seat, lr, challan }) : null;
  const answerKey = JSON.stringify(query);
  // "Load more" asks for one more page; changing a filter starts again from the first.
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === answerKey ? loaded.pages : 1;
  const list = useKeeperData<Answer>(
    async () => {
      if (!query) return { ok: true as const, value: NO_ANSWER };
      let cursor: HistoryCursor | null = null;
      const rows: HistoryRow[] = [];
      for (let i = 0; i < pages; i++) {
        const r: KeeperResult<{ rows: HistoryRow[]; next: HistoryCursor | null }> = await window.bm.keeper.history.list(query, cursor);
        if (!r.ok) return r;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { key: answerKey, rows, next: cursor } };
    },
    CHANGE_TABLES, // any write by any seat can be a new row
    NO_ANSWER,
    [answerKey, pages],
  );
  const answered = list.data.key === answerKey; // the answer is to these filters
  const current = answered ? list.data : NO_ANSWER;
  const row = shown === null ? undefined : current.rows.find((r) => r.id === shown);

  if (!today) return null;
  const range = periodFor(view, today);
  const validPeriod = isRange(range.from, range.to);
  const bad = (text: string) => parseNumber(text) === 'invalid';
  const columns: Column<HistoryRow>[] = [
    { key: 'when', header: t.columns.when, width: 150, render: (r) => <span className={styles.when}>{strings.history.when(r.at)}</span> },
    { key: 'seat', header: t.columns.seat, width: 100, render: (r) => <span className={styles.cell}>{r.seat}</span> },
    {
      key: 'what',
      header: t.columns.what,
      render: (r) => {
        const text = sentence(r, t);
        return (
          <span className={styles.what} title={text}>
            {text}
          </span>
        );
      },
    },
  ];
  const toggle = (r: HistoryRow) => setShown((now) => (now === r.id ? null : r.id));
  const open = (r: HistoryRow) => {
    const jump = jumpOf(r);
    if (jump) onPick(jump);
  };
  const filtered = view.seat !== '' || view.kind !== '' || view.verb !== '' || view.lr !== '' || view.challan !== '';

  return (
    <div className={styles.page}>
      <Card>
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
              {!validPeriod && <span className={styles.dateNote}>{t.customNeeds}</span>}
            </span>
          )}
          <label className={styles.toggle}>
            <input type="checkbox" checked={view.showPrints} onChange={(e) => patch({ showPrints: e.target.checked })} />
            {t.showPrints}
          </label>
        </div>
        <div className={styles.filterRow} role="group" aria-label={t.filtersLabel}>
          <Field label={t.seat} placeholder={t.seatPlaceholder} value={view.seat} onChange={(e) => patch({ seat: e.target.value })} />
          <SelectField label={t.kind} value={view.kind} options={kindOptions} onChange={(e) => patch({ kind: e.target.value as HistoryView['kind'] })} />
          <SelectField label={t.verb} value={view.verb} options={verbOptions} onChange={(e) => patch({ verb: e.target.value as HistoryView['verb'] })} />
          <Field
            label={t.lrNo}
            placeholder={t.numberPlaceholder}
            title={t.numberTitle}
            value={view.lr}
            error={bad(view.lr) ? t.numberBad : undefined}
            onChange={(e) => patch({ lr: e.target.value })}
          />
          <Field
            label={t.challanNo}
            placeholder={t.numberPlaceholder}
            title={t.numberTitle}
            value={view.challan}
            error={bad(view.challan) ? t.numberBad : undefined}
            onChange={(e) => patch({ challan: e.target.value })}
          />
        </div>
      </Card>

      <Card className={styles.listCard}>
        <div className={styles.tableBox}>
          <Table
            label={t.tableLabel}
            columns={columns}
            rows={current.rows}
            rowKey={(r) => String(r.id)}
            ticked={shown === null ? undefined : new Set([String(shown)])}
            empty={answered || query === null ? (filtered ? t.emptyFiltered : t.empty) : ''}
            keyboardScroll
            onRowActivate={toggle}
            onRowAlt={open}
          />
        </div>
        <div className={styles.foot}>
          {current.next && (
            <Button small variant="outline" onClick={() => setLoaded({ key: answerKey, pages: pages + 1 })}>
              {t.loadMore}
            </Button>
          )}
          <span className={styles.hint}>{t.hint}</span>
        </div>
      </Card>

      {row && (
        <Card className={styles.details}>
          <div className={styles.detailHead}>
            <strong className={styles.detailTitle}>{sentence(row, t)}</strong>
            <span className={styles.detailBy}>{t.details.by(row.seat, t.when(row.at))}</span>
            {openLabel(row, t) && (
              <Button small variant="outline" onClick={() => open(row)}>
                {openLabel(row, t)}
              </Button>
            )}
            <Button small variant="ghost" onClick={() => setShown(null)}>
              {t.details.close}
            </Button>
          </div>
          {row.changes.length === 0 ? (
            <p className={styles.none}>{t.details.noChanges}</p>
          ) : (
            <ul className={styles.changes} aria-label={t.details.title}>
              {row.changes.map((c) => (
                <li key={c.field}>{changeLine(c, t)}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

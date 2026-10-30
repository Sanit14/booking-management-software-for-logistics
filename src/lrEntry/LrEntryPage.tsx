import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ChangeTable, KeeperResult, LrDay, LrDefaults, LrDetail, LrListRow, MastersAll } from '../../shared';
import { clearDraft, loadDraft } from '../logic/drafts';
import { matches } from '../logic/keymap';
import { isoToDisplay } from '../logic/lrOpen';
import { formatPaise } from '../logic/rupees';
import type { Jump } from '../logic/searchResults';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Chip from '../ui/Chip';
import Dialog from '../ui/Dialog';
import fieldStyles from '../ui/Field.module.css';
import Table, { type Column } from '../ui/Table';
import { useToast } from '../ui/Toast';
import { useKeeperData } from '../useKeeperData';
import { useKeys } from '../useKeys';
import LrForm from './LrForm';
import styles from './LrEntryPage.module.css';

const t = strings.lr;
export const NONE: MastersAll = { stations: [], firms: [], trucks: [], drivers: [] };
export const MASTER_TABLES: ChangeTable[] = ['stations', 'firms', 'trucks', 'drivers'];
const money = (paise: number) => (paise > 0 ? formatPaise(paise) : t.none);
const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);

const columns: Column<LrListRow>[] = [
  { key: 'lr', header: t.columns.lr, width: 70, num: true, render: (r) => r.lrNo },
  { key: 'consignor', header: t.columns.consignor, render: (r) => text(r.consignor) },
  { key: 'consignee', header: t.columns.consignee, render: (r) => text(r.consignee) },
  { key: 'to', header: t.columns.to, width: 110, render: (r) => text(r.toStation) },
  { key: 'qty', header: t.columns.qty, width: 62, num: true, render: (r) => r.qty },
  { key: 'toPay', header: t.columns.toPay, width: 92, num: true, render: (r) => money(r.toPayPaise) },
  { key: 'paid', header: t.columns.paid, width: 92, num: true, render: (r) => money(r.paidPaise) },
  { key: 'status', header: t.columns.status, width: 112, render: (r) => <Chip kind={r.status} /> },
];

/**
 * LR Entry: the form on top, the day's LRs under it. Both refresh by themselves: the keeper announces every committed
 * LR and master, from this seat or any other, and only the parts that changed are fetched again. Choosing an LR in the
 * list (or typing its number) opens it in the form, read-only until Edit.
 */
export default function LrEntryPage({ onEditing, jump, onJumpUsed }: { onEditing: (editing: boolean) => void; jump: Jump | null; onJumpUsed: () => void }) {
  const toast = useToast();
  const { keys } = useKeys();
  const findBox = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState<string | null>(null); // null = today; another date was unlocked with the System PIN
  const [viewDate, setViewDate] = useState<string | null>(null); // the list shows this day (looking needs no PIN); null = follow `date`
  const [openId, setOpenId] = useState<number | null>(null); // the saved LR in the form; null = a new LR
  const [pushed, setPushed] = useState<LrDetail | null>(null); // the LR as a change or a click just answered, until the refetch catches up
  const [findNo, setFindNo] = useState('');
  const holding = useRef(false); // the form holds work that opening another LR would throw away
  const [ask, setAsk] = useState<{ run: () => void } | null>(null);
  const listDate = viewDate ?? date;

  const masters = useKeeperData(() => window.bm.keeper.masters.all(), MASTER_TABLES, NONE);
  const defaults = useKeeperData<LrDefaults | null>(() => window.bm.keeper.lrs.defaults(date), ['settings', 'lrs'], null, [date]);
  // The rows carry the To station's name, so a renamed station refreshes the list too.
  const day = useKeeperData<LrDay | null>(() => window.bm.keeper.lrs.byDate(listDate), ['lrs', 'stations'], null, [listDate]);
  const fresh = useKeeperData<LrDetail | null>(
    () => (openId === null ? Promise.resolve({ ok: true as const, value: null }) : window.bm.keeper.lrs.get(openId)),
    ['lrs'],
    null,
    [openId],
  );
  // The newest of what the keeper last said and what our own click or save just got back.
  const lr = openId === null ? null : fresh.data?.id === openId && (!pushed || fresh.data.version >= pushed.version) ? fresh.data : pushed?.id === openId ? pushed : null;
  const totals = day.data?.totals;

  // The seat's "find an LR" key puts the cursor in the LR-no. box (not while a dialog is open).
  const findKey = useRef(keys.focusLrSearch);
  useEffect(() => {
    findKey.current = keys.focusLrSearch;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.repeat || document.querySelector('dialog[open]') || !matches(findKey.current, e)) return;
      e.preventDefault();
      findBox.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onOpen = (next: LrDetail | null) => {
    clearDraft('lrEntry'); // another LR, or New LR, replaces the half-typed one (the page asked first)
    setPushed(next);
    setOpenId(next?.id ?? null);
  };
  /** Shows the LR a read answered with; true when it did. */
  const open = async (read: Promise<KeeperResult<LrDetail>>, notFound?: string): Promise<boolean> => {
    const r = await read;
    if (r.ok) onOpen(r.value);
    else if (r.code === 'lr-missing' && notFound) toast.warning(notFound);
    else toast.error(strings.result(r.code, r.detail));
    return r.ok;
  };
  // Opening another LR throws away what the form holds (an edit, a half-typed new LR, or a draft the form has not
  // mounted to report yet): ask first.
  const guarded = (action: () => void) => (holding.current || loadDraft('lrEntry') !== undefined ? setAsk({ run: action }) : action());
  // A pick from the search box opens that LR (by id: it may be last year's), asking first like a click on a row.
  const showPicked = (id: number) => guarded(() => void open(window.bm.keeper.lrs.get(id)));
  const picked = useRef({ used: onJumpUsed, show: showPicked });
  useEffect(() => {
    picked.current = { used: onJumpUsed, show: showPicked };
  });
  useEffect(() => {
    if (jump?.to !== 'lr') return;
    picked.current.used();
    picked.current.show(jump.id);
  }, [jump]);
  const openFound = () => {
    const no = Number(findNo);
    if (!Number.isInteger(no) || no < 1) return;
    guarded(() => void open(window.bm.keeper.lrs.find(no), t.notFound(no)).then((found) => found && setFindNo('')));
  };
  const cancelledRows = useMemo(() => new Set((day.data?.rows ?? []).filter((r) => r.status === 'cancelled').map((r) => String(r.id))), [day.data]);
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    openFound();
  };

  return (
    <>
      <div className={styles.page}>
        {defaults.data && masters.loaded ? (
          <LrForm
            key={lr ? lr.id : 'new'}
            stations={masters.data.stations}
            firms={masters.data.firms}
            defaults={defaults.data}
            date={date}
            onDate={setDate}
            lr={lr ?? undefined}
            onOpen={onOpen}
            draftSlot="lrEntry"
            onGuard={(h) => {
              holding.current = h;
              onEditing(h && lr !== null); // an opened LR that holds work is being edited; a typed new LR is kept as a draft instead
            }}
          />
        ) : null}
        <Card
          className={styles.listCard}
          title={day.data ? t.listTitle(listDate === null, isoToDisplay(day.data.date)) : t.listTitle(true, '')}
          aside={
            <span className={styles.listAside}>
              <Chip kind="booked" count={totals?.booked ?? 0} />
              <Chip kind="loaded" count={totals?.loaded ?? 0} />
              <span className={styles.listTools}>
                <input
                  type="date"
                  className={`${fieldStyles.box} ${styles.listDate}`}
                  aria-label={t.viewDay}
                  title={t.viewDay}
                  max={defaults.data?.today}
                  value={listDate ?? defaults.data?.today ?? ''}
                  onChange={(e) => setViewDate(e.target.value === '' || e.target.value === defaults.data?.today ? null : e.target.value)}
                />
                <Button small variant="outline" onClick={() => setViewDate(null)} disabled={viewDate === null}>
                  {t.today}
                </Button>
                <input
                  ref={findBox}
                  className={`${fieldStyles.box} ${styles.listNo}`}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={t.findLabel}
                  title={t.findLabel}
                  placeholder={t.findPlaceholder}
                  value={findNo}
                  onChange={(e) => setFindNo(e.target.value.replace(/\D/g, '').slice(0, 7))}
                  onKeyDown={onFindKey}
                />
              </span>
            </span>
          }
        >
          <div className={styles.tableBox}>
            <Table
              label={t.listLabel}
              columns={columns}
              rows={day.data?.rows ?? []}
              rowKey={(r) => String(r.id)}
              empty={t.empty}
              ticked={lr ? new Set([String(lr.id)]) : undefined}
              dimmed={cancelledRows}
              onRowActivate={(r) => guarded(() => void open(window.bm.keeper.lrs.get(r.id)))}
            />
          </div>
          <div className={styles.totalsStrip}>
            <span>
              {t.totals.lrs} <strong>{totals?.count ?? 0}</strong>
            </span>
            <span>
              {t.totals.qty} <strong>{totals?.qty ?? 0}</strong>
            </span>
            <span>
              {t.totals.toPay} <strong>{formatPaise(totals?.toPayPaise ?? 0)}</strong>
            </span>
            <span>
              {t.totals.paid} <strong>{formatPaise(totals?.paidPaise ?? 0)}</strong>
            </span>
          </div>
        </Card>
      </div>
      <Dialog
        open={ask !== null}
        title={t.discardTitle}
        cancelLabel={t.keepWorking}
        confirmLabel={t.discardAndOpen}
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          ask?.run();
          setAsk(null);
        }}
      >
        <p>{t.discardText}</p>
      </Dialog>
    </>
  );
}

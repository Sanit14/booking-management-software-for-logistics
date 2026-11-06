import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, RotateCcw, Undo2, UserCog } from 'lucide-react';
import {
  MAX_WASULI_BATCH,
  type AgentStat,
  type KeeperResult,
  type WasuliCollectInput,
  type WasuliCursor,
  type WasuliFilters,
  type WasuliPage as Page,
  type WasuliPeriod,
  type WasuliRow,
  type WasuliStatus,
} from '../../shared';
import { isoToDisplay } from '../logic/lrOpen';
import type { Jump } from '../logic/searchResults';
import { tickAll, toggle, untick, type Box, type Ticks } from '../logic/memoPick';
import { agentChoice, quickOutcome, seenOf } from '../logic/wasuliFlow';
import { rupees } from '../loadingMemo/columns';
import { NONE } from '../lrEntry/LrEntryPage';
import { strings } from '../strings';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import Dialog from '../ui/Dialog';
import Field from '../ui/Field';
import KeyCap from '../ui/KeyCap';
import PinDialog from '../ui/PinDialog';
import Table, { type Column } from '../ui/Table';
import { useToast } from '../ui/Toast';
import TypeAhead, { type Option } from '../ui/TypeAhead';
import { useKeeperData } from '../useKeeperData';
import CollectDialog, { type CollectErrors } from './CollectDialog';
import styles from './WasuliPage.module.css';

const t = strings.wasuli;
const memo = strings.memo;
const NO_PAGE: Page = { rows: [], next: null, count: 0, amountPaise: 0, counts: { unassigned: 0, assigned: 0, collected: 0 } };
const TABS: WasuliStatus[] = ['unassigned', 'assigned', 'collected'];
const PERIODS: WasuliPeriod[] = ['week', 'month'];
const noBox: Box = { text: '', id: null };
const noop = () => undefined;
type Fail = Extract<KeeperResult<unknown>, { ok: false }>;

const text = (value: string) => (
  <span className={styles.cell} title={value}>
    {value}
  </span>
);
const waiting = (days: number) => <span className={days >= 7 ? styles.late : days >= 4 ? styles.warn : undefined}>{t.days(days)}</span>;

/**
 * Wasuli: the collections of LRs that carry a wasuli amount. Unassigned ones are ticked and handed to an agent; an assigned one
 * is collected (amount, how, remark), reassigned or sent back to the pool; a collected one can get its remark edited or be undone
 * (System PIN). The keeper decides everything and compares each row with what this screen saw, so a row another seat moved
 * first is refused and named; this only draws, asks and says what came back. No polling: the keeper pushes changes.
 */
export default function WasuliPage({ jump, onJumpUsed }: { jump: Jump | null; onJumpUsed: () => void }) {
  const toast = useToast();
  const masters = useKeeperData(() => window.bm.keeper.masters.all(), ['agents'], NONE);
  const [box, setBox] = useState<Box | null>(null); // null = the first active agent, until the clerk touches the box
  const [tab, setTab] = useState<WasuliStatus>('assigned');
  const [period, setPeriod] = useState<WasuliPeriod>('week');
  const [ticks, setTicks] = useState<Ticks>(new Set());
  const [quick, setQuick] = useState('');
  const [collecting, setCollecting] = useState<WasuliRow | null>(null);
  const [reassigning, setReassigning] = useState<{ row: WasuliRow; box: Box } | null>(null);
  const [pooling, setPooling] = useState<WasuliRow | null>(null);
  const [undoing, setUndoing] = useState<WasuliRow | null>(null);
  const [remarking, setRemarking] = useState<{ row: WasuliRow; text: string; step: 'text' | 'pin' } | null>(null);
  const [remarkError, setRemarkError] = useState<string | undefined>();
  const busy = useRef(new Set<string>());
  const [found, setFound] = useState<{ id: number; tab: WasuliStatus } | null>(null); // the row a History row led to

  // A History row: the list that LR's collection is in (its tab, its agent) with the row marked, and a line saying where it is.
  const take = useRef(() => {});
  useEffect(() => {
    take.current = () => {
      if (jump?.to !== 'wasuli') return;
      onJumpUsed();
      void window.bm.keeper.wasuli.find(jump.no, jump.year).then((r) => {
        if (!r.ok) return void toast.error(strings.result(r.code, r.detail));
        setTab(r.value.status);
        if (r.value.agentId !== null && r.value.agent) setBox({ text: r.value.agent, id: r.value.agentId });
        setTicks(new Set());
        setFound({ id: r.value.id, tab: r.value.status });
        toast.info(t.found(r.value.lrNo, t.tabs[r.value.status], r.value.agent));
      });
    };
  });
  useEffect(() => {
    if (jump?.to === 'wasuli') take.current();
  }, [jump]);

  const agents = useMemo(() => masters.data.agents.filter((a) => a.active), [masters.data.agents]);
  const agent = agentChoice(box, agents);
  const agentId = agent?.id ?? null;

  const filters: WasuliFilters = { tab, agentId, period };
  const filtersKey = JSON.stringify(filters);
  // "Load more" asks for one more page; changing a filter starts again from the first.
  const [loaded, setLoaded] = useState({ key: '', pages: 1 });
  const pages = loaded.key === filtersKey ? loaded.pages : 1;
  const list = useKeeperData<Page>(
    async () => {
      let cursor: WasuliCursor | null = null;
      const rows: WasuliRow[] = [];
      let last = NO_PAGE;
      for (let i = 0; i < pages; i++) {
        const r = await window.bm.keeper.wasuli.list(filters, cursor);
        if (!r.ok) return r;
        last = r.value;
        rows.push(...r.value.rows);
        cursor = r.value.next;
        if (!cursor) break;
      }
      return { ok: true as const, value: { ...last, rows } };
    },
    ['wasuli', 'agents', 'lrs', 'memos'], // a row also shows its LR's consignee and To and its challan
    NO_PAGE,
    [filtersKey, pages],
  );
  const stats = useKeeperData<AgentStat[]>(() => window.bm.keeper.wasuli.agentStats(period), ['wasuli', 'agents'], [], [period]);
  const { rows, next, count, amountPaise, counts } = list.data;
  const stat = stats.data.find((s) => s.agentId === agentId);

  const options = useMemo<Option[]>(
    () => agents.map((a) => ({ id: String(a.id), label: a.name, hint: t.agentHint(stats.data.find((s) => s.agentId === a.id)?.assignedCount ?? 0) })),
    [agents, stats.data],
  );
  const refresh = () => {
    list.reload();
    stats.reload();
  };
  /** A change that did not go through: a row another seat moved first is named; the lists are refetched since no event came. */
  const refused = (r: Fail) => {
    if (r.code === 'wasuli-stale') {
      toast.warning(t.moved(r.wasuli ?? []));
      refresh();
    } else toast.error(strings.result(r.code, r.detail));
  };
  /** Two presses on one thing before the first answers (a lagging seat replaying its clicks) make one request, not two. */
  const once = async <T,>(key: string, fn: () => Promise<T>, dropped: T): Promise<T> => {
    if (busy.current.has(key)) return dropped;
    busy.current.add(key);
    try {
      return await fn();
    } finally {
      busy.current.delete(key);
    }
  };

  // ---- Unassigned: tick, assign ----
  const chosen = tab === 'unassigned' ? rows.filter((r) => ticks.has(r.id)) : [];
  const assign = () =>
    once('assign', async () => {
      if (!agent || chosen.length === 0) return;
      if (chosen.length > MAX_WASULI_BATCH) return void toast.error(t.tooMany(MAX_WASULI_BATCH));
      const r = await window.bm.keeper.wasuli.assign(chosen.map(seenOf), agent.id);
      if (r.ok) {
        toast.success(t.assigned(r.value.rows.length, agent.name));
        setTicks(new Set());
      } else {
        if (r.code === 'wasuli-stale') setTicks((now) => untick(now, (r.wasuli ?? []).map((x) => x.id)));
        refused(r);
      }
    }, undefined);
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tab !== 'unassigned' || !(e.ctrlKey || e.metaKey) || e.code !== 'KeyA') return;
    e.preventDefault();
    setTicks((now) => (e.shiftKey ? new Set() : tickAll(now, rows.map((r) => r.id))));
  };

  // ---- Assigned: collect, reassign, back to the pool ----
  const collect = (row: WasuliRow, input: WasuliCollectInput): Promise<CollectErrors | null> =>
    once(
      `row:${row.id}`,
      async () => {
        const r = await window.bm.keeper.wasuli.collect(seenOf(row), input);
        if (r.ok) {
          toast.success(t.collected(row.lrNo, rupees(r.value.rows[0].collectedPaise ?? 0)));
          setCollecting(null);
          return null;
        }
        if (r.code === 'wasuli-invalid') return r.wasuliFields ?? {}; // the dialog stays open with the boxes marked
        setCollecting(null);
        refused(r);
        return null;
      },
      null,
    );
  const reassign = () =>
    once(
      `row:${reassigning?.row.id}`,
      async () => {
        if (!reassigning) return;
        const others = agents.filter((a) => a.id !== reassigning.row.agentId);
        const to = agentChoice(reassigning.box, others);
        if (!to) return void toast.error(t.fieldError.missing);
        const r = await window.bm.keeper.wasuli.reassign(seenOf(reassigning.row), to.id);
        setReassigning(null);
        if (r.ok) toast.success(t.reassigned(reassigning.row.lrNo, to.name));
        else refused(r);
      },
      undefined,
    );
  const toPool = () =>
    once(
      `row:${pooling?.id}`,
      async () => {
        if (!pooling) return;
        const r = await window.bm.keeper.wasuli.toPool(seenOf(pooling));
        setPooling(null);
        if (r.ok) toast.info(t.pooled(pooling.lrNo));
        else refused(r);
      },
      undefined,
    );

  // The LR number box: Enter opens the collect dialog at once when that LR is assigned to the agent picked.
  const quickCollect = () =>
    once(
      'quick',
      async () => {
        const typed = quick.trim();
        if (!/^\d+$/.test(typed) || Number(typed) < 1) return void toast.warning(t.quickBad);
        if (agentId === null) return void toast.warning(t.quickNeedAgent);
        const no = Number(typed);
        const r = await window.bm.keeper.wasuli.find(no);
        setQuick('');
        if (!r.ok) {
          if (r.code === 'wasuli-missing') return void toast.error(r.detail === 'no-lr' ? t.noLr(no) : t.noWasuli(no));
          return void toast.error(strings.result(r.code, r.detail));
        }
        const outcome = quickOutcome(r.value, agentId);
        if (outcome === 'collect') setCollecting(r.value);
        else toast.error(outcome === 'collected' ? t.alreadyCollected(no) : outcome === 'unassigned' ? t.notAssigned(no) : t.otherAgent(no, r.value.agent ?? ''));
      },
      undefined,
    );

  // ---- Collected: undo, remark (System PIN) ----
  const undo = async (pin: string): Promise<boolean> => {
    if (!undoing) return true;
    const r = await window.bm.keeper.wasuli.uncollect(seenOf(undoing), pin);
    if (r.ok) {
      toast.success(t.undone(undoing.lrNo));
      setUndoing(null);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    setUndoing(null);
    refused(r);
    return true;
  };
  const saveRemark = async (pin: string): Promise<boolean> => {
    if (!remarking) return true;
    const r = await window.bm.keeper.wasuli.remark(seenOf(remarking.row), remarking.text, pin);
    if (r.ok) {
      if (r.value.changed) toast.success(t.remarkSaved(remarking.row.lrNo));
      else toast.info(t.remarkSame);
      setRemarking(null);
      return true;
    }
    if (r.code === 'wrong-pin') return false;
    if (r.code === 'wasuli-invalid') {
      setRemarkError(t.fieldError.long);
      setRemarking({ ...remarking, step: 'text' });
      return true;
    }
    setRemarking(null);
    refused(r);
    return true;
  };

  // ---- the table of the open tab ----
  const rowActions = (r: WasuliRow) =>
    tab === 'assigned' ? (
      <span className={styles.rowActions}>
        <Button small aria-label={t.collectLabel(r.lrNo)} title={t.collectLabel(r.lrNo)} onClick={() => setCollecting(r)}>
          {t.collect}
        </Button>
        <Button small variant="outline" className={styles.iconOnly} aria-label={t.reassignLabel(r.lrNo)} title={t.reassignLabel(r.lrNo)} onClick={() => setReassigning({ row: r, box: noBox })}>
          <UserCog size={18} aria-hidden="true" />
        </Button>
        <Button small variant="outline" className={styles.iconOnly} aria-label={t.toPoolLabel(r.lrNo)} title={t.toPoolLabel(r.lrNo)} onClick={() => setPooling(r)}>
          <Undo2 size={18} aria-hidden="true" />
        </Button>
      </span>
    ) : (
      <span className={styles.rowActions}>
        <Button small variant="outline" className={styles.iconOnly} aria-label={t.remarkLabel(r.lrNo)} title={t.remarkLabel(r.lrNo)} onClick={() => { setRemarkError(undefined); setRemarking({ row: r, text: r.remark, step: 'text' }); }}>
          <Pencil size={18} aria-hidden="true" />
        </Button>
        <Button small variant="outline" className={styles.iconOnly} aria-label={t.undoLabel(r.lrNo)} title={t.undoLabel(r.lrNo)} onClick={() => setUndoing(r)}>
          <RotateCcw size={18} aria-hidden="true" />
        </Button>
      </span>
    );
  const c = t.columns;
  const lr: Column<WasuliRow> = { key: 'lr', header: c.lr, width: 52, num: true, render: (r) => r.lrNo };
  const consignee: Column<WasuliRow> = { key: 'consignee', header: c.consignee, render: (r) => text(r.consignee) };
  const to: Column<WasuliRow> = { key: 'to', header: c.to, width: 84, render: (r) => text(r.toStation) };
  const challan: Column<WasuliRow> = { key: 'challan', header: c.challan, width: 68, num: true, render: (r) => r.challanNo ?? '' };
  const amount: Column<WasuliRow> = { key: 'amount', header: c.amount, width: 88, num: true, render: (r) => rupees(r.amountPaise) };
  const actions = (width: number): Column<WasuliRow> => ({ key: 'actions', header: c.actions, width, render: rowActions });
  const columns: Column<WasuliRow>[] =
    tab === 'unassigned'
      ? [
          { key: 'tick', header: c.tick, width: 40, render: (r) => <input type="checkbox" className={styles.tick} tabIndex={-1} checked={ticks.has(r.id)} onChange={noop} aria-label={t.tickLabel(r.lrNo)} /> },
          lr,
          { key: 'date', header: c.lrDate, width: 112, render: (r) => isoToDisplay(r.lrDate) },
          consignee,
          to,
          challan,
          amount,
          { key: 'days', header: c.days, width: 76, render: (r) => waiting(r.days) },
        ]
      : tab === 'assigned'
        ? [
            lr,
            { key: 'date', header: c.assigned, width: 112, render: (r) => isoToDisplay(r.assignedDate ?? '') },
            consignee,
            to,
            challan,
            amount,
            { key: 'days', header: c.days, width: 76, render: (r) => waiting(r.days) },
            actions(178),
          ]
        : [
            lr,
            { key: 'date', header: c.collectedOn, width: 112, render: (r) => isoToDisplay(r.collectedDate ?? '') },
            consignee,
            { key: 'mode', header: c.mode, width: 70, render: (r) => (r.mode ? t.mode[r.mode] : '') },
            {
              key: 'amount',
              header: c.collectedAmount,
              width: 112,
              num: true,
              render: (r) => (
                <>
                  {rupees(r.collectedPaise ?? 0)}
                  {r.collectedPaise !== r.amountPaise && <span className={styles.owed}>{t.owed(rupees(r.amountPaise))}</span>}
                </>
              ),
            },
            { key: 'remark', header: c.remark, width: 150, render: (r) => text(r.remark) },
            actions(96),
          ];
  const tickedKeys = useMemo(() => new Set([...ticks].map(String)), [ticks]);
  const marked = useMemo(
    () => new Set([...(tab === 'unassigned' ? tickedKeys : []), ...(found && found.tab === tab ? [String(found.id)] : [])]),
    [tab, tickedKeys, found],
  );
  const tickRow = (r: WasuliRow) => setTicks((now) => toggle(now, r.id));
  const emptyText = tab === 'unassigned' ? t.empty.unassigned : !agent ? t.noAgent : tab === 'assigned' ? t.empty.assigned(agent.name) : t.empty.collected(agent.name);

  return (
    <>
      <div className={styles.page}>
        <Card className={styles.filters}>
          <div className={styles.filterRow}>
            <TypeAhead
              className={styles.agentBox}
              label={t.agent}
              listLabel={t.agentList}
              placeholder={agents.length === 0 && masters.loaded ? t.noAgentsAtAll : t.agentPlaceholder}
              value={box === null ? (agent?.name ?? '') : box.text}
              options={options}
              onChange={(value) => setBox({ text: value, id: null })}
              onPick={(o) => setBox({ text: o.label, id: Number(o.id) })}
            />
            <Field
              className={styles.quickBox}
              label={t.quickLabel}
              placeholder={t.quickPlaceholder}
              inputMode="numeric"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void quickCollect();
              }}
            />
          </div>
          <p className={styles.agentLine}>
            {stat ? (
              t.agentLine(stat.assignedCount, rupees(stat.assignedPaise), stat.collectedTodayCount, rupees(stat.collectedTodayPaise))
            ) : (
              <>&nbsp;</>
            )}
          </p>
        </Card>

        <div className={styles.tabs} role="tablist" aria-label={t.tabsLabel}>
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === tab} className={styles.tab} onClick={() => setTab(k)}>
              {t.tabs[k]}
              <span className={styles.count}>{counts[k]}</span>
            </button>
          ))}
        </div>

        <Card className={styles.listCard}>
          {tab !== 'assigned' && (
            <div className={styles.toolbar}>
              {tab === 'unassigned' && (
                <>
                  <Button small disabled={!agent || chosen.length === 0} onClick={() => void assign()}>
                    {agent ? t.assignTo(agent.name) : t.assignPickAgent}
                  </Button>
                  <span className={styles.tickedTag}>{t.ticked(chosen.length)}</span>
                  <span className={styles.keyHint}>
                    <KeyCap>{memo.keySpace}</KeyCap>
                    {memo.keyTick}
                  </span>
                  <span className={styles.keyHint}>
                    <KeyCap>{memo.keyCtrlA}</KeyCap>
                    {memo.keyAll}
                  </span>
                </>
              )}
              {tab === 'collected' && (
                <span className={styles.periods} role="group" aria-label={t.periodLabel}>
                  {PERIODS.map((p) => (
                    <button key={p} type="button" className={styles.period} aria-pressed={p === period} onClick={() => setPeriod(p)}>
                      {t.period[p]}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
          <div className={styles.tableBox} style={tab === 'unassigned' ? { ['--row-h' as string]: '38px' } : undefined} onKeyDown={onListKey}>
            <Table
              label={t.listLabel[tab]}
              columns={columns}
              rows={rows}
              rowKey={(r) => String(r.id)}
              ticked={marked}
              empty={emptyText}
              onRowActivate={tab === 'unassigned' ? tickRow : undefined}
              onRowToggle={tab === 'unassigned' ? tickRow : undefined}
            />
          </div>
          <div className={styles.totals}>
            <span>{t.totals(rows.length, count, rupees(amountPaise))}</span>
            {next && (
              <Button small variant="outline" onClick={() => setLoaded({ key: filtersKey, pages: pages + 1 })}>
                {t.loadMore(count - rows.length)}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <CollectDialog row={collecting} onCancel={() => setCollecting(null)} onSubmit={(input) => (collecting ? collect(collecting, input) : Promise.resolve(null))} />

      <Dialog open={reassigning !== null} title={reassigning ? t.reassignTitle(reassigning.row.lrNo) : ''} onCancel={() => setReassigning(null)} onConfirm={() => void reassign()} confirmLabel={t.reassignConfirm}>
        {reassigning && (
          <div className={styles.dialogForm}>
            <TypeAhead
              data-autofocus=""
              label={t.newAgent}
              listLabel={t.agentList}
              placeholder={t.agentPlaceholder}
              value={reassigning.box.text}
              options={options.filter((o) => Number(o.id) !== reassigning.row.agentId)}
              onChange={(value) => setReassigning({ ...reassigning, box: { text: value, id: null } })}
              onPick={(o) => setReassigning({ ...reassigning, box: { text: o.label, id: Number(o.id) } })}
            />
          </div>
        )}
      </Dialog>

      <Dialog open={pooling !== null} danger title={t.poolTitle} confirmLabel={t.poolConfirm} onCancel={() => setPooling(null)} onConfirm={() => void toPool()}>
        {pooling && <p>{t.poolText(pooling.lrNo, pooling.consignee)}</p>}
      </Dialog>

      <PinDialog open={undoing !== null} title={t.undoTitle} onCancel={() => setUndoing(null)} onSubmit={undo} />

      <Dialog
        open={remarking?.step === 'text'}
        title={remarking ? t.remarkTitle(remarking.row.lrNo) : ''}
        confirmLabel={t.remarkConfirm}
        onCancel={() => setRemarking(null)}
        onConfirm={() => remarking && setRemarking({ ...remarking, step: 'pin' })}
      >
        {remarking && (
          <div className={styles.dialogForm}>
            <Field
              data-autofocus=""
              label={t.remarkField}
              hint={t.remarkHint}
              error={remarkError}
              value={remarking.text}
              onChange={(e) => {
                setRemarkError(undefined);
                setRemarking({ ...remarking, text: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                setRemarking({ ...remarking, step: 'pin' });
              }}
            />
          </div>
        )}
      </Dialog>
      <PinDialog open={remarking?.step === 'pin'} title={t.remarkSavePin} onCancel={() => setRemarking(null)} onSubmit={saveRemark} />
    </>
  );
}

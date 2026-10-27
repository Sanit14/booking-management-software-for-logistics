import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ClipboardList, Package, Plus, Truck } from 'lucide-react';
import styles from './ComponentsPage.module.css';
import { strings } from './strings';
import Button, { type ButtonVariant } from './ui/Button';
import { Card, PageHeader, StatCard } from './ui/Card';
import Chip, { type ChipKind } from './ui/Chip';
import Dialog from './ui/Dialog';
import Field from './ui/Field';
import KeyCap from './ui/KeyCap';
import PinDialog from './ui/PinDialog';
import Table, { type Column } from './ui/Table';
import { useToast } from './ui/Toast';
import TypeAhead from './ui/TypeAhead';
import { useEnterToNext } from './ui/useEnterToNext';

const t = strings.components;

// Made-up sample data, only for showing the components. Real data always comes from the keeper.
const firms = [
  { id: '1', label: 'Shree Ganesh Traders', hint: 'Yavatmal' },
  { id: '2', label: 'Shree Ganesh Agencies', hint: 'Wani' },
  { id: '3', label: 'Patil Hardware', hint: 'Yavatmal' },
  { id: '4', label: 'Sai Kirana', hint: 'Wani' },
  { id: '5', label: 'Om Stores', hint: 'Nagpur' },
];

interface Lr {
  lr: number;
  consignor: string;
  to: string;
  qty: number;
  toPay: string;
  status: ChipKind;
}
const lrs: Lr[] = [
  { lr: 1247, consignor: 'Sai Kirana', to: 'Wani', qty: 12, toPay: '1,800', status: 'booked' },
  { lr: 1246, consignor: 'Patil Hardware', to: 'Nagpur', qty: 4, toPay: '950', status: 'booked' },
  { lr: 1245, consignor: 'Shree Ganesh Traders', to: 'Nagpur', qty: 20, toPay: '3,200', status: 'loaded' },
  { lr: 1244, consignor: 'Mahalaxmi Oil', to: 'Amravati', qty: 8, toPay: '1,100', status: 'cancelled' },
  { lr: 1243, consignor: 'Walk-in: R. Deshmukh', to: 'Amravati', qty: 2, toPay: '400', status: 'loaded' },
];
const manyLrs: Lr[] = Array.from({ length: 14 }, (_, i) => ({ ...lrs[i % lrs.length], lr: 1300 - i }));

const kinds: ChipKind[] = ['booked', 'loaded', 'cancelled', 'toPay', 'paid', 'charges', 'pending', 'saved'];
const variants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'danger'];

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.frame} aria-label={title}>
      <h2 className={styles.frameTitle}>{title}</h2>
      {children}
    </section>
  );
}

export default function ComponentsPage({ onBack }: { onBack?: () => void }) {
  const toast = useToast();
  const enterToNext = useEnterToNext();
  const [firm, setFirm] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(['1245']));
  const [confirm, setConfirm] = useState<'normal' | 'danger' | null>(null);
  const [pin, setPin] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    toast.success(t.formSubmitted);
  };

  const columns: Column<Lr>[] = [
    {
      key: 'tick',
      header: '',
      width: 44,
      render: (r) => (
        <input
          type="checkbox"
          className={styles.check}
          aria-label={t.tickLr(r.lr)}
          checked={ticked.has(String(r.lr))}
          onChange={(e) =>
            setTicked((prev) => {
              const next = new Set(prev);
              if (e.target.checked) next.add(String(r.lr));
              else next.delete(String(r.lr));
              return next;
            })
          }
        />
      ),
    },
    { key: 'lr', header: t.cols.lr, num: true, width: 80, render: (r) => <strong>{r.lr}</strong> },
    { key: 'consignor', header: t.cols.consignor, render: (r) => r.consignor },
    { key: 'to', header: t.cols.to, width: 110, render: (r) => r.to },
    { key: 'qty', header: t.cols.qty, num: true, width: 70, render: (r) => r.qty },
    { key: 'toPay', header: t.cols.toPay, num: true, width: 110, render: (r) => r.toPay },
    { key: 'status', header: t.cols.status, width: 140, render: (r) => <Chip kind={r.status} /> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          onBack && (
            <Button variant="outline" small icon={<ArrowLeft size={18} aria-hidden="true" />} onClick={onBack}>
              {t.back}
            </Button>
          )
        }
      />

      <Frame title={t.buttons}>
        <div className={styles.row}>
          {variants.map((v) => (
            <Button key={v} variant={v}>
              {t.variant[v]}
            </Button>
          ))}
        </div>
        <div className={styles.row}>
          {variants.map((v) => (
            <Button key={v} variant={v} small>
              {t.variant[v]}
            </Button>
          ))}
        </div>
        <div className={styles.row}>
          <Button icon={<Plus size={18} strokeWidth={2.4} aria-hidden="true" />}>{strings.quickLr}</Button>
          <Button keyCap="F4">{t.saveLr}</Button>
          <Button variant="secondary" keyCap="Ctrl+L">
            {t.variant.secondary}
          </Button>
          <Button variant="outline" keyCap="Esc">
            {t.variant.outline}
          </Button>
          <Button disabled>{t.disabled}</Button>
          <Button variant="outline" disabled>
            {t.disabled}
          </Button>
        </div>
        <div className={styles.row}>
          <span>{t.keyCaps}</span>
          <KeyCap>F4</KeyCap>
          <KeyCap>Ctrl+K</KeyCap>
          <KeyCap>Shift+Tab</KeyCap>
          <span className={styles.onTeal}>
            <KeyCap onColor>Enter</KeyCap>
          </span>
        </div>
      </Frame>

      <Frame title={t.fields}>
        <form className={styles.form} onKeyDown={enterToNext} onSubmit={submit} aria-label={t.fields}>
          <div className={styles.grid4}>
            <Field label={t.f.plain} placeholder={t.f.placeholder} />
            <Field label={t.f.required} required hint={t.f.hint} />
            <Field label={t.f.error} required defaultValue="12x" error={t.f.errorText} />
            <Field label={t.f.readOnly} readOnly defaultValue="1248" />
            <Field label={t.f.money} money defaultValue="1,800" />
            <Field label={t.f.moneyEmpty} money placeholder="0" />
            <Field label={t.f.disabled} disabled defaultValue="—" />
            <Field label={t.f.last} placeholder={t.f.lastHint} hint={t.f.lastHint} />
          </div>
          <div className={styles.row}>
            <Button type="submit" keyCap="F4">
              {t.saveLr}
            </Button>
            <span className={styles.note}>{t.enterNote}</span>
          </div>
        </form>
      </Frame>

      <Frame title={t.typeAhead}>
        <form className={styles.form} onKeyDown={enterToNext} onSubmit={(e) => e.preventDefault()} aria-label={t.typeAhead}>
          <div className={styles.grid2}>
            <TypeAhead
              label={t.f.firm}
              placeholder={t.f.firmPlaceholder}
              value={firm}
              onChange={(v) => {
                setFirm(v);
                setPicked(null);
              }}
              onPick={(o) => setPicked(o.id)}
              options={firms}
              walkInLabel={t.walkIn}
              listLabel={t.f.firm}
              hint={t.typeAheadKeys}
            />
            <Field label={t.f.next} placeholder={t.f.nextHint} />
          </div>
          <p className={styles.note} role="status">
            {picked ? t.pickedMaster(firm) : firm ? t.typedOnly(firm) : t.nothingTyped}
          </p>
        </form>
      </Frame>

      <Frame title={t.chipsCards}>
        <div className={styles.row}>
          {kinds.map((k) => (
            <Chip key={k} kind={k} />
          ))}
        </div>
        <div className={styles.row}>
          <Chip kind="booked" count={3} />
          <Chip kind="loaded" count={2} />
        </div>
        <div className={styles.stats}>
          <StatCard
            icon={<ClipboardList size={18} aria-hidden="true" />}
            tag={<Chip kind="saved" />}
            value={42}
            label={t.stat.lrs}
            lines={[
              [t.statLines.booked, 17],
              [t.statLines.loaded, 25],
            ]}
          />
          <StatCard
            tone="orange"
            icon={<Package size={18} aria-hidden="true" />}
            value={17}
            label={t.stat.pending}
            lines={[
              [t.statLines.stations, 3],
              [t.statLines.oldest, '20-10'],
            ]}
          />
          <StatCard icon={<Truck size={18} aria-hidden="true" />} value={3} label={t.stat.trucks} lines={[[t.statLines.memos, 3]]} />
          <Card title={t.cardTitle} aside={<Chip kind="pending" />}>
            <p className={styles.cardBody}>{t.cardBody}</p>
          </Card>
        </div>
        <PageHeader
          title={t.header.title}
          subtitle={t.header.subtitle}
          actions={
            <>
              <Button keyCap="Ctrl+L">{strings.quickLr}</Button>
              <Button variant="outline" small>
                {t.variant.outline}
              </Button>
            </>
          }
        />
      </Frame>

      <Frame title={t.tables}>
        <Table
          label={t.tables}
          columns={columns}
          rows={lrs}
          rowKey={(r) => String(r.lr)}
          ticked={ticked}
          totals={{ lr: t.totals.lrs(lrs.length), qty: 46, toPay: t.totals.toPay }}
          empty={t.empty}
        />
        <div className={styles.twoTables}>
          <Table label={t.scrollBox} columns={columns.slice(1, 5)} rows={manyLrs} rowKey={(r) => String(r.lr)} empty={t.empty} maxHeight={170} />
          <Table label={t.emptyTable} columns={columns.slice(1, 5)} rows={[]} rowKey={(r) => String(r.lr)} empty={t.empty} />
        </div>
      </Frame>

      <Frame title={t.feedback}>
        <div className={styles.row}>
          <Button variant="outline" onClick={() => toast.success(t.toast.success, t.toast.detail)}>
            {t.toast.success}
          </Button>
          <Button variant="outline" onClick={() => toast.info(t.toast.info)}>
            {t.toast.info}
          </Button>
          <Button variant="outline" onClick={() => toast.warning(t.toast.warning, t.toast.detail)}>
            {t.toast.warning}
          </Button>
          <Button variant="outline" onClick={() => toast.error(t.toast.error, t.toast.detail)}>
            {t.toast.error}
          </Button>
        </div>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setConfirm('normal')}>
            {t.openConfirm}
          </Button>
          <Button variant="danger" onClick={() => setConfirm('danger')}>
            {t.openDanger}
          </Button>
          <Button variant="secondary" onClick={() => setPin(true)}>
            {t.openPin}
          </Button>
        </div>
        <p className={styles.note}>{t.pinNote}</p>
      </Frame>

      <Dialog
        open={confirm !== null}
        title={confirm === 'danger' ? t.dialog.dangerTitle : t.dialog.title}
        danger={confirm === 'danger'}
        confirmLabel={confirm === 'danger' ? t.dialog.dangerConfirm : t.dialog.confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          toast.success(t.dialog.done);
        }}
      >
        {confirm === 'danger' ? t.dialog.dangerText : t.dialog.text}
      </Dialog>
      <PinDialog
        open={pin}
        title={t.pinTitle}
        onCancel={() => setPin(false)}
        onSubmit={(value) => {
          if (value !== '1234') return false; // demo only: the real check is a keeper call by the page that opens this
          setPin(false);
          toast.success(t.pinOk);
          return true;
        }}
      />
    </div>
  );
}

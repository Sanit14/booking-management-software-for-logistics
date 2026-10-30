import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { isoToDisplay } from '../logic/lrOpen';
import { flatten, move, type Jump, type Row } from '../logic/searchResults';
import { strings } from '../strings';
import Chip from '../ui/Chip';
import KeyCap from '../ui/KeyCap';
import { useToast } from '../ui/Toast';
import styles from './GlobalSearch.module.css';

const t = strings.search;
const WAIT_MS = 120; // after the last key, so a fast typist asks once

interface Props {
  onPick: (jump: Jump) => void;
  /** On the Dashboard: the results float over the page under the box, and Esc clears the box. In the Ctrl+K window they sit below it. */
  floating?: boolean;
  /** The seat's key for this box, shown at its right end. */
  keyCap?: string;
}

function RowText({ row }: { row: Row }) {
  switch (row.group) {
    case 'lr':
      return (
        <>
          <strong className={styles.main}>{t.lrNo(row.item.lrNo)}</strong>
          <span className={styles.detail}>
            {row.item.consignee} · {row.item.toStation} · {isoToDisplay(row.item.date)}
          </span>
          <Chip kind={row.item.status} />
        </>
      );
    case 'firm':
      return (
        <>
          <strong className={styles.main}>{row.item.name}</strong>
          <span className={styles.detail}>{row.item.station ?? ''}</span>
          {!row.item.active && <Chip kind="inactive" />}
        </>
      );
    case 'truck':
      return (
        <>
          <strong className={styles.main}>{row.item.number}</strong>
          <span className={styles.detail} />
          {!row.item.active && <Chip kind="inactive" />}
        </>
      );
    case 'station':
      return (
        <>
          <strong className={styles.main}>{row.item.name}</strong>
          <span className={styles.detail} />
          {!row.item.active && <Chip kind="inactive" />}
        </>
      );
  }
}

/**
 * One box for LR number, firm, truck and station. Asks the keeper 120 ms after the last key and shows only the newest
 * answer; ↑/↓ walk the results, Enter or a click picks. Enter before the answer is in picks the first result of what is
 * typed, so "type, Enter" works at any speed.
 */
export default function GlobalSearch({ onPick, floating, keyCap }: Props) {
  const toast = useToast();
  const listId = useId();
  const [text, setText] = useState('');
  const [shown, setShown] = useState<{ for: string; rows: Row[] } | null>(null);
  const [active, setActive] = useState(-1);
  const ticket = useRef(0);
  const alive = useRef(true); // the window may close while an answer is on its way
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const typed = text.trim();

  useEffect(() => {
    const mine = ++ticket.current; // an answer for anything older than this is never shown
    if (typed === '') return;
    const timer = setTimeout(() => {
      void window.bm.keeper.search(typed).then((r) => {
        if (mine !== ticket.current) return;
        if (r.ok) {
          const found = flatten(r.value);
          setShown({ for: typed, rows: found });
          setActive(found.length > 0 ? 0 : -1);
        } else toast.error(strings.result(r.code, r.detail));
      });
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [typed, toast]);

  const rows = useMemo(() => shown?.rows ?? [], [shown]);
  const current = shown !== null && shown.for === typed;
  // The highlighted row stays in view when the list is longer than its box.
  useEffect(() => {
    if (active >= 0 && rows[active]) document.getElementById(`${listId}-${rows[active].key}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, rows, listId]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(move(active, e.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (typed === '' || e.repeat) return; // a held Enter must not pick again
      if (current) {
        if (active >= 0) onPick(rows[active].jump);
      } else {
        // The answer on screen is for older text: ask for what is typed now and take its first result.
        ticket.current++;
        void window.bm.keeper.search(typed).then((r) => {
          if (!alive.current) return; // closed (Esc) before the answer came: nothing to open
          const first = r.ok ? flatten(r.value)[0] : undefined;
          if (first) onPick(first.jump);
          else if (!r.ok) toast.error(strings.result(r.code, r.detail));
        });
      }
    } else if (e.key === 'Escape' && floating && text !== '') {
      e.preventDefault();
      setText('');
    }
  };

  const open = typed !== '' && shown !== null;
  return (
    // On the Dashboard the results close when the focus leaves the box and its list.
    <div className={floating ? styles.floating : styles.root} onBlur={(e) => floating && !e.currentTarget.contains(e.relatedTarget) && setText('')}>
      <div className={styles.box}>
        <Search size={20} strokeWidth={2.2} aria-hidden="true" />
        <input
          className={styles.input}
          data-autofocus=""
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls={open && rows.length > 0 ? listId : undefined}
          aria-activedescendant={active >= 0 && rows[active] ? `${listId}-${rows[active].key}` : undefined}
          aria-autocomplete="list"
          aria-label={t.label}
          placeholder={t.placeholder}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {keyCap && <KeyCap>{keyCap}</KeyCap>}
      </div>
      {typed === '' && !floating && <p className={styles.note}>{t.hint}</p>}
      {open && (
        <div className={styles.panel}>
          {rows.length === 0 ? (
            current && (
              <p className={styles.note} role="status">
                {t.none(typed)}
              </p>
            )
          ) : (
            <ul id={listId} role="listbox" aria-label={t.resultsLabel} className={styles.list}>
              {rows.map((row, i) => (
                <li key={row.key} role="presentation">
                  {row.group !== rows[i - 1]?.group && <div className={styles.heading}>{t.groups[row.group]}</div>}
                  <div
                    id={`${listId}-${row.key}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? `${styles.option} ${styles.activeOption}` : styles.option}
                    onMouseDown={(e) => e.preventDefault()} // the box keeps the cursor
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => current && onPick(row.jump)} // rows of older text are not picked
                  >
                    <RowText row={row} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useId, useState, type KeyboardEvent } from 'react';
import type { MemoFilters, NameKey, PendingNames } from '../../shared';
import type { Side } from '../logic/memoPick';
import { strings } from '../strings';
import { Card } from '../ui/Card';
import Field from '../ui/Field';
import { useDebounced } from '../useDebounced';
import { useKeeperData } from '../useKeeperData';
import styles from './PendingPicker.module.css';

const t = strings.memo;
/** What the keeper answered, and the text it answered for. */
type Answer = PendingNames & { forText: string };
const NO_NAMES: Answer = { names: [], more: 0, forText: '' };

interface Props {
  side: Side;
  label: string;
  /** Every filter now: the keeper applies the others, and leaves this side's own picks out of the answer. */
  filters: MemoFilters;
  /** A name was clicked, or Enter was pressed on the highlighted one. */
  onPick: (name: NameKey) => void;
}

/**
 * A search box for the names that have pending LRs. Typing shows at most 5 (busiest first, with their counts) and "and N more · keep typing"; a click, or the
 * arrow keys and Enter, adds the name as a filter. The keeper does the search; nothing is kept here but the text.
 */
export default function NameSearch({ side, label, filters, onPick }: Props) {
  const list = useId();
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const typed = useDebounced(text.trim(), 120);
  const key = JSON.stringify(filters);
  const found = useKeeperData<Answer>(
    async () => {
      if (typed === '') return { ok: true as const, value: NO_NAMES };
      const r = await window.bm.keeper.memos.pendingNames(side, filters, typed);
      return r.ok ? { ok: true as const, value: { ...r.value, forText: typed } } : r;
    },
    ['lrs', 'memos'],
    NO_NAMES,
    [typed, key],
  ).data;
  const shown = text.trim() === '' ? NO_NAMES : found; // an emptied box shows nothing at once, not after the debounce
  const at = Math.min(hi, Math.max(0, shown.names.length - 1));

  const pick = (name: NameKey) => {
    onPick(name);
    setText('');
    setHi(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (shown.names.length === 0) return;
      e.preventDefault();
      setHi((at + (e.key === 'ArrowDown' ? 1 : shown.names.length - 1)) % shown.names.length);
    } else if (e.key === 'Enter' && shown.names.length > 0 && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // The list on screen may be the answer to the text before the last key: only an answer to what is typed now is picked from.
      if (found.forText === text.trim()) pick(shown.names[at]);
    } else if (e.key === 'Escape' && text !== '') {
      e.preventDefault();
      e.stopPropagation(); // clears the box; a second Esc leaves
      setText('');
    }
  };

  return (
    <Card className={styles.group}>
      <Field
        label={label}
        placeholder={t.typeName}
        role="combobox"
        aria-expanded={shown.names.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={shown.names.length > 0 ? `${list}-${at}` : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKey}
      />
      <ul id={list} className={styles.names} role="listbox" aria-label={label} hidden={shown.names.length === 0}>
        {shown.names.map((n, i) => (
          <li
            key={n.firmId !== null ? `f${n.firmId}` : `w${n.name}`}
            id={`${list}-${i}`}
            role="option"
            aria-selected={i === at}
            className={`${styles.name} ${i === at ? styles.nameOn : ''}`.trim()}
            onMouseDown={(e) => e.preventDefault()} // the box keeps its focus
            onClick={() => pick({ firmId: n.firmId, name: n.name })}
          >
            <span className={styles.stationName} title={n.name}>
              + {n.name}
            </span>
            <span className={styles.count}>{n.lrs}</span>
          </li>
        ))}
      </ul>
      {shown.more > 0 && <div className={styles.moreNote}>{t.andMore(shown.more)}</div>}
    </Card>
  );
}

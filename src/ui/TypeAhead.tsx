import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { strings } from '../strings';
import { UserPlus } from 'lucide-react';
import { buildRows, type Option } from '../logic/typeAhead';
import Field, { type FieldProps } from './Field';
import KeyCap from './KeyCap';
import styles from './TypeAhead.module.css';

export type { Option };

const LIMIT = 8; // rows shown at most

// onKeyDown, onBlur and role belong to the list behaviour and are not the caller's to replace.
interface Props extends Omit<FieldProps, 'value' | 'onChange' | 'children' | 'money' | 'onKeyDown' | 'onBlur' | 'role'> {
  value: string;
  /** Every keystroke, and also the typed text kept when nothing is picked. */
  onChange: (text: string) => void;
  onPick: (option: Option) => void;
  /** The caller's options (already limited by the keeper); this list only ranks and trims them. */
  options: Option[];
  /** Last row, e.g. "Walk-in — keep typing". Absent = no walk-in row. */
  walkInLabel?: string;
  listLabel: string;
}

/**
 * A text field with a list under it. ↑/↓ move, Enter picks, Esc closes (typed text stays).
 * Enter is not marked handled, so inside a form with useEnterToNext the same keypress moves to the next field.
 */
export default function TypeAhead({ value, onChange, onPick, options, walkInLabel, listLabel, ...field }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [index, setActive] = useState(0);
  // The list is drawn outside the field's card (a card clips what overflows it): in the open dialog if the field
  // is in one (a modal dialog covers everything else), else on the page. `anchor` has the input's box.
  const anchor = useRef<HTMLSpanElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  const anchorRef = useCallback((el: HTMLSpanElement | null) => {
    anchor.current = el;
    if (el) setHost(el.closest('dialog') ?? document.body);
  }, []);
  const rows = buildRows(options, value, LIMIT, walkInLabel !== undefined);
  const shown = open && rows.length > 0;
  const active = Math.min(index, rows.length - 1); // the caller's options can shrink while the list is open
  const rowId = (i: number) => `${id}-row-${i}`;

  // Under the input, or above it when there is no room below. Straight onto the element: no state, no extra render.
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      const el = list.current;
      if (!box || !el) return;
      const above = box.bottom + 4 + el.offsetHeight > window.innerHeight && box.top - 4 - el.offsetHeight > 0;
      el.style.top = `${above ? box.top - 4 - el.offsetHeight : box.bottom + 4}px`;
      el.style.left = `${box.left}px`;
      el.style.minWidth = `${box.width}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // any scrolling box around the field
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [shown, rows.length]);

  const pick = (i: number) => {
    const row = rows[i];
    if (row?.kind === 'option') {
      onChange(row.option.label);
      onPick(row.option);
    }
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // an IME is still composing: Enter/arrows belong to it
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown) {
        setOpen(true);
        setActive(0);
      } else {
        setActive(Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
      }
    } else if (e.key === 'Enter' && shown) {
      pick(active); // not preventDefault: see the note above
    } else if (e.key === 'Escape' && shown) {
      e.preventDefault();
      e.stopPropagation(); // closes the list, not the dialog around it
      setOpen(false);
    }
  };

  return (
    <Field
      {...field}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        setOpen(e.target.value.trim() !== ''); // emptied again = no list, so Enter moves on instead of picking the first option (↓ opens it)
        setActive(0);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => setOpen(false)}
      role="combobox"
      aria-expanded={shown}
      aria-controls={`${id}-list`}
      aria-autocomplete="list"
      aria-activedescendant={shown ? rowId(active) : undefined}
    >
      <span ref={anchorRef} className={styles.anchor} aria-hidden="true" />
      {shown && host && createPortal(
        <div ref={list} id={`${id}-list`} role="listbox" aria-label={listLabel} className={styles.list}>
          {rows.map((row, i) => (
            <div
              key={row.kind === 'option' ? row.option.id : 'walk-in'}
              id={rowId(i)}
              role="option"
              aria-selected={i === active}
              className={`${styles.row} ${i === active ? styles.active : ''} ${row.kind === 'walk-in' ? styles.walkIn : ''}`.trim()}
              // mousedown, not click: the input must not lose focus (blur would close the list first)
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
            >
              {row.kind === 'option' ? (
                <>
                  <span className={styles.name}>{row.option.label}</span>
                  {row.option.hint && <span className={styles.hint}>{row.option.hint}</span>}
                  {i === active && (
                    <span className={styles.key}>
                      <KeyCap>{strings.ui.enter}</KeyCap>
                    </span>
                  )}
                </>
              ) : (
                <>
                  <UserPlus size={18} aria-hidden="true" />
                  <span>{walkInLabel}</span>
                </>
              )}
            </div>
          ))}
        </div>,
        host,
      )}
    </Field>
  );
}

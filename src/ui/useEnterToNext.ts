import { useCallback, type KeyboardEvent } from 'react';
import { nextIndex, type FieldInfo } from '../logic/nextField';

const NOT_A_FIELD = new Set(['button', 'submit', 'reset', 'hidden']);

/**
 * Put the returned handler on a `<form onKeyDown>`: Enter in a field moves to the next usable field
 * (Shift+Tab already goes back natively). Enter on the last field, on a button or in a textarea is left alone,
 * so it does what the form's own button does. A TypeAhead that used Enter to pick leaves it unhandled on purpose,
 * so the same keypress also moves on.
 */
export function useEnterToNext() {
  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    const target = e.target;
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return; // modified Enter stays free for shortcuts
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || NOT_A_FIELD.has(target.type)) return;

    const fields = Array.from(
      e.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'),
    ).filter((el) => !NOT_A_FIELD.has(el.type));
    const info: FieldInfo[] = fields.map((el) => ({
      disabled: el.disabled,
      readOnly: !(el instanceof HTMLSelectElement) && el.readOnly,
      hidden: el.getClientRects().length === 0,
      tabIndex: el.tabIndex,
      skipEnter: el.hasAttribute('data-skip-enter'),
    }));
    const next = fields[nextIndex(info, fields.indexOf(target)) ?? -1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (!(next instanceof HTMLSelectElement)) next.select();
  }, []);
}

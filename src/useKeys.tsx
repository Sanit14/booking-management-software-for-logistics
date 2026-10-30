import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_KEYS, type Keymap } from './logic/keymap';

interface Api {
  /** This seat's keys. Every hint and every shortcut reads them from here, so a change applies at once. */
  keys: Keymap;
  /** Saves the new set for this seat; resolves with the keys now in force. */
  save: (next: Keymap) => Promise<Keymap>;
}

const KeysContext = createContext<Api | null>(null);

export function useKeys(): Api {
  const api = useContext(KeysContext);
  if (!api) throw new Error('useKeys needs a <KeysProvider>');
  return api;
}

/** Loads the seat's keys once at start (the defaults show until main answers). */
export function KeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Keymap>(DEFAULT_KEYS);
  useEffect(() => {
    if (!window.bm) return; // `npm run dev -- --components` in a plain browser has no preload
    void window.bm.keys.get().then(setKeys, () => undefined); // no answer: the defaults stay
  }, []);
  const save = useCallback(async (next: Keymap) => {
    const now = await window.bm.keys.set(next);
    setKeys(now);
    return now;
  }, []);
  const api = useMemo(() => ({ keys, save }), [keys, save]);
  return <KeysContext.Provider value={api}>{children}</KeysContext.Provider>;
}

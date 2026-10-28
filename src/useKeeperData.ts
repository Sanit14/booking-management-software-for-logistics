import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeTable, KeeperResult } from '../shared';
import { strings } from './strings';
import { useToast } from './ui/Toast';

/**
 * Loads from the keeper and keeps the answer fresh without polling: it fetches on mount (and when `deps` change), and
 * again only when the keeper announces a change to one of `tables` (any seat's write, this one's included). Only the
 * newest answer is used, so a slow earlier fetch can never overwrite a newer one.
 */
export function useKeeperData<T>(fetcher: () => Promise<KeeperResult<T>>, tables: readonly ChangeTable[], initial: T, deps: readonly unknown[] = []) {
  const toast = useToast();
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const asked = useRef(0);
  // The latest closures, without re-subscribing every render.
  const latest = useRef({ fetcher, tables });
  useEffect(() => {
    latest.current = { fetcher, tables };
  });

  const reload = useCallback(() => {
    const mine = ++asked.current;
    void latest.current.fetcher().then((r) => {
      if (mine !== asked.current) return; // a newer request was sent meanwhile
      if (r.ok) {
        setData(r.value);
        setLoaded(true);
      } else {
        toast.error(strings.result(r.code, r.detail));
      }
    });
  }, [toast]);

  useEffect(reload, [reload, ...deps]);
  useEffect(
    () =>
      window.bm.keeper.onChanged((change) => {
        if (change.tables.some((t) => latest.current.tables.includes(t))) reload();
      }),
    [reload],
  );

  return { data, loaded, reload };
}

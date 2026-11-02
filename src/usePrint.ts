import { useMemo } from 'react';
import type { PrintDone } from '../shared';
import { strings } from './strings';
import { useToast } from './ui/Toast';

/**
 * Print a saved memo or LR, or save it as a PDF, and say what happened. Main builds the page and opens the Windows print
 * dialog or the Save dialog; closing either is not an error and says nothing.
 */
export function usePrint() {
  const toast = useToast();
  return useMemo(() => {
    const report = (r: Awaited<ReturnType<typeof window.bm.print.memo>>, sent: string) => {
      if (r.ok) {
        if (r.value.file) toast.success(strings.print.pdfSaved, r.value.file);
        else toast.success(sent);
      } else if (r.code !== 'cancelled') toast.error(strings.result(r.code, r.detail));
    };
    // A call that rejects (main gone, no bridge) still says so: nobody waits on these promises.
    const run = async (call: () => ReturnType<typeof window.bm.print.memo>, sent: string) => {
      try {
        report(await call(), sent);
      } catch {
        toast.error(strings.result('failed'));
      }
    };
    return {
      memo: (id: number, challanNo: number, how: PrintDone['how']) => run(() => window.bm.print.memo(id, how), strings.print.memoSent(challanNo)),
      lr: (id: number, lrNo: number, how: PrintDone['how']) => run(() => window.bm.print.lr(id, how), strings.print.lrSent(lrNo)),
    };
  }, [toast]);
}

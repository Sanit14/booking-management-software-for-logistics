import type { KeeperResult, PrintDone } from './keeper';

/**
 * Printing, as the screen sees it (3.3). Main fetches what is printed from the keeper, builds the page, and either opens the
 * Windows print dialog (`print`) or asks where to save a PDF (`pdf`). Answers with the saved file for a PDF; `cancelled` when
 * the person closed the dialog, which is not an error and writes nothing.
 */
export interface PrintApi {
  memo(id: number, how: PrintDone['how']): Promise<KeeperResult<{ file?: string }>>;
  lr(id: number, how: PrintDone['how']): Promise<KeeperResult<{ file?: string }>>;
}

import type { KeeperResult, PrintDone, StatementQuery } from './keeper';

/**
 * Printing, as the screen sees it (3.3). Main fetches what is printed from the keeper, builds the page, and either opens the
 * Windows print dialog (`print`) or asks where to save a PDF (`pdf`). Answers with the saved file for a PDF; `cancelled` when
 * the person closed the dialog, which is not an error and writes nothing.
 */
export interface PrintApi {
  memo(id: number, how: PrintDone['how']): Promise<KeeperResult<{ file?: string }>>;
  lr(id: number, how: PrintDone['how']): Promise<KeeperResult<{ file?: string }>>;
  /** A firm's statement for a period (3.5); more than MAX_STATEMENT_PRINT_ROWS LRs is refused with `print-too-long`. */
  firmStatement(query: StatementQuery, how: PrintDone['how']): Promise<KeeperResult<{ file?: string }>>;
}

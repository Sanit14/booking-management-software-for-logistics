// Other copies of the app running in any Windows session, for the two jobs that must not run while someone else has the app open: installing
// an update and restoring a backup. The keeper's own list (seats that pinged in the last 45 s) is asked separately; this asks Windows, so it
// also catches a hung app and two seats that share one Windows user name.
import path from 'node:path';
import { listProcesses, otherInstanceRoots } from './processScan';

/** The Windows sessions that have another copy of this app running (not this one, not the keeper at `keeperPid`). Throws when Windows cannot be asked. */
export async function otherSessions(keeperPid: number): Promise<number[]> {
  const rows = await listProcesses(path.basename(process.execPath));
  return [...new Set(otherInstanceRoots(rows, process.pid, keeperPid).map((o) => o.session))];
}

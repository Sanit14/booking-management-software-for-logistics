// Finds other running copies of the app on this PC, in EVERY Windows session. An NComputing seat is just another
// Windows session, and the update must not replace the program while a seat still has it open. The keeper's seat
// list only knows apps that are still pinging; this asks Windows, so it also catches a hung app (and two seats
// that share one Windows user name, which the seat list cannot tell apart).
import { execFile } from 'node:child_process';

export interface ProcessRow {
  pid: number;
  parent: number;
  session: number;
}

/**
 * One entry per OTHER running copy. An Electron app is many processes (main, GPU, renderer...) with one exe name,
 * so they are grouped under their top-most ancestor of that name. The keeper is dropped first: it may have been
 * started by another seat's app and would otherwise hang under that seat and hide it.
 */
export function otherInstanceRoots(rows: ProcessRow[], ownPid: number, keeperPid: number): { pid: number; session: number }[] {
  const apps = rows.filter((r) => r.pid !== keeperPid);
  const byPid = new Map(apps.map((r) => [r.pid, r]));
  const rootPid = (pid: number): number => {
    let cur = pid;
    const seen = new Set<number>();
    for (let p = byPid.get(cur); p && !seen.has(cur); p = byPid.get(cur)) {
      seen.add(cur);
      if (!byPid.has(p.parent)) break;
      cur = p.parent;
    }
    return cur;
  };
  const mine = rootPid(ownPid);
  const roots = new Map<number, { pid: number; session: number }>();
  for (const r of apps) {
    const root = rootPid(r.pid);
    if (root !== mine && !roots.has(root)) roots.set(root, { pid: root, session: (byPid.get(root) ?? r).session });
  }
  return [...roots.values()];
}

/** "pid,parent,session" lines. Anything else (a PowerShell warning...) is an error: never update on a list we could not read. */
export function parseProcessLines(text: string): ProcessRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d+),(\d+),(\d+)$/.exec(l);
      if (!m) throw new Error('could not read the process list');
      return { pid: Number(m[1]), parent: Number(m[2]), session: Number(m[3]) };
    });
}

/**
 * Asks Windows (WMI) for the processes with this exe name. Process id, parent and session are visible to a normal
 * user for other users' processes too (the command line is not, so it is not used). Written for Windows
 * PowerShell 2.0, which Windows 7 ships: Get-WmiObject and plain text, no Get-CimInstance or ConvertTo-Json.
 */
export function listProcesses(exeName: string): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    if (!/^[\w. -]+$/.test(exeName)) return reject(new Error('unexpected program name'));
    const script = `Get-WmiObject Win32_Process -Filter "Name='${exeName}'" | ForEach-Object { '' + $_.ProcessId + ',' + $_.ParentProcessId + ',' + $_.SessionId }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(parseProcessLines(stdout));
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

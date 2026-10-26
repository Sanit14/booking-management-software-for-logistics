// Backup file names and the retention rule. Pure (no database), so `node --test` runs it.
const NAME = /^booking-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.db$/;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const DAY_MS = 24 * 3600_000;

/** booking-YYYYMMDD-HHmm.db, in the PC's local time (what the clerks' clock says). */
export function backupName(d: Date): string {
  return `booking-${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.db`;
}

/** The copy of the live database a restore sets aside. Not a backup's name, so pruning never sees it. */
export function beforeRestoreName(d: Date): string {
  return `booking-before-restore-${backupName(d).slice(8, 16)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
}

/** The time in a backup's name, or null if the name is not a backup's (temp files, before-restore copies, strangers). */
export function parseBackupName(name: string): Date | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  // new Date() rolls 13 months or 25 hours over; a name that does not round-trip is not one of ours.
  return backupName(date) === name ? date : null;
}

/**
 * Which backups to delete: keep the newest `hourly`, plus the first backup of each day within the last `days`
 * days. The newest is always among the kept. Names that are not backups are never returned.
 */
export function pickToPrune(names: string[], now: Date, hourly = 48, days = 30): string[] {
  const backups = names
    .map((name) => ({ name, at: parseBackupName(name) }))
    .filter((b): b is { name: string; at: Date } => b.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.name < b.name ? 1 : -1));
  const keep = new Set(backups.slice(0, hourly).map((b) => b.name));
  const cutoff = now.getTime() - days * DAY_MS;
  const firstOfDay = new Map<string, { name: string; at: number }>();
  for (const b of backups) {
    const day = b.name.slice(8, 16);
    const t = b.at.getTime();
    const cur = firstOfDay.get(day);
    if (!cur || t < cur.at) firstOfDay.set(day, { name: b.name, at: t });
  }
  for (const f of firstOfDay.values()) if (f.at >= cutoff) keep.add(f.name);
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

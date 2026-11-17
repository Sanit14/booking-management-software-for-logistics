// The last backup as one line: in Settings ("Backed up today 14:00 · 11.1 MB") and at the foot of the sidebar ("PC01 · backed up 14:00"). Pure.
import type { BackupStatus } from '../../shared';
import { strings } from '../strings';

export interface BackupLine {
  text: string;
  /** Red: the backups are failing. */
  bad: boolean;
}

const two = (n: number): string => String(n).padStart(2, '0');
const hhmm = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}`;
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** 11.1 MB: one decimal, never "0.0". */
const megabytes = (bytes: number): string => `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`;

/** Settings → Data & Backups: when and how big, or that they are failing (with the reason the keeper gave). */
export function backupStatusLine(b: BackupStatus | undefined, now: Date = new Date()): BackupLine {
  const t = strings.settings;
  if (b?.failing) return { text: strings.status.backupFailing(b.failing), bad: true };
  if (!b?.lastAt) return { text: t.noBackup, bad: false };
  const at = new Date(b.lastAt);
  const when = sameDay(at, now) ? `${t.today} ${hhmm(at)}` : `${two(at.getDate())}-${two(at.getMonth() + 1)}-${at.getFullYear()} ${hhmm(at)}`;
  return { text: t.backedUp(when, b.lastBytes === undefined ? null : megabytes(b.lastBytes)), bad: false };
}

/** The sidebar's foot: the time only (the date of an old one is in Settings). */
export function backupFootText(b: BackupStatus | undefined): BackupLine {
  if (b?.failing) return { text: strings.status.backupFailing(b.failing), bad: true };
  if (!b?.lastAt) return { text: strings.status.noBackup, bad: false };
  return { text: strings.status.lastBackup(hhmm(new Date(b.lastAt))), bad: false };
}

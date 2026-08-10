import { serializeCurrentBackup, backupFilename } from './backup-io';
import { writeBackup } from './backup-fs';

/**
 * High-level backup actions used by the UI: run a backup now, and the
 * auto-backup preference + trigger. Ties the DB snapshot (backup-io) to the
 * file system (backup-fs).
 */

const AUTO_KEY = 'inflow-auto-backup';
const LAST_KEY = 'inflow-last-backup';

export function getAutoBackupEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}
export function setAutoBackupEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {}
}

export function getLastBackupAt(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function setLastBackupAt(ts: number): void {
  try {
    localStorage.setItem(LAST_KEY, String(ts));
  } catch {}
}

/** Snapshot + write a backup file now. Returns how it was delivered. */
export async function runBackup(
  now: Date = new Date(),
): Promise<{ method: 'folder' | 'download'; folder?: string }> {
  const text = await serializeCurrentBackup(now.getTime());
  const res = await writeBackup(backupFilename(now), text);
  setLastBackupAt(now.getTime());
  return res;
}

/**
 * Best-effort silent backup after a data change (e.g. a categorization pass),
 * only when the user enabled auto-backup. Failures are swallowed — a missed
 * auto-backup must never disrupt the app; the user can always back up manually.
 */
export async function maybeAutoBackup(): Promise<void> {
  if (!getAutoBackupEnabled()) return;
  try {
    await runBackup();
  } catch {
    // ignore — folder permission may have lapsed; manual backup still works
  }
}

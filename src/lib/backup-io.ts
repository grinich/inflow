import { db, mergeConnections, getActiveAccountId } from '@/db/database';
import { getConnectionInterests, setConnectionInterests } from './ai-settings';
import {
  buildBackup,
  migrateBackup,
  serializeBackup,
  type BackupEnvelope,
} from './backup';

/**
 * Bridges the pure backup format ({@link ./backup}) with the live database:
 * gathers current data into an envelope, and applies a restored envelope back
 * into IndexedDB. The file-system side lives in {@link ./backup-fs}.
 */

/** Snapshot the current DB + settings into a serializable backup envelope. */
export async function gatherBackup(now: number = Date.now()): Promise<BackupEnvelope> {
  if (!db) throw new Error('Database not ready');
  const connections = await db.connections.toArray();
  const connectionInterests = await getConnectionInterests();
  return buildBackup({
    dbVersion: db.verno,
    exportedAt: now,
    memberId: getActiveAccountId() ?? '',
    connections,
    connectionInterests,
  });
}

/** Serialize a fresh snapshot to JSON text ready to write to disk. */
export async function serializeCurrentBackup(now?: number): Promise<string> {
  return serializeBackup(await gatherBackup(now));
}

export interface RestoreResult {
  connections: number;
  interests: number;
  /** True when the backup belonged to a different LinkedIn account. */
  crossAccount: boolean;
}

/**
 * Parse + migrate a backup file's text and merge it into the current DB.
 * `mergeConnections` conforms rows to the live schema and preserves anything
 * the backup lacks, so restoring an older backup is safe across migrations.
 */
export async function restoreBackupFromText(text: string): Promise<RestoreResult> {
  if (!db) throw new Error('Database not ready');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const result = migrateBackup(parsed);
  if (!result.ok) throw new Error(result.error);
  const env = result.data;

  if (env.tables.connections.length) {
    await mergeConnections(env.tables.connections);
  }
  if (env.settings.connectionInterests.length) {
    await setConnectionInterests(env.settings.connectionInterests);
  }

  const current = getActiveAccountId() ?? '';
  return {
    connections: env.tables.connections.length,
    interests: env.settings.connectionInterests.length,
    crossAccount: !!env.memberId && !!current && env.memberId !== current,
  };
}

/** A stable, sortable backup filename for the given time. */
export function backupFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `inflow-backup-${stamp}.json`;
}

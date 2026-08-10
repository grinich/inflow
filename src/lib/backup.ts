import type { Connection } from '@/types/connection';

/**
 * Portable backup format for the data inflow derives locally — most importantly
 * the AI categorization + summaries, which can't be re-fetched from LinkedIn.
 *
 * The file is plain JSON wrapped in a versioned envelope. JSON (not a SQL/
 * Postgres dump) is the right choice here: the data lives in the browser's
 * IndexedDB, there is no SQL engine to restore into, and a versioned JSON
 * envelope is what lets a backup taken on an old schema still import cleanly
 * after later releases — `migrateBackup` upgrades older envelopes to the
 * current shape, and Dexie conforms the rows to whatever the current schema is.
 */

/** Bump when the envelope shape changes; add a step in `migrateBackup`. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupEnvelope {
  app: 'inflow';
  kind: 'backup';
  /** Envelope schema version (see BACKUP_FORMAT_VERSION). */
  formatVersion: number;
  /** Dexie DB version at export time — informational, aids debugging. */
  dbVersion: number;
  /** Epoch ms the backup was taken. */
  exportedAt: number;
  /** LinkedIn member id the data belongs to (guards cross-account restores). */
  memberId: string;
  tables: {
    connections: Connection[];
  };
  settings: {
    connectionInterests: string[];
  };
}

export interface BackupInput {
  dbVersion: number;
  exportedAt: number;
  memberId: string;
  connections: Connection[];
  connectionInterests: string[];
}

export function buildBackup(input: BackupInput): BackupEnvelope {
  return {
    app: 'inflow',
    kind: 'backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    dbVersion: input.dbVersion,
    exportedAt: input.exportedAt,
    memberId: input.memberId,
    tables: { connections: input.connections },
    settings: { connectionInterests: input.connectionInterests },
  };
}

export function serializeBackup(env: BackupEnvelope): string {
  return JSON.stringify(env, null, 2);
}

export type MigrateResult =
  | { ok: true; data: BackupEnvelope }
  | { ok: false; error: string };

/** A connection row is only usable if it has its natural key. */
function isValidConnection(row: any): row is Connection {
  return !!row && typeof row.profileUrn === 'string' && row.profileUrn.length > 0;
}

/**
 * Validate and upgrade a parsed backup to the current envelope shape. Tolerant
 * by design: unknown/older backups still import as long as they carry keyed
 * connection rows. Rejects only genuinely wrong or newer-than-supported files.
 */
export function migrateBackup(raw: unknown): MigrateResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Not a valid backup file.' };
  }
  const obj = raw as Record<string, any>;
  if (obj.app !== 'inflow' || obj.kind !== 'backup') {
    return { ok: false, error: 'This file is not an inflow backup.' };
  }
  const formatVersion = Number(obj.formatVersion);
  if (!Number.isFinite(formatVersion) || formatVersion < 1) {
    return { ok: false, error: 'Backup is missing a valid format version.' };
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Backup was created by a newer version of inflow (format v${formatVersion}). Update the extension to restore it.`,
    };
  }

  // --- stepwise upgrades would go here as the format evolves ---
  // e.g. if (formatVersion === 1) { ...transform...; }

  const rawConns = obj.tables?.connections;
  const connections: Connection[] = Array.isArray(rawConns)
    ? rawConns.filter(isValidConnection)
    : [];

  const rawInterests = obj.settings?.connectionInterests;
  const connectionInterests: string[] = Array.isArray(rawInterests)
    ? rawInterests.filter((t: unknown): t is string => typeof t === 'string')
    : [];

  return {
    ok: true,
    data: {
      app: 'inflow',
      kind: 'backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      dbVersion: Number(obj.dbVersion) || 0,
      exportedAt: Number(obj.exportedAt) || 0,
      memberId: typeof obj.memberId === 'string' ? obj.memberId : '',
      tables: { connections },
      settings: { connectionInterests },
    },
  };
}

/** Count of restorable records — used for confirmation UI. */
export function backupSummary(env: BackupEnvelope): { connections: number; interests: number } {
  return {
    connections: env.tables.connections.length,
    interests: env.settings.connectionInterests.length,
  };
}

/**
 * Backup envelope: build, serialize, and the migration-aware import path that
 * keeps old backups restorable after schema changes.
 */
import {
  buildBackup,
  serializeBackup,
  migrateBackup,
  backupSummary,
  BACKUP_FORMAT_VERSION,
  type BackupInput,
} from '@/lib/backup';

function sampleInput(over: Partial<BackupInput> = {}): BackupInput {
  return {
    dbVersion: 14,
    exportedAt: 1000,
    memberId: 'MEMBER_A',
    connections: [
      {
        profileUrn: 'urn:li:fsd_profile:P1',
        connectionUrn: 'c1',
        connectedAt: 5,
        publicId: 'p1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        fullName: 'Ada Lovelace',
        headline: 'Investor',
        pictureUrl: '',
        syncedAt: 0,
        roleCategory: 'Investor',
        interestTags: ['Investors'],
        categorizedAt: 999,
        aiSummary: 'An investor.',
        summarizedAt: 999,
      },
    ],
    connectionInterests: ['Investors'],
    ...over,
  };
}

describe('buildBackup / serializeBackup', () => {
  it('wraps data in a versioned envelope and round-trips through JSON', () => {
    const env = buildBackup(sampleInput());
    expect(env).toMatchObject({
      app: 'inflow',
      kind: 'backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      dbVersion: 14,
      memberId: 'MEMBER_A',
    });
    const parsed = JSON.parse(serializeBackup(env));
    expect(parsed.tables.connections[0].aiSummary).toBe('An investor.');
    expect(parsed.settings.connectionInterests).toEqual(['Investors']);
  });
});

describe('migrateBackup', () => {
  it('accepts a current backup and preserves AI fields', () => {
    const env = buildBackup(sampleInput());
    const res = migrateBackup(JSON.parse(serializeBackup(env)));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.tables.connections[0].roleCategory).toBe('Investor');
      expect(backupSummary(res.data)).toEqual({ connections: 1, interests: 1 });
    }
  });

  it('rejects a non-inflow file', () => {
    const res = migrateBackup({ some: 'json' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not an inflow backup/i);
  });

  it('rejects a backup from a newer format version', () => {
    const res = migrateBackup({ app: 'inflow', kind: 'backup', formatVersion: 999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/newer version/i);
  });

  it('drops connection rows missing the natural key (tolerant import)', () => {
    const res = migrateBackup({
      app: 'inflow',
      kind: 'backup',
      formatVersion: 1,
      tables: { connections: [{ profileUrn: 'ok' }, { noKey: true }, null] },
      settings: { connectionInterests: ['Investors', 42, ''] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.tables.connections).toHaveLength(1);
      // Non-string interest entries are dropped.
      expect(res.data.settings.connectionInterests).toEqual(['Investors', '']);
    }
  });

  it('defaults missing tables/settings to empty rather than throwing', () => {
    const res = migrateBackup({ app: 'inflow', kind: 'backup', formatVersion: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(backupSummary(res.data)).toEqual({ connections: 0, interests: 0 });
  });
});

/**
 * backup-io round-trip against a real (fake-indexeddb) database: gather a
 * snapshot, then restore it into a fresh DB and confirm the AI-derived data
 * (categories, interest tags, summaries) survives — including across accounts.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import {
  gatherBackup,
  serializeCurrentBackup,
  restoreBackupFromText,
  backupFilename,
} from '@/lib/backup-io';
import { setConnectionInterests } from '@/lib/ai-settings';
import type { Connection } from '@/types/connection';

function conn(over: Partial<Connection> = {}): Connection {
  return {
    profileUrn: 'urn:li:fsd_profile:P1',
    connectionUrn: 'c1',
    connectedAt: 10,
    publicId: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    headline: 'Investor at Foo',
    pictureUrl: '',
    syncedAt: 0,
    roleCategory: 'Investor',
    interestTags: ['Investors'],
    categorizedAt: 500,
    aiSummary: 'An investor at Foo.',
    summarizedAt: 500,
    ...over,
  };
}

afterEach(async () => {
  // Tidy up any per-account DBs the tests created.
  for (const name of ['InflowDB_MEMBER_A', 'InflowDB_MEMBER_B']) {
    await Dexie.delete(name).catch(() => {});
  }
});

it('backupFilename is stable and sortable', () => {
  const name = backupFilename(new Date(2026, 0, 2, 3, 4, 5));
  expect(name).toBe('inflow-backup-2026-01-02-030405.json');
});

it('gathers connections + interests into an envelope for the active account', async () => {
  await switchDatabase('MEMBER_A');
  await db!.connections.bulkPut([conn()]);
  await setConnectionInterests(['Investors', 'Advisors']);

  const env = await gatherBackup(1234);
  expect(env.memberId).toBe('MEMBER_A');
  expect(env.exportedAt).toBe(1234);
  expect(env.tables.connections).toHaveLength(1);
  expect(env.tables.connections[0].aiSummary).toBe('An investor at Foo.');
  expect(env.settings.connectionInterests).toEqual(['Investors', 'Advisors']);
});

it('restores AI-derived data into a fresh database', async () => {
  await switchDatabase('MEMBER_A');
  await db!.connections.bulkPut([conn()]);
  await setConnectionInterests(['Investors']);
  const text = await serializeCurrentBackup(1);

  // Simulate a reinstall / new account: empty DB.
  await switchDatabase('MEMBER_B');
  expect(await db!.connections.count()).toBe(0);

  const res = await restoreBackupFromText(text);
  expect(res.connections).toBe(1);
  expect(res.crossAccount).toBe(true); // backup was MEMBER_A, active is MEMBER_B

  const restored = await db!.connections.get('urn:li:fsd_profile:P1');
  expect(restored?.roleCategory).toBe('Investor');
  expect(restored?.interestTags).toEqual(['Investors']);
  expect(restored?.aiSummary).toBe('An investor at Foo.');
});

it('rejects a file that is not valid JSON', async () => {
  await switchDatabase('MEMBER_A');
  await expect(restoreBackupFromText('not json')).rejects.toThrow(/valid JSON/i);
});

it('rejects a JSON file that is not an inflow backup', async () => {
  await switchDatabase('MEMBER_A');
  await expect(restoreBackupFromText('{"hello":"world"}')).rejects.toThrow(/not an inflow backup/i);
});

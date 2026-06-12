import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Dexie from 'dexie';
import { createTestDatabase } from '../helpers/test-db';
import type { Invitation, Connection } from '@/types/network';

describe('network tables (schema v12)', () => {
  let db: Dexie;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('stores and indexes invitations by status', async () => {
    const inv: Invitation = {
      id: '7123456',
      sharedSecret: 'abc123',
      fromUrn: 'urn:li:fsd_profile:ACoAAAtest',
      name: 'Ada Lovelace',
      headline: 'Engineer',
      pictureUrl: '',
      publicId: 'ada-lovelace',
      message: 'Hi!',
      sentAt: 1750000000000,
      status: 'pending',
    };
    await db.table('invitations').put(inv);
    const pending = await db.table('invitations').where('status').equals('pending').toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe('Ada Lovelace');
  });

  it('stores connections keyed by profileUrn, ordered by connectedAt', async () => {
    const mk = (n: number): Connection => ({
      profileUrn: `urn:li:fsd_profile:ACoAA${n}`,
      name: `Person ${n}`,
      headline: '',
      pictureUrl: '',
      publicId: `person-${n}`,
      connectedAt: n,
    });
    await db.table('connections').bulkPut([mk(1), mk(3), mk(2)]);
    const recent = await db.table('connections').orderBy('connectedAt').reverse().toArray();
    expect(recent.map((c: Connection) => c.connectedAt)).toEqual([3, 2, 1]);
  });
});

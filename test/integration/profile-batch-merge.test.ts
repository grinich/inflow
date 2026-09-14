import Dexie from 'dexie';
import * as database from '@/db/database';
import { makeProfile } from '../fixtures/factories';

const accountId = `profile-batch-${Date.now()}-${Math.random()}`;

beforeAll(async () => { await database.switchDatabase(accountId); });
beforeEach(async () => { await database.db.profiles.clear(); });
afterAll(async () => {
  database.db.close();
  await Dexie.delete(`InflowDB_${accountId}`);
});

it.each([false, true])('preserves complementary fields in repeated profiles (existing=%s)', async (exists) => {
  const urn = 'urn:li:fsd_profile:alice';
  if (exists) await database.db.profiles.put(makeProfile({ urn, location: 'Paris' }));
  const profiles = [
    makeProfile({ urn, occupation: 'Engineer', publicId: 'alice', pictureUrl: '', location: '' }),
    makeProfile({ urn, occupation: '', publicId: '', pictureUrl: 'https://example.com/alice.jpg', location: '' }),
  ];
  const input = structuredClone(profiles);

  await database.mergeProfiles(profiles);

  expect(await database.db.profiles.get(urn)).toMatchObject({
    occupation: 'Engineer', publicId: 'alice', pictureUrl: 'https://example.com/alice.jpg',
    ...(exists ? { location: 'Paris' } : {}),
  });
  expect(await database.db.profiles.count()).toBe(1);
  expect(profiles).toEqual(input);
});

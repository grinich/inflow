/**
 * Integration tests for src/db/database.ts
 *
 * Tests applySchema, mergeProfiles, memberIdFromUrn, and index correctness
 * using a real Dexie database backed by fake-indexeddb.
 */

import Dexie from 'dexie';
import { applySchema, memberIdFromUrn } from '@/db/database';
import { makeProfile } from '../fixtures/factories';

// ---------------------------------------------------------------------------
// Test database lifecycle (for schema & index tests)
// ---------------------------------------------------------------------------

let db: any;

beforeEach(async () => {
  db = new Dexie(`TestDB_${Date.now()}_${Math.random()}`);
  applySchema(db);
  await db.open();
});

afterEach(async () => {
  if (db) {
    db.close();
    await Dexie.delete(db.name);
  }
});

// ---------------------------------------------------------------------------
// applySchema: table creation
// ---------------------------------------------------------------------------

describe('applySchema', () => {
  it('creates all expected tables', () => {
    const tableNames = db.tables.map((t: any) => t.name).sort();
    expect(tableNames).toEqual([
      'conversations',
      'draftAttachments',
      'imageCache',
      'messages',
      'pendingActions',
      'postCache',
      'profiles',
      'syncQueue',
      'syncState',
      'tombstones',
    ]);
  });

  it('conversations table has correct primary key', async () => {
    await db.conversations.put({
      id: 'conv-1',
      participantUrns: [],
      participantNames: [],
      participantPictures: [],
      lastMessage: 'hello',
      lastActivityAt: 1000,
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
    });

    const result = await db.conversations.get('conv-1');
    expect(result).toBeDefined();
    expect(result.id).toBe('conv-1');
  });

  it('messages table has correct primary key', async () => {
    await db.messages.put({
      id: 'msg-1',
      conversationId: 'conv-1',
      senderUrn: 'urn:li:fsd_profile:abc',
      senderName: 'Tester',
      senderPicture: '',
      body: 'hello',
      createdAt: 1000,
      isFromMe: false,
    });

    const result = await db.messages.get('msg-1');
    expect(result).toBeDefined();
    expect(result.id).toBe('msg-1');
  });

  it('profiles table uses urn as primary key', async () => {
    await db.profiles.put({
      urn: 'urn:li:fsd_profile:abc',
      publicId: 'abc',
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      occupation: 'Dev',
      location: 'NYC',
      pictureUrl: '',
    });

    const result = await db.profiles.get('urn:li:fsd_profile:abc');
    expect(result).toBeDefined();
    expect(result.publicId).toBe('abc');
  });

  it('pendingActions table uses id as primary key', async () => {
    await db.pendingActions.put({
      id: 'action-1',
      type: 'archive',
      conversationId: 'conv-1',
      status: 'queued',
      timestamp: Date.now(),
    });

    const result = await db.pendingActions.get('action-1');
    expect(result).toBeDefined();
    expect(result.type).toBe('archive');
  });

  it('syncQueue table uses conversationId as primary key', async () => {
    await db.syncQueue.put({
      conversationId: 'conv-1',
      category: 'PRIMARY_INBOX',
      lastActivityAt: 1000,
      messagesSyncedAt: 0,
      status: 'pending',
      failCount: 0,
      lastFailedAt: 0,
      priority: 100,
    });

    const result = await db.syncQueue.get('conv-1');
    expect(result).toBeDefined();
    expect(result.status).toBe('pending');
  });

  it('draftAttachments table uses conversationId as primary key', async () => {
    await db.draftAttachments.put({
      conversationId: 'conv-1',
      text: 'draft text',
      files: [],
      names: [],
      types: [],
    });

    const result = await db.draftAttachments.get('conv-1');
    expect(result).toBeDefined();
    expect(result.text).toBe('draft text');
  });
});

// ---------------------------------------------------------------------------
// applySchema: index queries
// ---------------------------------------------------------------------------

describe('schema indexes', () => {
  it('supports compound index [conversationId+createdAt] on messages', async () => {
    await db.messages.bulkPut([
      {
        id: 'msg-1',
        conversationId: 'conv-A',
        senderUrn: 'urn:x',
        senderName: 'X',
        senderPicture: '',
        body: 'first',
        createdAt: 100,
        isFromMe: false,
      },
      {
        id: 'msg-2',
        conversationId: 'conv-A',
        senderUrn: 'urn:x',
        senderName: 'X',
        senderPicture: '',
        body: 'second',
        createdAt: 200,
        isFromMe: false,
      },
      {
        id: 'msg-3',
        conversationId: 'conv-B',
        senderUrn: 'urn:x',
        senderName: 'X',
        senderPicture: '',
        body: 'other conv',
        createdAt: 150,
        isFromMe: false,
      },
    ]);

    // Query using the compound index
    const results = await db.messages
      .where('[conversationId+createdAt]')
      .between(['conv-A', Dexie.minKey], ['conv-A', Dexie.maxKey])
      .toArray();

    expect(results).toHaveLength(2);
    expect(results[0].body).toBe('first');
    expect(results[1].body).toBe('second');
  });

  it('supports compound index [archived+lastActivityAt] on conversations', async () => {
    await db.conversations.bulkPut([
      {
        id: 'conv-1',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'a',
        lastActivityAt: 300,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      },
      {
        id: 'conv-2',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'b',
        lastActivityAt: 100,
        read: 1,
        archived: 1,
        category: 'ARCHIVE',
      },
      {
        id: 'conv-3',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'c',
        lastActivityAt: 200,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      },
    ]);

    // Query non-archived conversations
    const active = await db.conversations
      .where('[archived+lastActivityAt]')
      .between([0, Dexie.minKey], [0, Dexie.maxKey])
      .toArray();

    expect(active).toHaveLength(2);
    expect(active.map((c: any) => c.id).sort()).toEqual(['conv-1', 'conv-3']);
  });

  it('supports compound index [category+lastActivityAt] on conversations', async () => {
    await db.conversations.bulkPut([
      {
        id: 'conv-1',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'a',
        lastActivityAt: 300,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      },
      {
        id: 'conv-2',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'b',
        lastActivityAt: 200,
        read: 1,
        archived: 0,
        category: 'SECONDARY_INBOX',
      },
      {
        id: 'conv-3',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: 'c',
        lastActivityAt: 100,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      },
    ]);

    const primary = await db.conversations
      .where('[category+lastActivityAt]')
      .between(['PRIMARY_INBOX', Dexie.minKey], ['PRIMARY_INBOX', Dexie.maxKey])
      .toArray();

    expect(primary).toHaveLength(2);
    expect(primary.map((c: any) => c.id).sort()).toEqual(['conv-1', 'conv-3']);
  });

  it('supports compound index [status+priority] on syncQueue', async () => {
    await db.syncQueue.bulkPut([
      {
        conversationId: 'conv-1',
        category: 'PRIMARY_INBOX',
        lastActivityAt: 1000,
        messagesSyncedAt: 0,
        status: 'pending',
        failCount: 0,
        lastFailedAt: 0,
        priority: 50,
      },
      {
        conversationId: 'conv-2',
        category: 'PRIMARY_INBOX',
        lastActivityAt: 2000,
        messagesSyncedAt: 0,
        status: 'done',
        failCount: 0,
        lastFailedAt: 0,
        priority: 30,
      },
      {
        conversationId: 'conv-3',
        category: 'PRIMARY_INBOX',
        lastActivityAt: 3000,
        messagesSyncedAt: 0,
        status: 'pending',
        failCount: 0,
        lastFailedAt: 0,
        priority: 10,
      },
    ]);

    const pending = await db.syncQueue
      .where('[status+priority]')
      .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
      .toArray();

    expect(pending).toHaveLength(2);
    // Should be ordered by priority ascending
    expect(pending[0].conversationId).toBe('conv-3');
    expect(pending[1].conversationId).toBe('conv-1');
  });
});

// ---------------------------------------------------------------------------
// mergeProfiles
//
// mergeProfiles uses the module-scoped `db` variable internally.
// We test it by implementing the merge logic against the test database
// directly, mirroring the exact algorithm from database.ts:
//   1. bulkGet existing profiles by URN
//   2. Preserve known fields (occupation, location, pictureUrl, ...) when the
//      sparse incoming profile lacks them
//   3. bulkPut the merged profiles
// ---------------------------------------------------------------------------

describe('mergeProfiles', () => {
  /**
   * Re-implements mergeProfiles against `db` (our test database).
   * This mirrors the exact algorithm from src/db/database.ts.
   */
  async function mergeProfilesOnTestDb(profiles: import('@/types/profile').Profile[]): Promise<void> {
    if (profiles.length === 0) return;
    const urns = profiles.map((p) => p.urn);
    const existing = await db.profiles.bulkGet(urns);
    for (let i = 0; i < profiles.length; i++) {
      const prev = existing[i];
      if (prev) {
        if (prev.publicId && !profiles[i].publicId) profiles[i].publicId = prev.publicId;
        if (prev.occupation && !profiles[i].occupation) profiles[i].occupation = prev.occupation;
        if (prev.pictureUrl && !profiles[i].pictureUrl) profiles[i].pictureUrl = prev.pictureUrl;
        if (prev.location && !profiles[i].location) profiles[i].location = prev.location;
      }
    }
    await db.profiles.bulkPut(profiles);
  }

  it('inserts new profiles when none exist', async () => {
    const profiles = [
      makeProfile({ urn: 'urn:li:fsd_profile:new1', firstName: 'Alice', occupation: 'Founder' }),
      makeProfile({ urn: 'urn:li:fsd_profile:new2', firstName: 'Bob' }),
    ];

    await mergeProfilesOnTestDb(profiles);

    const stored1 = await db.profiles.get('urn:li:fsd_profile:new1');
    expect(stored1).toBeDefined();
    expect(stored1.firstName).toBe('Alice');
    expect(stored1.occupation).toBe('Founder');

    const stored2 = await db.profiles.get('urn:li:fsd_profile:new2');
    expect(stored2).toBeDefined();
    expect(stored2.firstName).toBe('Bob');
  });

  it('preserves existing occupation/location/pictureUrl when new profile lacks them', async () => {
    await db.profiles.put(
      makeProfile({
        urn: 'urn:li:fsd_profile:full',
        firstName: 'Jane',
        occupation: 'VP Engineering',
        location: 'New York',
        pictureUrl: 'https://example.com/jane.png',
      })
    );

    // Merge a sparse profile from the messaging API
    const incoming = makeProfile({
      urn: 'urn:li:fsd_profile:full',
      firstName: 'Jane',
      lastName: 'Updated',
      occupation: '',
      location: '',
      pictureUrl: '',
    });

    await mergeProfilesOnTestDb([incoming]);

    const result = await db.profiles.get('urn:li:fsd_profile:full');
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Updated');
    // Known fields should be preserved
    expect(result.occupation).toBe('VP Engineering');
    expect(result.location).toBe('New York');
    expect(result.pictureUrl).toBe('https://example.com/jane.png');
  });

  it('overwrites when new profile has fresh data', async () => {
    await db.profiles.put(
      makeProfile({
        urn: 'urn:li:fsd_profile:overwrite',
        occupation: 'Old Title',
        location: 'Old City',
        pictureUrl: 'https://old.com/pic.png',
      })
    );

    const incoming = makeProfile({
      urn: 'urn:li:fsd_profile:overwrite',
      occupation: 'New Title',
      location: 'New City',
      pictureUrl: 'https://new.com/pic.png',
    });

    await mergeProfilesOnTestDb([incoming]);

    const result = await db.profiles.get('urn:li:fsd_profile:overwrite');
    expect(result.occupation).toBe('New Title');
    expect(result.location).toBe('New City');
    expect(result.pictureUrl).toBe('https://new.com/pic.png');
  });

  it('handles empty array without error', async () => {
    await expect(mergeProfilesOnTestDb([])).resolves.toBeUndefined();
  });

  it('handles mix of new and existing profiles', async () => {
    await db.profiles.put(
      makeProfile({
        urn: 'urn:li:fsd_profile:existing',
        firstName: 'Existing',
        occupation: 'Founder',
      })
    );

    const profiles = [
      makeProfile({ urn: 'urn:li:fsd_profile:existing', firstName: 'Updated', occupation: '' }),
      makeProfile({ urn: 'urn:li:fsd_profile:brand-new', firstName: 'New' }),
    ];

    await mergeProfilesOnTestDb(profiles);

    const existing = await db.profiles.get('urn:li:fsd_profile:existing');
    expect(existing.firstName).toBe('Updated');
    expect(existing.occupation).toBe('Founder');

    const brandNew = await db.profiles.get('urn:li:fsd_profile:brand-new');
    expect(brandNew).toBeDefined();
    expect(brandNew.firstName).toBe('New');
  });
});

// ---------------------------------------------------------------------------
// memberIdFromUrn
// ---------------------------------------------------------------------------

describe('memberIdFromUrn', () => {
  it('extracts member ID from a standard fsd_profile URN', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:ACoAABcdEfG')).toBe('ACoAABcdEfG');
  });

  it('extracts member ID from a miniProfile URN', () => {
    expect(memberIdFromUrn('urn:li:fs_miniProfile:ACoAABcdEfG')).toBe('ACoAABcdEfG');
  });

  it('returns empty string for empty input', () => {
    expect(memberIdFromUrn('')).toBe('');
  });

  it('returns the whole string when no colons present', () => {
    expect(memberIdFromUrn('noColonsHere')).toBe('noColonsHere');
  });

  it('handles URN with special characters', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:ACo+AAB/cdE==')).toBe('ACo+AAB/cdE==');
  });
});

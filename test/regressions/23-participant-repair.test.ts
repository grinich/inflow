import { describe, it, expect, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  needsParticipantRepair,
  extractParticipantsFromIncluded,
} from '@/lib/voyager-normalizer';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

describe('needsParticipantRepair', () => {
  it('flags missing, garbage, or Unknown participant data', () => {
    expect(needsParticipantRepair({ participantUrns: [], participantNames: [] })).toBe(true);
    expect(
      needsParticipantRepair({
        participantUrns: ['urn:li:fsd_profile:urn:li:msg_messagingParticipant:(2-x,Y)'],
        participantNames: ['Unknown'],
      }),
    ).toBe(true);
    expect(
      needsParticipantRepair({ participantUrns: ['urn:li:fsd_profile:ABC'], participantNames: ['Unknown'] }),
    ).toBe(true);
    expect(needsParticipantRepair({ participantUrns: ['urn:li:fsd_profile:ABC'], participantNames: [''] })).toBe(true);
  });

  it('passes healthy participant data', () => {
    expect(
      needsParticipantRepair({ participantUrns: ['urn:li:fsd_profile:ABC'], participantNames: ['Ada Lovelace'] }),
    ).toBe(false);
  });

  it('returns false for a missing conversation', () => {
    expect(needsParticipantRepair(undefined)).toBe(false);
  });
});

describe('extractParticipantsFromIncluded', () => {
  const included = [
    {
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: 'urn:li:msg_messagingParticipant:p-self',
      hostIdentityUrn: 'urn:li:fsd_profile:SELF',
      participantType: { member: { firstName: { text: 'Me' }, lastName: { text: 'Self' } } },
    },
    {
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: 'urn:li:msg_messagingParticipant:p-other',
      hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
      participantType: {
        member: {
          firstName: { text: 'Ada' },
          lastName: { text: 'Lovelace' },
          profileUrl: 'https://www.linkedin.com/in/ada-lovelace/',
          headline: { text: 'Mathematician' },
        },
      },
    },
  ];

  it('excludes the viewer and builds participant fields + profiles', () => {
    const out = extractParticipantsFromIncluded(included, 'urn:li:fsd_profile:SELF');
    expect(out.participantUrns).toEqual(['urn:li:fsd_profile:OTHER']);
    expect(out.participantNames).toEqual(['Ada Lovelace']);
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0]).toMatchObject({
      urn: 'urn:li:fsd_profile:OTHER',
      publicId: 'ada-lovelace', // parsed from profileUrl for the open-profile shortcut
      fullName: 'Ada Lovelace',
      occupation: 'Mathematician',
    });
  });

  it('returns empty when no participants present', () => {
    expect(extractParticipantsFromIncluded([], 'urn:li:fsd_profile:SELF').participantUrns).toEqual([]);
  });
});

describe('repairConversationParticipants', () => {
  let testDb: any;

  beforeEach(async () => {
    testDb = new Dexie(`TestDB_repair_${Date.now()}_${Math.random()}`);
    applySchema(testDb);
    await testDb.open();
  });

  function included() {
    return [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: 'urn:li:msg_messagingParticipant:p-other',
        hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
        participantType: {
          member: {
            firstName: { text: 'Ada' },
            lastName: { text: 'Lovelace' },
            profileUrl: 'https://www.linkedin.com/in/ada-lovelace/',
          },
        },
      },
    ];
  }

  it('repairs a conversation seeded with Unknown/garbage participants and stores the profile', async () => {
    // Mock the DB module to point at our test instance for the helper under test.
    vi.resetModules();
    vi.doMock('@/db/database', async (importOriginal) => ({
      ...((await importOriginal()) as any),
      get db() {
        return testDb;
      },
      mergeProfiles: async (profiles: any[]) => {
        await testDb.profiles.bulkPut(profiles);
      },
    }));
    const { repairConversationParticipants } = await import(
      '../../entrypoints/background/sync/repair-participants'
    );

    await testDb.conversations.put({
      id: '2-new',
      participantUrns: ['urn:li:fsd_profile:urn:li:msg_messagingParticipant:(2-new,SELF)'],
      participantNames: ['Unknown'],
      participantPictures: [''],
      lastMessage: 'hi',
      lastActivityAt: 1,
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      hasAttachments: 0,
      starred: 0,
    });

    await repairConversationParticipants('2-new', included(), 'urn:li:fsd_profile:SELF');

    const conv = await testDb.conversations.get('2-new');
    expect(conv.participantNames).toEqual(['Ada Lovelace']);
    expect(conv.participantUrns).toEqual(['urn:li:fsd_profile:OTHER']);

    // The profile is stored so the open-profile ('p') shortcut can resolve it.
    const profile = await testDb.profiles.get('urn:li:fsd_profile:OTHER');
    expect(profile?.publicId).toBe('ada-lovelace');

    vi.doUnmock('@/db/database');
  });

  it('leaves a healthy conversation untouched', async () => {
    vi.resetModules();
    vi.doMock('@/db/database', async (importOriginal) => ({
      ...((await importOriginal()) as any),
      get db() {
        return testDb;
      },
      mergeProfiles: async () => {},
    }));
    const { repairConversationParticipants } = await import(
      '../../entrypoints/background/sync/repair-participants'
    );

    await testDb.conversations.put({
      id: '2-ok',
      participantUrns: ['urn:li:fsd_profile:KEEP'],
      participantNames: ['Grace Hopper'],
      participantPictures: [''],
      lastMessage: 'hi',
      lastActivityAt: 1,
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      hasAttachments: 0,
      starred: 0,
    });

    await repairConversationParticipants('2-ok', included(), 'urn:li:fsd_profile:SELF');

    const conv = await testDb.conversations.get('2-ok');
    expect(conv.participantNames).toEqual(['Grace Hopper']); // unchanged
    vi.doUnmock('@/db/database');
  });
});

import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';
import type { Profile } from '@/types/profile';

// ── Test DB setup ────────────────────────────────────────────────────────────
let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
    mergeProfiles: vi.fn(async (profiles: Profile[]) => {
      if (profiles.length === 0) return;
      const urns = profiles.map((p) => p.urn);
      const existing = await testDb.profiles.bulkGet(urns);
      for (let i = 0; i < profiles.length; i++) {
        const prev = existing[i];
        if (prev) {
          if (prev.company && !profiles[i].company) profiles[i].company = prev.company;
          if (prev.title && !profiles[i].title) profiles[i].title = prev.title;
          if (prev.location && !profiles[i].location) profiles[i].location = prev.location;
          if (prev.companyLogoUrl && !profiles[i].companyLogoUrl) profiles[i].companyLogoUrl = prev.companyLogoUrl;
        }
      }
      await testDb.profiles.bulkPut(profiles);
    }),
  };
});

vi.mock('../../entrypoints/background/api/conversations', () => ({
  fetchConversationsPage: vi.fn(),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

beforeEach(async () => {
  testDb = new Dexie(`TestDB_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  // Reset chrome.runtime.sendMessage mock call tracking
  vi.mocked(chrome.runtime.sendMessage).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
  // Reset modules to clear the _syncingCategories Set between tests
  vi.resetModules();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

/**
 * Build a minimal Voyager response that normalizeConversations can process.
 * Creates Conversation entities + MessagingParticipant entities + Message entities.
 */
function buildConversationsPage(
  conversations: Array<{
    id: string;
    participants: Array<{ profileId: string; firstName: string; lastName: string }>;
    lastMessage?: string;
    lastActivityAt: number;
    unreadCount?: number;
    categories?: string[];
  }>
): any {
  const included: any[] = [];

  for (const conv of conversations) {
    const participantRefs: string[] = [];

    // Add SELF participant first
    const selfParticipantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:SELF`;
    included.push({
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: selfParticipantUrn,
      hostIdentityUrn: 'urn:li:fsd_profile:SELF',
      participantType: {
        member: {
          firstName: { text: 'Test' },
          lastName: { text: 'User' },
        },
      },
    });
    participantRefs.push(selfParticipantUrn);

    for (const p of conv.participants) {
      const participantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${p.profileId}`;
      included.push({
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: participantUrn,
        hostIdentityUrn: `urn:li:fsd_profile:${p.profileId}`,
        participantType: {
          member: {
            firstName: { text: p.firstName },
            lastName: { text: p.lastName },
          },
        },
      });
      participantRefs.push(participantUrn);
    }

    const conversationUrn = `urn:li:msg_conversation:(${MEMBER_URN},${conv.id})`;

    // Add message entity for last message preview
    if (conv.lastMessage) {
      const msgUrn = `urn:li:msg_message:${conv.id}_last`;
      included.push({
        $type: 'com.linkedin.messenger.Message',
        entityUrn: msgUrn,
        body: { text: conv.lastMessage },
        deliveredAt: conv.lastActivityAt,
        '*conversation': conversationUrn,
      });
    }

    included.push({
      $type: 'com.linkedin.messenger.Conversation',
      entityUrn: conversationUrn,
      lastActivityAt: conv.lastActivityAt,
      unreadCount: conv.unreadCount ?? 0,
      categories: conv.categories ?? ['PRIMARY_INBOX'],
      '*conversationParticipants': participantRefs,
    });
  }

  return { data: {}, included };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sync-engine', () => {
  describe('syncConversations', () => {
    it('fetches PRIMARY_INBOX first page and stores conversations', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([
        {
          id: 'conv-1',
          participants: [{ profileId: 'Alice', firstName: 'Alice', lastName: 'Smith' }],
          lastMessage: 'Hey!',
          lastActivityAt: 1000,
        },
        {
          id: 'conv-2',
          participants: [{ profileId: 'Bob', firstName: 'Bob', lastName: 'Jones' }],
          lastMessage: 'Howdy',
          lastActivityAt: 2000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      expect(fetchConversationsPage).toHaveBeenCalledWith('PRIMARY_INBOX', null);

      const stored = await testDb.conversations.toArray();
      expect(stored).toHaveLength(2);
      expect(stored.map((c: Conversation) => c.id).sort()).toEqual(['conv-1', 'conv-2']);
    });

    it('prevents concurrent syncs for PRIMARY_INBOX', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockClear();

      // Make fetchConversationsPage slow so concurrent calls overlap
      let resolveFirst!: () => void;
      const firstCallPromise = new Promise<void>((r) => { resolveFirst = r; });

      const pageData = buildConversationsPage([
        {
          id: 'conv-lock',
          participants: [{ profileId: 'X', firstName: 'X', lastName: 'Y' }],
          lastMessage: 'Test',
          lastActivityAt: 1000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockImplementation(async () => {
        await firstCallPromise;
        return { response: pageData, nextCursor: null };
      });

      // Start first sync
      const sync1 = syncConversations();
      // Start second sync immediately -- should be a no-op due to lock
      const sync2 = syncConversations();

      // Let the first sync complete
      resolveFirst();
      await sync1;
      await sync2;

      // fetchConversationsPage should only be called once
      expect(fetchConversationsPage).toHaveBeenCalledTimes(1);
    });

    it('broadcasts SYNC_STATUS syncing at start and idle at end', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([]);
      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const syncStatusCalls = calls
        .map((c) => c[0])
        .filter((msg: any) => msg.type === 'SYNC_STATUS');

      expect(syncStatusCalls.length).toBeGreaterThanOrEqual(2);
      expect(syncStatusCalls[0]).toEqual(
        expect.objectContaining({ type: 'SYNC_STATUS', state: 'syncing' })
      );
      // Last SYNC_STATUS should be idle
      const lastSyncStatus = syncStatusCalls[syncStatusCalls.length - 1];
      expect(lastSyncStatus).toEqual(
        expect.objectContaining({ type: 'SYNC_STATUS', state: 'idle' })
      );
    });

    it('broadcasts SYNC_COMPLETE on success', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([]);
      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const completeCalls = calls
        .map((c) => c[0])
        .filter((msg: any) => msg.type === 'SYNC_COMPLETE');
      expect(completeCalls).toHaveLength(1);
    });

    it('broadcasts error status on failure', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockRejectedValue(new Error('API down'));

      await expect(syncConversations()).rejects.toThrow('API down');

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const errorCalls = calls
        .map((c) => c[0])
        .filter((msg: any) => msg.type === 'SYNC_STATUS' && msg.state === 'error');
      expect(errorCalls).toHaveLength(1);
    });

    it('releases sync lock on error so subsequent syncs can proceed', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockClear();

      // First call fails
      vi.mocked(fetchConversationsPage).mockRejectedValueOnce(new Error('Temp error'));
      await expect(syncConversations()).rejects.toThrow('Temp error');

      // Second call should be allowed (lock was released)
      const pageData = buildConversationsPage([
        {
          id: 'conv-retry',
          participants: [{ profileId: 'Z', firstName: 'Z', lastName: 'Z' }],
          lastMessage: 'Retry',
          lastActivityAt: 5000,
        },
      ]);
      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      expect(fetchConversationsPage).toHaveBeenCalledTimes(2);
      const stored = await testDb.conversations.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('conv-retry');
    });

    it('deduplicates conversations within page by ID keeping latest lastActivityAt', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Build a page where the same conversation appears twice with different timestamps
      const pageData = buildConversationsPage([
        {
          id: 'conv-dup',
          participants: [{ profileId: 'Alice', firstName: 'Alice', lastName: 'A' }],
          lastMessage: 'Old message',
          lastActivityAt: 1000,
        },
      ]);

      // Manually add a duplicate conversation entity with newer timestamp
      const dupConvUrn = `urn:li:msg_conversation:(${MEMBER_URN},conv-dup)`;
      pageData.included.push({
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: dupConvUrn,
        lastActivityAt: 5000,
        unreadCount: 0,
        categories: ['PRIMARY_INBOX'],
        '*conversationParticipants': [],
      });

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const stored = await testDb.conversations.toArray();
      // Should only have one conversation, not two
      const convDup = stored.filter((c: Conversation) => c.id === 'conv-dup');
      expect(convDup).toHaveLength(1);
      // Should keep the one with lastActivityAt=5000 (newer)
      expect(convDup[0].lastActivityAt).toBe(5000);
    });

    it('preserves starred field when updating existing conversation', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Pre-insert a conversation that has been starred locally
      await testDb.conversations.put({
        id: 'conv-star',
        participantUrns: ['urn:li:fsd_profile:Old'],
        participantNames: ['Old Name'],
        participantPictures: [''],
        lastMessage: 'Old msg',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
        starred: 1,
      });

      const pageData = buildConversationsPage([
        {
          id: 'conv-star',
          participants: [{ profileId: 'Alice', firstName: 'Alice', lastName: 'Smith' }],
          lastMessage: 'New msg',
          lastActivityAt: 2000,
          categories: ['PRIMARY_INBOX', 'STARRED'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-star');
      // starred should be synced from API categories
      expect(conv.starred).toBe(1);
      // Other fields should be updated from API
      expect(conv.lastMessage).toBe('New msg');
      expect(conv.lastActivityAt).toBe(2000);
    });

    it('syncs read field from server when updating existing conversation', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Pre-insert a conversation marked as read locally
      await testDb.conversations.put({
        id: 'conv-read',
        participantUrns: ['urn:li:fsd_profile:Old'],
        participantNames: ['Old Name'],
        participantPictures: [''],
        lastMessage: 'Old msg',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      });

      // API returns it as unread (unreadCount > 0)
      const pageData = buildConversationsPage([
        {
          id: 'conv-read',
          participants: [{ profileId: 'Alice', firstName: 'Alice', lastName: 'Smith' }],
          lastMessage: 'New msg',
          lastActivityAt: 2000,
          unreadCount: 3,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-read');
      // read should now be synced from server (0 from unreadCount=3)
      expect(conv.read).toBe(0);
    });

    it('puts new conversations directly without merge', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([
        {
          id: 'conv-new',
          participants: [{ profileId: 'Fresh', firstName: 'Fresh', lastName: 'Person' }],
          lastMessage: 'Brand new',
          lastActivityAt: 9000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-new');
      expect(conv).toBeDefined();
      expect(conv.lastMessage).toBe('Brand new');
      expect(conv.lastActivityAt).toBe(9000);
    });

    it('stores profiles via mergeProfiles', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { mergeProfiles } = await import('@/db/database');
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(mergeProfiles).mockClear();

      const pageData = buildConversationsPage([
        {
          id: 'conv-prof',
          participants: [
            { profileId: 'ProfileA', firstName: 'Alice', lastName: 'Wonderland' },
            { profileId: 'ProfileB', firstName: 'Bob', lastName: 'Builder' },
          ],
          lastMessage: 'Hi',
          lastActivityAt: 3000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      // mergeProfiles should have been called with the normalized profiles
      expect(mergeProfiles).toHaveBeenCalled();
      const calledProfiles = vi.mocked(mergeProfiles).mock.calls[0][0];
      // Should include profiles from participants
      expect(calledProfiles.length).toBeGreaterThan(0);
    });
  });

  describe('syncCategory', () => {
    it('delegates PRIMARY_INBOX to syncConversations', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([]);
      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncCategory('PRIMARY_INBOX');

      // Should call fetchConversationsPage with PRIMARY_INBOX
      expect(fetchConversationsPage).toHaveBeenCalledWith('PRIMARY_INBOX', null);
    });

    it('syncs SECONDARY_INBOX category', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([
        {
          id: 'conv-other',
          participants: [{ profileId: 'Other', firstName: 'Other', lastName: 'Person' }],
          lastMessage: 'Other inbox',
          lastActivityAt: 4000,
          categories: ['SECONDARY_INBOX'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncCategory('SECONDARY_INBOX');

      expect(fetchConversationsPage).toHaveBeenCalledWith('SECONDARY_INBOX', null);
      const stored = await testDb.conversations.toArray();
      expect(stored).toHaveLength(1);
    });

    it('syncs ARCHIVE category', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([
        {
          id: 'conv-archive',
          participants: [{ profileId: 'Arch', firstName: 'Arch', lastName: 'Ived' }],
          lastMessage: 'Archived',
          lastActivityAt: 1500,
          categories: ['ARCHIVE'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncCategory('ARCHIVE');

      expect(fetchConversationsPage).toHaveBeenCalledWith('ARCHIVE', null);
      const stored = await testDb.conversations.toArray();
      expect(stored).toHaveLength(1);
    });

    it('syncs SPAM category', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      const pageData = buildConversationsPage([
        {
          id: 'conv-spam',
          participants: [{ profileId: 'Spammer', firstName: 'Spam', lastName: 'Bot' }],
          lastMessage: 'Buy now!',
          lastActivityAt: 500,
          categories: ['SPAM'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncCategory('SPAM');

      expect(fetchConversationsPage).toHaveBeenCalledWith('SPAM', null);
    });

    it('prevents concurrent syncs for the same non-PRIMARY category', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockClear();

      let resolveFirst!: () => void;
      const firstCallPromise = new Promise<void>((r) => { resolveFirst = r; });

      const pageData = buildConversationsPage([
        {
          id: 'conv-sec',
          participants: [{ profileId: 'X', firstName: 'X', lastName: 'X' }],
          lastMessage: 'Test',
          lastActivityAt: 1000,
          categories: ['SECONDARY_INBOX'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockImplementation(async () => {
        await firstCallPromise;
        return { response: pageData, nextCursor: null };
      });

      const sync1 = syncCategory('SECONDARY_INBOX');
      const sync2 = syncCategory('SECONDARY_INBOX');

      resolveFirst();
      await sync1;
      await sync2;

      // Should only call fetchConversationsPage once because of the lock
      expect(fetchConversationsPage).toHaveBeenCalledTimes(1);
    });

    it('allows concurrent syncs for different categories', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockClear();

      let resolveSecondary!: () => void;
      let resolveArchive!: () => void;
      const secondaryPromise = new Promise<void>((r) => { resolveSecondary = r; });
      const archivePromise = new Promise<void>((r) => { resolveArchive = r; });

      const secondaryPage = buildConversationsPage([
        {
          id: 'conv-sec',
          participants: [{ profileId: 'S', firstName: 'S', lastName: 'S' }],
          lastMessage: 'Secondary',
          lastActivityAt: 1000,
          categories: ['SECONDARY_INBOX'],
        },
      ]);

      const archivePage = buildConversationsPage([
        {
          id: 'conv-arch',
          participants: [{ profileId: 'A', firstName: 'A', lastName: 'A' }],
          lastMessage: 'Archive',
          lastActivityAt: 2000,
          categories: ['ARCHIVE'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockImplementation(async (category) => {
        if (category === 'SECONDARY_INBOX') {
          await secondaryPromise;
          return { response: secondaryPage, nextCursor: null };
        }
        await archivePromise;
        return { response: archivePage, nextCursor: null };
      });

      const sync1 = syncCategory('SECONDARY_INBOX');
      const sync2 = syncCategory('ARCHIVE');

      // Both should be in-flight simultaneously
      resolveSecondary();
      resolveArchive();
      await sync1;
      await sync2;

      // Both categories should have been fetched
      expect(fetchConversationsPage).toHaveBeenCalledTimes(2);
      expect(fetchConversationsPage).toHaveBeenCalledWith('SECONDARY_INBOX', null);
      expect(fetchConversationsPage).toHaveBeenCalledWith('ARCHIVE', null);
    });

    it('releases lock on error for non-PRIMARY category', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockClear();

      // First call fails
      vi.mocked(fetchConversationsPage).mockRejectedValueOnce(new Error('Boom'));
      await expect(syncCategory('SECONDARY_INBOX')).rejects.toThrow('Boom');

      // Second call should succeed because lock was released
      const pageData = buildConversationsPage([
        {
          id: 'conv-retry-sec',
          participants: [{ profileId: 'R', firstName: 'R', lastName: 'R' }],
          lastMessage: 'Retry ok',
          lastActivityAt: 3000,
          categories: ['SECONDARY_INBOX'],
        },
      ]);
      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncCategory('SECONDARY_INBOX');

      expect(fetchConversationsPage).toHaveBeenCalledTimes(2);
    });

    it('broadcasts correct syncing label for SECONDARY_INBOX', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: buildConversationsPage([]),
        nextCursor: null,
      });

      await syncCategory('SECONDARY_INBOX');

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const syncingCall = calls
        .map((c) => c[0])
        .find((msg: any) => msg.type === 'SYNC_STATUS' && msg.state === 'syncing');

      expect(syncingCall).toBeDefined();
      expect(syncingCall.message).toBe('Syncing Other...');
    });

    it('broadcasts correct syncing label for ARCHIVE', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: buildConversationsPage([]),
        nextCursor: null,
      });

      await syncCategory('ARCHIVE');

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const syncingCall = calls
        .map((c) => c[0])
        .find((msg: any) => msg.type === 'SYNC_STATUS' && msg.state === 'syncing');

      expect(syncingCall.message).toBe('Syncing Archived...');
    });

    it('broadcasts correct syncing label for SPAM', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncCategory } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: buildConversationsPage([]),
        nextCursor: null,
      });

      await syncCategory('SPAM');

      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const syncingCall = calls
        .map((c) => c[0])
        .find((msg: any) => msg.type === 'SYNC_STATUS' && msg.state === 'syncing');

      expect(syncingCall.message).toBe('Syncing Spam...');
    });
  });

  describe('pending-action guard (fix #1)', () => {
    it('does NOT overwrite category/archived/read/starred when a pending action exists', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Pre-insert a conversation that was just archived optimistically
      await testDb.conversations.put({
        id: 'conv-guard',
        participantUrns: ['urn:li:fsd_profile:Alice'],
        participantNames: ['Alice'],
        participantPictures: [''],
        lastMessage: 'Hi',
        lastActivityAt: 1000,
        read: 1,
        archived: 1,       // optimistically archived
        category: 'ARCHIVE',
        starred: 0,
      });

      // Insert a pending action for this conversation (archive in-flight)
      await testDb.pendingActions.put({
        id: 'pa-1',
        type: 'archive',
        conversationId: 'conv-guard',
        status: 'pending',
        timestamp: Date.now(),
      });

      // API returns stale data showing conversation still in PRIMARY_INBOX
      const pageData = buildConversationsPage([
        {
          id: 'conv-guard',
          participants: [{ profileId: 'Alice', firstName: 'Alice', lastName: 'Smith' }],
          lastMessage: 'Hi there',
          lastActivityAt: 2000,
          categories: ['PRIMARY_INBOX'],
          unreadCount: 1,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-guard');
      // category/archived/read should NOT be overwritten because of pending action
      expect(conv.archived).toBe(1);
      expect(conv.category).toBe('ARCHIVE');
      expect(conv.read).toBe(1);
      // But non-guarded fields should still update
      expect(conv.lastMessage).toBe('Hi there');
      expect(conv.lastActivityAt).toBe(2000);
    });

    it('DOES overwrite category/archived/read when no pending action exists', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Pre-insert a conversation
      await testDb.conversations.put({
        id: 'conv-no-guard',
        participantUrns: ['urn:li:fsd_profile:Bob'],
        participantNames: ['Bob'],
        participantPictures: [''],
        lastMessage: 'Hi',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
        starred: 0,
      });

      // No pending actions — server data should win
      const pageData = buildConversationsPage([
        {
          id: 'conv-no-guard',
          participants: [{ profileId: 'Bob', firstName: 'Bob', lastName: 'Jones' }],
          lastMessage: 'New msg',
          lastActivityAt: 2000,
          categories: ['SECONDARY_INBOX'],
          unreadCount: 2,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-no-guard');
      expect(conv.category).toBe('SECONDARY_INBOX');
      expect(conv.read).toBe(0);
    });

    it('does NOT guard when pending action status is confirmed', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      await testDb.conversations.put({
        id: 'conv-confirmed',
        participantUrns: ['urn:li:fsd_profile:C'],
        participantNames: ['C'],
        participantPictures: [''],
        lastMessage: 'Hi',
        lastActivityAt: 1000,
        read: 1,
        archived: 1,
        category: 'ARCHIVE',
        starred: 0,
      });

      // Pending action exists but is already confirmed — should not guard
      await testDb.pendingActions.put({
        id: 'pa-confirmed',
        type: 'archive',
        conversationId: 'conv-confirmed',
        status: 'confirmed',
        timestamp: Date.now(),
      });

      const pageData = buildConversationsPage([
        {
          id: 'conv-confirmed',
          participants: [{ profileId: 'C', firstName: 'C', lastName: 'D' }],
          lastMessage: 'Updated',
          lastActivityAt: 2000,
          categories: ['PRIMARY_INBOX'],
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-confirmed');
      // Should be overwritten because the action is confirmed, not pending/queued
      expect(conv.category).toBe('PRIMARY_INBOX');
      expect(conv.archived).toBe(0);
    });
  });

  describe('storeConversationPage selective field merge (regression)', () => {
    it('does NOT overwrite existing participantUrns with empty array from API', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Pre-insert a conversation with populated participantUrns
      await testDb.conversations.put({
        id: 'conv-merge',
        participantUrns: ['urn:li:fsd_profile:ABC'],
        participantNames: ['Alice Bob'],
        participantPictures: ['https://photo.url/abc.jpg'],
        lastMessage: 'Hello',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      });

      // API returns the same conversation but with empty participants
      // (e.g. the participant data was not included in this page)
      const pageData = buildConversationsPage([
        {
          id: 'conv-merge',
          participants: [], // no participants in this response
          lastMessage: 'Updated msg',
          lastActivityAt: 2000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-merge');
      // participantUrns should be preserved from existing record, NOT overwritten with []
      expect(conv.participantUrns).toEqual(['urn:li:fsd_profile:ABC']);
    });

    it('does NOT overwrite existing participantNames with empty array from API', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      await testDb.conversations.put({
        id: 'conv-names',
        participantUrns: ['urn:li:fsd_profile:DEF'],
        participantNames: ['Dave Grohl'],
        participantPictures: ['https://photo.url/def.jpg'],
        lastMessage: 'Hi',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      });

      const pageData = buildConversationsPage([
        {
          id: 'conv-names',
          participants: [],
          lastMessage: 'Updated',
          lastActivityAt: 2000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-names');
      expect(conv.participantNames).toEqual(['Dave Grohl']);
    });

    it('does NOT overwrite existing lastMessage with empty string from API', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      await testDb.conversations.put({
        id: 'conv-lm',
        participantUrns: ['urn:li:fsd_profile:GHI'],
        participantNames: ['Grace Hopper'],
        participantPictures: [''],
        lastMessage: 'Important message',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      });

      // API returns conversation with no message entity -> lastMessage will be ''
      const pageData = buildConversationsPage([
        {
          id: 'conv-lm',
          participants: [{ profileId: 'GHI', firstName: 'Grace', lastName: 'Hopper' }],
          // no lastMessage provided -> normalizer yields ''
          lastActivityAt: 2000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-lm');
      // lastMessage should be preserved from existing, not overwritten with ''
      expect(conv.lastMessage).toBe('Important message');
    });

    it('uses max of existing and incoming lastActivityAt', async () => {
      const { fetchConversationsPage } = await import(
        '../../entrypoints/background/api/conversations'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      // Existing has a NEWER lastActivityAt than what the API will return
      await testDb.conversations.put({
        id: 'conv-time',
        participantUrns: ['urn:li:fsd_profile:JKL'],
        participantNames: ['John Doe'],
        participantPictures: [''],
        lastMessage: 'Recent',
        lastActivityAt: 5000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      });

      // API returns an older lastActivityAt
      const pageData = buildConversationsPage([
        {
          id: 'conv-time',
          participants: [{ profileId: 'JKL', firstName: 'John', lastName: 'Doe' }],
          lastMessage: 'Older update',
          lastActivityAt: 3000,
        },
      ]);

      vi.mocked(fetchConversationsPage).mockResolvedValue({
        response: pageData,
        nextCursor: null,
      });

      await syncConversations();

      const conv = await testDb.conversations.get('conv-time');
      // Should keep the max of existing (5000) and incoming (3000)
      expect(conv.lastActivityAt).toBe(5000);
    });
  });
});

/**
 * Regression: sparse server payloads must not fabricate conversation state.
 *
 * normalizeConversations converted *absence* of data into definite values:
 * missing `categories` became archived=0 + category=PRIMARY_INBOX, and missing
 * `unreadCount` became read=1. mergeConversation then applied those unguarded,
 * so any endpoint returning thinner conversation entities (server-side search
 * is the risky caller) could silently un-archive, re-categorize, and mark-read
 * local conversations.
 *
 * The fix: fields the payload omitted normalize to `undefined` ("unknown") and
 * the merge keeps the existing local value; brand-new inserts get defaults.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

/** A Conversation entity with NO categories and NO unreadCount fields. */
function buildSparseResponse(convId: string, lastActivityAt: number) {
  return {
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
        lastActivityAt,
        '*conversationParticipants': [],
      },
    ],
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_58_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('normalizeConversations with sparse payloads', () => {
  it('leaves read/archived/category undefined when the payload omits them', () => {
    const { conversations } = normalizeConversations(
      buildSparseResponse('2-sparse', 5000) as any,
      MEMBER_URN
    );
    expect(conversations).toHaveLength(1);
    expect(conversations[0].read).toBeUndefined();
    expect(conversations[0].archived).toBeUndefined();
    expect(conversations[0].category).toBeUndefined();
    expect(conversations[0].starred).toBeUndefined();
  });

  it('still derives all flags when the payload carries them', () => {
    const raw = buildSparseResponse('2-full', 5000) as any;
    raw.included[0].unreadCount = 2;
    raw.included[0].categories = ['INBOX', 'ARCHIVE'];
    const { conversations } = normalizeConversations(raw, MEMBER_URN);
    expect(conversations[0].read).toBe(0);
    expect(conversations[0].archived).toBe(1);
    expect(conversations[0].category).toBe('ARCHIVE');
  });
});

describe('mergeConversation with sparse server conversations', () => {
  it('does not un-archive / re-categorize / mark-read from a sparse payload', async () => {
    await testDb.conversations.put(
      makeConversation({
        id: '2-sparse-merge',
        category: 'ARCHIVE',
        archived: 1,
        read: 0,
        starred: 1,
        lastActivityAt: 5000,
      })
    );

    const { conversations } = normalizeConversations(
      buildSparseResponse('2-sparse-merge', 5000) as any,
      MEMBER_URN
    );
    await mergeConversation(conversations[0]);

    const row = await testDb.conversations.get('2-sparse-merge');
    expect(row.category).toBe('ARCHIVE');
    expect(row.archived).toBe(1);
    expect(row.read).toBe(0);
    expect(row.starred).toBe(1);
  });

  it('fills safe defaults when inserting a brand-new sparse conversation', async () => {
    const { conversations } = normalizeConversations(
      buildSparseResponse('2-sparse-new', 5000) as any,
      MEMBER_URN
    );
    await mergeConversation(conversations[0]);

    const row = await testDb.conversations.get('2-sparse-new');
    expect(row).toBeDefined();
    expect(row.read).toBe(1);
    expect(row.archived).toBe(0);
    expect(row.category).toBe('PRIMARY_INBOX');
    expect(row.starred).toBe(0);
  });
});

// Every external jump into a thread goes through here: clicking a notification
// toast, opening a conversation from the shell or a launch parameter, and
// landing in the thread an accepted invitation just created.
//
// The job is not only to select the conversation but to make it VISIBLE, since
// App reconciles the selection against the rendered list and recovers off
// anything missing from it. The wrong tab hides a thread; so does a leftover
// search, which is how a jump could quietly deposit the user somewhere else.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

import { navigateToConversation } from '@/lib/navigate-to-conversation';
import { useUIStore } from '@/store/ui-store';

function conv(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    participantUrns: [`urn:li:fsd_profile:${id}`],
    participantNames: ['Someone'],
    participantPictures: [''],
    lastMessage: 'hello',
    lastActivityAt: 1_750_000_000_000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  } as Conversation;
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_navigate_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({
    inboxTab: 'focused', selectedConversationId: null, searchQuery: '',
    _pendingRestore: null,
  });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

const state = () => useUIStore.getState();

describe('navigateToConversation', () => {
  it('opens the conversation', async () => {
    await testDb.conversations.put(conv('c1'));

    await navigateToConversation('c1');

    expect(state().selectedConversationId).toBe('c1');
  });

  it('switches to the tab the conversation lives in', async () => {
    await testDb.conversations.bulkPut([
      conv('archived-one', { archived: 1 }),
      conv('spam-one', { category: 'SPAM' }),
      conv('other-one', { category: 'SECONDARY_INBOX' }),
    ]);

    await navigateToConversation('archived-one');
    expect(state().inboxTab).toBe('archived');

    await navigateToConversation('spam-one');
    expect(state().inboxTab).toBe('spam');

    await navigateToConversation('other-one');
    expect(state().inboxTab).toBe('other');
  });

  it('treats an archived spam thread as archived, not spam', async () => {
    // Both rules match; the list puts it in Archived, so navigation must agree
    // or the jump lands on a tab that does not contain it.
    await testDb.conversations.put(conv('both', { archived: 1, category: 'SPAM' }));

    await navigateToConversation('both');

    expect(state().inboxTab).toBe('archived');
  });

  it('clears a search that would hide the conversation', async () => {
    // Arriving from a notification while a filter is up used to select a
    // thread that was not in the filtered list at all.
    await testDb.conversations.put(conv('c1'));
    useUIStore.setState({ searchQuery: 'is:starred' });

    await navigateToConversation('c1');

    expect(state().searchQuery).toBe('');
    expect(state().selectedConversationId).toBe('c1');
  });

  it('drops the remembered selection so the tab switch cannot hijack the jump', async () => {
    await testDb.conversations.put(conv('archived-one', { archived: 1 }));
    useUIStore.setState({ _pendingRestore: { conversationId: 'something-else', index: 3 } as any });

    await navigateToConversation('archived-one');

    expect(state()._pendingRestore).toBeNull();
    expect(state().selectedConversationId).toBe('archived-one');
  });

  it('still selects a thread that has not synced yet', async () => {
    // Accepting an invitation creates the thread server-side; the jump happens
    // before it arrives. Staying put would be the pause the placeholder exists
    // to avoid.
    await navigateToConversation('not-here-yet');

    expect(state().selectedConversationId).toBe('not-here-yet');
    // No row to read a tab from, so the current one is left alone.
    expect(state().inboxTab).toBe('focused');
  });
});

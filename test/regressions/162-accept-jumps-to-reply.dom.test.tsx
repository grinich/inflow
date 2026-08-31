// @vitest-environment jsdom
// Accepting an invitation that came with a note drops you into the reply.
//
// The note IS the first message of the thread LinkedIn creates on accept, so
// answering it is the natural next act — and the thread is nowhere near the
// network view. Accepting is also what creates that thread, so it is usually
// not synced yet and the jump has to wait for it rather than assume it.
import '../dom-setup';
import { renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Invitation } from '@/types/network';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { useNetworkActions } from '@/hooks/useNetworkActions';
import { useUIStore } from '@/store/ui-store';

const SENDER = 'urn:li:fsd_profile:ACoAAAsender';

function invitation(message: string): Invitation {
  return {
    id: 'inv-1', sharedSecret: 's', fromUrn: SENDER, name: 'Grace Hopper',
    headline: 'Rear Admiral', pictureUrl: '', publicId: 'grace',
    message, sentAt: 1_750_000_000_000, status: 'pending',
    mutualCount: 0, mutualNames: [], mutualPictures: [],
  };
}

function thread(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id, participantUrns: [SENDER], participantNames: ['Grace Hopper'],
    participantPictures: [''], lastMessage: 'hello', lastActivityAt: 1_750_000_000_000,
    read: 1, archived: 0, category: 'PRIMARY_INBOX', ...over,
  } as Conversation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  sendBridgeMessage.mockImplementation(async () => ({ success: true }));
  testDb = new Dexie(`TestDB_accept_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.invitations.put(invitation('Hi Michael — big fan of your work.'));
  useUIStore.setState({
    appView: 'network', inboxTab: 'focused', selectedConversationId: null,
    composeActive: false, composerFocusFor: null,
  });
  // Stand-in composers, as ThreadView would render them. The attribute names
  // the conversation each box belongs to: focus is requested for a named
  // conversation and the draft carried over is read from that box, so an
  // anonymous textarea is no longer a faithful stand-in for either.
  document.body.innerHTML =
    '<textarea data-compose-input="draft-ACoAAAsender"></textarea>' +
    '<textarea data-compose-input="conv-1"></textarea>' +
    '<textarea data-compose-input="conv-late"></textarea>';
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
  document.body.innerHTML = '';
});

const actions = () => renderHook(() => useNetworkActions()).result.current;

/** The stand-in composer for a conversation. */
const composerFor = (id: string) =>
  document.querySelector(`[data-compose-input="${id}"]`) as HTMLTextAreaElement;

describe('regression #162: accepting an invitation with a note', () => {
  it('opens the thread and asks for the cursor in ITS reply box', async () => {
    // The composer takes the cursor itself when it mounts for the conversation
    // named here — see ComposeBox. That the cursor really lands there is
    // covered end to end in the accept-invitation integration test, with the
    // real App and the real composer.
    await testDb.conversations.put(thread('conv-1'));

    await actions().acceptInvitation(invitation('Hi Michael — big fan.'));

    await waitFor(() => {
      const s = useUIStore.getState();
      expect(s.appView).toBe('inbox');
      expect(s.selectedConversationId).toBe('conv-1');
    });
    expect(useUIStore.getState().composerFocusFor).toBe('conv-1');
  });

  it('stays put when the invitation had no note', async () => {
    await testDb.conversations.put(thread('conv-1'));

    await actions().acceptInvitation(invitation(''));

    // Nothing to reply to; accepting a bare request should leave you on the
    // list to keep triaging.
    expect(useUIStore.getState().appView).toBe('network');
    expect(useUIStore.getState().selectedConversationId).toBeNull();
  });

  it('switches immediately, without waiting for the thread to sync', async () => {
    // The jank: accepting is what creates the thread, so waiting for it left
    // the user on the network list for a second or more with nothing happening.
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    // A placeholder is up and focused long before the real thread lands.
    await waitFor(() => {
      expect(useUIStore.getState().appView).toBe('inbox');
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender');
    });

    await accept;
  });

  it('swaps the placeholder for the real thread once it arrives', async () => {
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);

    await actions().acceptInvitation(invitation('Hi Michael'));

    expect(useUIStore.getState().selectedConversationId).toBe('conv-late');
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'BURST_DISCOVER', category: 'PRIMARY_INBOX' });
    // The stand-in is cleaned up, not left in the list.
    expect(await testDb.conversations.get('draft-ACoAAAsender')).toBeUndefined();
  });

  it('carries keystrokes the composer has not saved yet', async () => {
    // The composer autosaves once a second, so the stored row lags what is on
    // screen. Reading only the row lost the last second of typing: the swap
    // cleared the box, and the text reappeared solely as a draft you had to
    // navigate away and back to find.
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    // On screen but not yet persisted — exactly the window that lost text.
    composerFor('draft-ACoAAAsender').value = 'Typed but unsaved';

    await accept;

    expect((await testDb.draftAttachments.get('conv-late'))?.text).toBe('Typed but unsaved');
  });

  it('prefers what is on screen over a stale saved draft', async () => {
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    await testDb.draftAttachments.put({ conversationId: 'draft-ACoAAAsender', text: 'one second ago' });
    composerFor('draft-ACoAAAsender').value = 'one second ago plus more';

    await accept;

    expect((await testDb.draftAttachments.get('conv-late'))?.text).toBe('one second ago plus more');
  });

  it('falls back to the saved draft when the box is empty', async () => {
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    // Typing starts the moment the box is focused — well before the swap.
    await testDb.draftAttachments.put({ conversationId: 'draft-ACoAAAsender', text: 'Great to connect!' });

    await accept;

    // Losing a half-written reply to a swap nobody asked for would be worse
    // than the delay it replaced.
    expect((await testDb.draftAttachments.get('conv-late'))?.text).toBe('Great to connect!');
    expect(await testDb.draftAttachments.get('draft-ACoAAAsender')).toBeUndefined();
  });

  it('stops watching once the user leaves the inbox', async () => {
    // Selection alone is NOT treated as leaving: App's auto-select effect
    // reassigns it for its own reasons — restoring a tab's remembered thread,
    // filling an empty selection — and reading that as intent is precisely
    // what left the accepted thread unselected.
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    useUIStore.getState().setAppView('network');

    await accept;

    expect(useUIStore.getState().appView).toBe('network');
    expect(useUIStore.getState().selectedConversationId).not.toBe('conv-late');
  });

  it('still lands on the thread when something reassigns the selection', async () => {
    // The reported failure: the message arrived and nothing selected it,
    // because the selection had been taken off the placeholder meanwhile.
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    useUIStore.getState().openThread('something-the-app-picked', 0);

    await accept;

    expect(useUIStore.getState().selectedConversationId).toBe('conv-late');
  });

  it('carries the placeholder’s text, not whichever box is first in the DOM', async () => {
    // The read used to be document.querySelector('[data-compose-input]') —
    // the first composer in the document, whoever it belonged to. With another
    // thread's box ahead of it, that copied a stranger's half-written reply
    // onto this thread.
    document.body.innerHTML =
      '<textarea data-compose-input="someone-else"></textarea>' +
      '<textarea data-compose-input="draft-ACoAAAsender"></textarea>' +
      '<textarea data-compose-input="conv-late"></textarea>';
    composerFor('someone-else').value = 'a reply to a different person';
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);
    const accept = actions().acceptInvitation(invitation('Hi Michael'));

    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    composerFor('draft-ACoAAAsender').value = 'my actual reply';

    await accept;

    expect((await testDb.draftAttachments.get('conv-late'))?.text).toBe('my actual reply');
  });

  it('carries nothing when only another conversation’s box has text', async () => {
    document.body.innerHTML =
      '<textarea data-compose-input="someone-else"></textarea>' +
      '<textarea data-compose-input="draft-ACoAAAsender"></textarea>';
    composerFor('someone-else').value = 'not mine to move';
    setTimeout(() => { void testDb.conversations.put(thread('conv-late')); }, 600);

    await actions().acceptInvitation(invitation('Hi Michael'));

    expect(await testDb.draftAttachments.get('conv-late')).toBeUndefined();
  });

  it('never drops the reply into a group thread', async () => {
    // participantUrns excludes the viewer, so a 1:1 has exactly one entry.
    // Matching loosely here would send the reply to an extra person.
    await testDb.conversations.put(
      thread('group', { id: 'group', participantUrns: [SENDER, 'urn:li:fsd_profile:other'] })
    );

    await actions().acceptInvitation(invitation('Hi Michael'));

    expect(useUIStore.getState().selectedConversationId).not.toBe('group');
  });

  it('keeps the placeholder when no thread ever arrives', async () => {
    await actions().acceptInvitation(invitation('Hi Michael'));

    // Yanking it away would be worse than leaving it: the reply is still
    // typeable, and sending from it reuses the real thread.
    expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender');
    expect(await testDb.conversations.get('draft-ACoAAAsender')).toBeTruthy();
  }, 20_000);

  it('does not delete a real thread when the accept fails', async () => {
    // beginJump returns the EXISTING conversation's id when there already is
    // one, and the failure path used to delete whatever it was handed — which
    // for that case is a thread the user actually has.
    await testDb.conversations.put(thread('conv-1'));
    sendBridgeMessage.mockResolvedValueOnce({ success: false } as any);

    await actions().acceptInvitation(invitation('Hi Michael'));

    expect(await testDb.conversations.get('conv-1')).toBeTruthy();
  });

  it('lets the newest accept win when two are in flight', async () => {
    // Two watchers running at once, and whichever resolved last dragged the
    // user to its own thread — possibly the one they had moved on from.
    const other = { ...invitation('Second note'), id: 'inv-2', fromUrn: 'urn:li:fsd_profile:ACoAAAsecond', name: 'Second Person' };
    await testDb.invitations.put(other as any);
    setTimeout(() => { void testDb.conversations.put(thread('conv-first')); }, 900);
    setTimeout(() => {
      void testDb.conversations.put({
        ...thread('conv-second'), id: 'conv-second', participantUrns: [other.fromUrn],
      } as any);
    }, 500);

    const first = actions().acceptInvitation(invitation('Hi Michael'));
    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAsender')
    );
    const second = actions().acceptInvitation(other as any);

    await Promise.all([first, second]);

    // The first one's thread arrives later; it must not steal the view back.
    expect(useUIStore.getState().selectedConversationId).toBe('conv-second');
  }, 25_000);

  it('does not jump when the accept was rejected', async () => {
    await testDb.conversations.put(thread('conv-1'));
    sendBridgeMessage.mockResolvedValueOnce({ success: false } as any);

    await actions().acceptInvitation(invitation('Hi Michael'));

    expect(useUIStore.getState().appView).toBe('network');
    expect((await testDb.invitations.get('inv-1')).status).toBe('pending');
  });
});

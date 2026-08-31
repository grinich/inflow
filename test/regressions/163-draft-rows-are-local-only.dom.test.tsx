// @vitest-environment jsdom
// A `draft-` row is a local stand-in — a composer target, or the placeholder
// shown while an accepted invitation's thread syncs. LinkedIn has no thread
// behind it, so acting on one sent its id to Voyager and came back:
//
//   400 The EntityKey "draft-ACoAADnD2UsB…" is in an invalid format
//
// which surfaced as "failed to archive, rolling back" over a row the user had
// every reason to think was real.
import '../dom-setup';
import { renderHook } from '@testing-library/react';
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

const sendBridgeMessage = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { useOptimisticAction } from '@/hooks/useOptimisticAction';

const DRAFT_ID = 'draft-ACoAADnD2UsBJeIPiCbAs';

function draft(): Conversation {
  return {
    id: DRAFT_ID,
    participantUrns: ['urn:li:fsd_profile:ACoAADnD2UsBJeIPiCbAs'],
    participantNames: ['Angelika Hiebl'],
    participantPictures: [''],
    lastMessage: '',
    lastActivityAt: 1_750_000_000_000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    draft: 1,
  } as Conversation;
}

function real(): Conversation {
  return { ...draft(), id: 'conv-real', draft: undefined } as Conversation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_draftguard_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

const actions = () => renderHook(() => useOptimisticAction()).result.current;
const bridgeTypes = () => sendBridgeMessage.mock.calls.map((c: any) => c[0].type);

describe('regression #163: draft rows never reach Voyager', () => {
  it('does not archive one', async () => {
    await testDb.conversations.put(draft());

    await actions().archiveConversation(draft());

    expect(bridgeTypes()).not.toContain('ARCHIVE');
  });

  it('does not star one', async () => {
    await testDb.conversations.put(draft());

    await actions().starConversation(draft());

    expect(bridgeTypes()).not.toContain('STAR');
  });

  it('does not move one between folders', async () => {
    await testDb.conversations.put(draft());

    await actions().moveToOther(draft());
    await actions().moveToSpam(draft());

    expect(bridgeTypes()).not.toContain('MOVE_TO_OTHER');
    expect(bridgeTypes()).not.toContain('MOVE_TO_SPAM');
  });

  it('does not mark one read or unread', async () => {
    // Opening the placeholder triggers this on its own, so it fired without
    // the user doing anything at all.
    await actions().markRead(DRAFT_ID);
    await actions().markUnread(DRAFT_ID);

    expect(bridgeTypes()).not.toContain('MARK_READ');
    expect(bridgeTypes()).not.toContain('MARK_UNREAD');
  });

  it('deletes one locally, without asking LinkedIn', async () => {
    await testDb.conversations.put(draft());
    await testDb.draftAttachments.put({ conversationId: DRAFT_ID, text: 'half a reply' });

    await actions().deleteConversation(draft());

    expect(bridgeTypes()).not.toContain('DELETE_CONVERSATION');
    expect(await testDb.conversations.get(DRAFT_ID)).toBeUndefined();
    expect(await testDb.draftAttachments.get(DRAFT_ID)).toBeUndefined();
  });

  it('sends from one without trying to archive it', async () => {
    // ⌘↵ in the composer. Sending is how a draft becomes a real thread, so it
    // must still go — it is only the archive half that has no id to use.
    await testDb.conversations.put(draft());

    await actions().sendAndArchive(DRAFT_ID, 'hello');

    expect(bridgeTypes()).not.toContain('ARCHIVE');
    expect(bridgeTypes().some((t) => /SEND|CREATE_CONVERSATION/.test(t))).toBe(true);
  });

  it('still acts normally on a real conversation', async () => {
    // The guard must not quietly disable the inbox.
    await testDb.conversations.put(real());

    await actions().archiveConversation(real());

    expect(bridgeTypes()).toContain('ARCHIVE');
  });
});

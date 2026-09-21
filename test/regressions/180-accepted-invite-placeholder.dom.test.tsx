// @vitest-environment jsdom
// Bug: a thread created by accepting an invitation could never be opened.
//
// Accepting writes a `draft-<memberId>` stand-in so the jump is instant, and
// settleJump deletes it once the real thread shows up — but only within a 15s
// deadline, only while the user stays in the inbox, and only if no newer
// accept takes over. Miss any of those and the stand-in is stranded forever,
// and because mergeDuplicateConversations folds 1:1 threads into the NEWEST by
// lastActivityAt — the stand-in, stamped at accept time — it hid the real
// thread. Clicking the row opened a composer instead of the message that came
// with the invitation, which read as "the profile never synced".
//
// Fix: the stand-in is stamped `placeholder: 1`, never outranks a real thread
// in the list, and is reconciled away once that thread arrives. Drafts the
// user is composing are untouched — they must stay visible while they pick
// recipients (NewMessageComposer relies on it).
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { mergeDuplicateConversations } from '@/lib/conversation-query';
import { reconcilePlaceholders, PLACEHOLDER_STALE_MS } from '@/lib/reconcile-placeholders';
import { makeConversation } from '../fixtures/factories';

const ELLE = 'urn:li:fsd_profile:ACoAACic8PUB';

let testDb: any;

beforeEach(async () => {
  testDb = new Dexie(`TestDB_placeholder_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** The stand-in the accept flow writes: newer than the thread it stands for. */
function placeholder(overrides = {}) {
  return makeConversation({
    id: `draft-${ELLE.split(':').pop()}`,
    participantUrns: [ELLE],
    participantNames: ['Elle Szabo'],
    lastMessage: '',
    lastActivityAt: 2_000,
    draft: 1,
    placeholder: 1,
    ...overrides,
  });
}

/** The thread the accept created, carrying the invitation's message. */
function realThread(overrides = {}) {
  return makeConversation({
    id: '2-ZTQ3NzRkZGMtMm',
    participantUrns: [ELLE],
    participantNames: ['Elle Szabo'],
    lastMessage: 'Hey had a great time at the event last night',
    lastActivityAt: 1_000,
    ...overrides,
  });
}

describe('regression #180: an accepted invitation opens its thread', () => {
  it('does not let the stand-in hide the real thread in the list', () => {
    const merged = mergeDuplicateConversations([placeholder(), realThread()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('2-ZTQ3NzRkZGMtMm');
    expect(merged[0].lastMessage).toContain('great time at the event');
    // The row it replaced is still reachable as a merged sibling
    expect(merged[0].mergedIds).toContain(placeholder().id);
  });

  it('still lets a draft the user is composing win, as the composer expects', () => {
    const composeDraft = placeholder({ placeholder: undefined });
    const merged = mergeDuplicateConversations([composeDraft, realThread()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(composeDraft.id);
  });

  it('keeps the stand-in while the real thread has not arrived', async () => {
    await testDb.conversations.bulkPut([placeholder()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: null,
      carryDraftAcross: () => {},
      navigate: () => {},
    });
    expect(retired).toEqual([]);
    expect(await testDb.conversations.count()).toBe(1);
  });

  it('retires the stand-in once the real thread is here', async () => {
    await testDb.conversations.bulkPut([placeholder(), realThread()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: null,
      carryDraftAcross: () => {},
      navigate: () => {},
    });
    expect(retired).toEqual([placeholder().id]);
    expect(await testDb.conversations.get(placeholder().id)).toBeUndefined();
    expect(await testDb.conversations.get('2-ZTQ3NzRkZGMtMm')).toBeTruthy();
  });

  it('follows the selection into the real thread when the row goes away', async () => {
    await testDb.conversations.bulkPut([placeholder(), realThread()]);
    const carried: string[][] = [];
    const navigated: string[] = [];
    await reconcilePlaceholders(testDb, {
      selectedId: placeholder().id,
      carryDraftAcross: (from, to) => carried.push([from, to]),
      navigate: (id) => { navigated.push(id); },
    });
    expect(carried).toEqual([[placeholder().id, '2-ZTQ3NzRkZGMtMm']]);
    expect(navigated).toEqual(['2-ZTQ3NzRkZGMtMm']);
  });

  it('carries a half-typed reply over to the real thread', async () => {
    await testDb.conversations.bulkPut([placeholder(), realThread()]);
    await testDb.draftAttachments.put({ conversationId: placeholder().id, text: 'great to meet you too' });
    await reconcilePlaceholders(testDb, { selectedId: null, carryDraftAcross: () => {}, navigate: () => {} });
    expect((await testDb.draftAttachments.get('2-ZTQ3NzRkZGMtMm'))?.text).toBe('great to meet you too');
    expect(await testDb.draftAttachments.get(placeholder().id)).toBeUndefined();
  });

  it('never clobbers a reply already typed into the real thread', async () => {
    await testDb.conversations.bulkPut([placeholder(), realThread()]);
    await testDb.draftAttachments.put({ conversationId: placeholder().id, text: 'stale' });
    await testDb.draftAttachments.put({ conversationId: '2-ZTQ3NzRkZGMtMm', text: 'what I am typing now' });
    await reconcilePlaceholders(testDb, { selectedId: null, carryDraftAcross: () => {}, navigate: () => {} });
    expect((await testDb.draftAttachments.get('2-ZTQ3NzRkZGMtMm'))?.text).toBe('what I am typing now');
  });

  it('leaves a fresh accept to its own hand-off', async () => {
    // settleJump snapshots the live composer and waits for the flush; sweeping
    // the row out from under it is what loses a reply typed while waiting.
    await testDb.conversations.bulkPut([placeholder({ lastActivityAt: 10_000 }), realThread()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: null,
      carryDraftAcross: () => {},
      navigate: () => {},
      now: () => 10_000 + PLACEHOLDER_STALE_MS - 1,
    });
    expect(retired).toEqual([]);
  });

  it('takes over once that hand-off has had its chance', async () => {
    await testDb.conversations.bulkPut([placeholder({ lastActivityAt: 10_000 }), realThread()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: null,
      carryDraftAcross: () => {},
      navigate: () => {},
      now: () => 10_000 + PLACEHOLDER_STALE_MS,
    });
    expect(retired).toEqual([placeholder().id]);
  });

  it('leaves a draft the user is composing alone', async () => {
    const composeDraft = placeholder({ placeholder: undefined });
    await testDb.conversations.bulkPut([composeDraft, realThread()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: composeDraft.id,
      carryDraftAcross: () => {},
      navigate: () => {},
    });
    expect(retired).toEqual([]);
    expect(await testDb.conversations.get(composeDraft.id)).toBeTruthy();
  });

  it('clears an unstamped leftover from an older build, once it is safe to', async () => {
    // The row that shipped this bug carries no `placeholder` stamp. Empty and
    // unselected, with the real thread present, it is leftover either way.
    const legacy = placeholder({ placeholder: undefined });
    await testDb.conversations.bulkPut([legacy, realThread()]);
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: 'some-other-thread',
      carryDraftAcross: () => {},
      navigate: () => {},
    });
    expect(retired).toEqual([legacy.id]);
  });

  it('keeps an unstamped draft that has something typed in it', async () => {
    const legacy = placeholder({ placeholder: undefined });
    await testDb.conversations.bulkPut([legacy, realThread()]);
    await testDb.draftAttachments.put({ conversationId: legacy.id, text: 'half a message' });
    const retired = await reconcilePlaceholders(testDb, {
      selectedId: 'some-other-thread',
      carryDraftAcross: () => {},
      navigate: () => {},
    });
    expect(retired).toEqual([]);
    expect(await testDb.conversations.get(legacy.id)).toBeTruthy();
  });

  it('does not mistake a group thread for the person’s 1:1 thread', async () => {
    await testDb.conversations.bulkPut([
      placeholder(),
      makeConversation({ id: 'group-1', participantUrns: [ELLE, 'urn:li:fsd_profile:other'], lastActivityAt: 5_000 }),
    ]);
    const retired = await reconcilePlaceholders(testDb, { selectedId: null, carryDraftAcross: () => {}, navigate: () => {} });
    expect(retired).toEqual([]);
  });
});

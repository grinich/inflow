/**
 * The InMail view selects by message type, not by LinkedIn folder.
 *
 * The sidebar used to label the SECONDARY_INBOX tab "InMail", which quietly
 * promised something it could not deliver: a received InMail can sit in
 * PRIMARY_INBOX just as easily (verified against real data — Denis Magee's
 * InMail is in PRIMARY_INBOX), so a folder filter misses it entirely.
 *
 * Only InMail carries a subject, so the sparse `subject` index is exactly the
 * set of InMail messages.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

const msg = (over: Partial<any>): any => ({
  id: 'm' + Math.random().toString(36).slice(2),
  conversationId: 'c1',
  senderUrn: 'urn:li:fsd_profile:X',
  senderName: 'Them',
  senderPicture: '',
  body: 'hello',
  createdAt: 1000,
  isFromMe: false,
  ...over,
});

beforeEach(async () => {
  await switchDatabase('MEMBER_INMAILVIEW');
  await db!.conversations.clear();
  await db!.messages.clear();
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_INMAILVIEW').catch(() => {});
});

/** The query the InMail tab runs. */
async function inMailConversationIds(): Promise<string[]> {
  const withSubject = await db!.messages.where('subject').above('').toArray();
  const ids = [...new Set(withSubject.map((m) => m.conversationId))];
  const convs = await db!.conversations.bulkGet(ids);
  return convs
    .filter((c): c is NonNullable<typeof c> => !!c && c.draft !== 1)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((c) => c.id);
}

it('finds an InMail that LinkedIn filed in PRIMARY_INBOX', async () => {
  await db!.conversations.bulkAdd([
    makeConversation({ id: 'c1', category: 'PRIMARY_INBOX', lastActivityAt: 200 }),
    makeConversation({ id: 'c2', category: 'SECONDARY_INBOX', lastActivityAt: 100 }),
  ]);
  await db!.messages.bulkAdd([
    msg({ conversationId: 'c1', subject: 'Candidate available' }), // the Denis Magee case
    msg({ conversationId: 'c2', subject: 'Your Executive Online Presence' }),
  ]);
  // Both, regardless of folder — this is what the old "InMail" tab could not do.
  expect(await inMailConversationIds()).toEqual(['c1', 'c2']);
});

it('excludes ordinary messages, which never carry a subject', async () => {
  await db!.conversations.bulkAdd([
    makeConversation({ id: 'c1', category: 'PRIMARY_INBOX', lastActivityAt: 200 }),
    makeConversation({ id: 'c2', category: 'SECONDARY_INBOX', lastActivityAt: 100 }),
  ]);
  await db!.messages.bulkAdd([
    msg({ conversationId: 'c1' }),
    // A SECONDARY_INBOX thread is not an InMail just because of its folder.
    msg({ conversationId: 'c2' }),
  ]);
  expect(await inMailConversationIds()).toEqual([]);
});

it('lists a conversation once however many InMails it holds, newest first', async () => {
  await db!.conversations.bulkAdd([
    makeConversation({ id: 'c1', lastActivityAt: 100 }),
    makeConversation({ id: 'c2', lastActivityAt: 300 }),
  ]);
  await db!.messages.bulkAdd([
    msg({ conversationId: 'c1', subject: 'First' }),
    msg({ conversationId: 'c1', subject: 'Following up' }),
    msg({ conversationId: 'c2', subject: 'Other thread' }),
  ]);
  expect(await inMailConversationIds()).toEqual(['c2', 'c1']);
});

it('skips unsent draft conversations', async () => {
  await db!.conversations.add(makeConversation({ id: 'draft-x', draft: 1, lastActivityAt: 400 }));
  await db!.messages.add(msg({ conversationId: 'draft-x', subject: 'Not sent yet' }));
  expect(await inMailConversationIds()).toEqual([]);
});

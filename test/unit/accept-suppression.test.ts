// Accepting an invitation makes LinkedIn deliver the sender's note as an
// inbound message seconds later. That is the same event as any other arrival,
// so it alerted — announcing a message the user had just chosen to accept and
// was already looking at.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  recordAcceptedSender,
  isRecentlyAccepted,
  clearAcceptSuppression,
} from '../../entrypoints/background/realtime/accept-suppression';

// `db` is null until an account is selected, so announceInbound needs one.
let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const SENDER = 'urn:li:fsd_profile:ACoAAAsender';

beforeEach(() => {
  clearAcceptSuppression();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('accept suppression', () => {
  it('suppresses a sender we just accepted', () => {
    recordAcceptedSender(SENDER);

    expect(isRecentlyAccepted(SENDER)).toBe(true);
  });

  it('leaves everyone else alone', () => {
    recordAcceptedSender(SENDER);

    expect(isRecentlyAccepted('urn:li:fsd_profile:someone-else')).toBe(false);
    expect(isRecentlyAccepted(undefined)).toBe(false);
  });

  it('stops suppressing once the window passes', () => {
    // A later, genuine message from the same person has to alert normally —
    // this is a brief amnesty, not a mute.
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);

    vi.advanceTimersByTime(121_000);

    expect(isRecentlyAccepted(SENDER)).toBe(false);
  });

  it('keeps suppressing inside the window', () => {
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);

    // LinkedIn takes seconds, not minutes, but the note can lag a slow sync.
    vi.advanceTimersByTime(60_000);

    expect(isRecentlyAccepted(SENDER)).toBe(true);
  });

  it('ignores an empty urn rather than suppressing everything', () => {
    recordAcceptedSender('');

    expect(isRecentlyAccepted('')).toBe(false);
  });

  it('forgets senders once their window lapses, rather than growing forever', () => {
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);
    vi.advanceTimersByTime(121_000);

    // Recording anyone prunes the stale entries.
    recordAcceptedSender('urn:li:fsd_profile:other');

    expect(isRecentlyAccepted(SENDER)).toBe(false);
    expect(isRecentlyAccepted('urn:li:fsd_profile:other')).toBe(true);
  });
});

// The suppression only matters if the thing that announces messages honours
// it. The in-app toast and the OS notification are DIFFERENT paths — the
// first version guarded only the OS one, and the toast, which was the one
// actually on screen, kept firing.
describe('announceInbound honours the suppression', () => {
  const SENDER_2 = 'urn:li:fsd_profile:ACoAAAother';
  let sent: any[];

  beforeEach(async () => {
    testDb = new Dexie(`TestDB_announce_${Date.now()}_${Math.random()}`);
    applySchema(testDb);
    await testDb.open();
    sent = [];
    (globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      runtime: {
        ...(globalThis as any).chrome?.runtime,
        sendMessage: (m: any) => { sent.push(m); return Promise.resolve(); },
        getURL: (p: string) => p,
      },
      notifications: { create: () => {} },
    };
  });

  afterEach(async () => {
    testDb.close();
    await Dexie.delete(testDb.name);
  });

  async function announce(conversationId: string) {
    const { announceInbound } = await import('../../entrypoints/background/realtime/event-handler');
    await announceInbound({
      id: 'm1', senderName: 'Angelika', senderPicture: '', body: 'hello', conversationId,
    });
  }

  it('says nothing about a sender just accepted', async () => {
    await testDb.conversations.put({
      id: 'c-accepted', participantUrns: [SENDER], participantNames: ['Angelika'],
      participantPictures: [''], lastMessage: 'hello', lastActivityAt: 1,
      read: 0, archived: 0, category: 'PRIMARY_INBOX',
    } as any);
    recordAcceptedSender(SENDER);

    await announce('c-accepted');

    expect(sent.filter((m) => m.type === 'INCOMING_MESSAGE')).toHaveLength(0);
  });

  it('still announces everyone else', async () => {
    await testDb.conversations.put({
      id: 'c-other', participantUrns: [SENDER_2], participantNames: ['Someone'],
      participantPictures: [''], lastMessage: 'hello', lastActivityAt: 1,
      read: 0, archived: 0, category: 'PRIMARY_INBOX',
    } as any);
    recordAcceptedSender(SENDER);

    await announce('c-other');

    expect(sent.filter((m) => m.type === 'INCOMING_MESSAGE')).toHaveLength(1);
  });

  it('still announces a group thread containing an accepted sender', async () => {
    // Suppression is about the note that accompanied one invitation, not about
    // muting the person.
    await testDb.conversations.put({
      id: 'c-group', participantUrns: [SENDER, SENDER_2], participantNames: ['A', 'B'],
      participantPictures: ['', ''], lastMessage: 'hello', lastActivityAt: 1,
      read: 0, archived: 0, category: 'PRIMARY_INBOX',
    } as any);
    recordAcceptedSender(SENDER);

    await announce('c-group');

    expect(sent.filter((m) => m.type === 'INCOMING_MESSAGE')).toHaveLength(1);
  });
});

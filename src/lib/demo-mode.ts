// ---------------------------------------------------------------------------
// Demo mode — core engine
//
// Intercepts bridge messages so all existing code (optimistic actions, hooks,
// Dexie live queries) works unchanged against a real IndexedDB (`InflowDB_demo`).
// The background service worker is never contacted.
//
// Activated via `?demo` URL parameter — no localStorage persistence, so you
// can never get stuck in demo mode (just remove the query param).
// ---------------------------------------------------------------------------

import { DEMO_PEOPLE, DEMO_MESSAGES_INBOUND, DEMO_MESSAGES_OUTBOUND, DEMO_OPENERS } from './demo-data';
import type { BridgeMessage, BridgeResponse } from '@/types/bridge';
import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';
import type { Profile } from '@/types/profile';

const DEMO_ME_URN = 'urn:li:fsd_profile:demo';

// ── State helpers ──────────────────────────────────────────────────────────

/** Demo mode is active when `?demo` is in the URL. */
export function isDemoMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
}

/** Navigate to current page with `?demo` added, then hard-reload. */
export function enableDemoMode(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('demo', '');
  window.location.replace(url.toString());
}

/** Strip `?demo` from the URL and hard-refresh the page. */
export function disableDemoMode(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('demo');
  // Set the clean URL, then force a full reload from the server.
  window.history.replaceState(null, '', url.toString());
  window.location.reload();
}

// ── Lazy DB access ─────────────────────────────────────────────────────────
// `db` starts as null and is assigned by switchDatabase() in AuthGate.
// We import the module and access .db at call time so we always get the
// current live value, even if the module-level `db` export was null at
// import time.

import * as database from '@/db/database';

function getDb() {
  return database.db;
}

// ── Random helpers ─────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Seed data ──────────────────────────────────────────────────────────────

export async function seedDemoData(): Promise<void> {
  const database = getDb();
  if (!database) return;

  // Re-seed if data is missing or stale (picture URLs changed)
  const existing = await database.conversations.count();
  if (existing > 0) {
    const first = await database.conversations.toCollection().first();
    const pic = first?.participantPictures?.[0] || '';
    // Re-seed if the stored picture URL isn't one the current demo assets use
    // (e.g. a portrait filename changed). Comparing against the full set works
    // even though conversations are shuffled at seed time.
    const validPics = new Set(DEMO_PEOPLE.map((p) => p.picture));
    if (validPics.has(pic)) return;
    // Clear stale data before re-seeding
    await database.conversations.clear();
    await database.messages.clear();
    await database.profiles.clear();
  }

  const now = Date.now();
  const people = shuffle([...DEMO_PEOPLE]);
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const profiles: Profile[] = [];

  for (let i = 0; i < 25; i++) {
    const person = people[i % people.length];
    const convId = `demo-conv-${i}`;
    const personUrn = `urn:li:fsd_profile:demo-${i}`;
    const fullName = `${person.firstName} ${person.lastName}`;

    // Vary read/unread, category, starred
    const isUnread = i < 5; // first 5 are unread
    const category =
      i < 15 ? 'PRIMARY_INBOX' :
      i < 22 ? 'SECONDARY_INBOX' :
      'ARCHIVE';
    const starred = i === 0 || i === 3 || i === 7 ? 1 : 0;

    // Generate messages
    const msgCount = randInt(5, 15);
    const convStart = now - (25 - i) * 3600_000 * randInt(2, 12);
    let lastBody = '';
    let lastActivityAt = convStart;

    for (let m = 0; m < msgCount; m++) {
      const isFromMe = m % 3 === 1 || m % 5 === 3; // roughly 40% outbound
      const body = isFromMe
        ? pick(DEMO_MESSAGES_OUTBOUND)
        : pick(DEMO_MESSAGES_INBOUND);
      const createdAt = convStart + m * randInt(60_000, 1_800_000);
      lastBody = body;
      lastActivityAt = createdAt;

      messages.push({
        id: `demo-msg-${i}-${m}`,
        conversationId: convId,
        senderUrn: isFromMe ? DEMO_ME_URN : personUrn,
        senderName: isFromMe ? 'You' : fullName,
        senderPicture: isFromMe ? '' : person.picture,
        body,
        createdAt,
        isFromMe,
        status: 'sent',
      });
    }

    conversations.push({
      id: convId,
      participantUrns: [personUrn],
      participantNames: [fullName],
      participantPictures: [person.picture],
      lastMessage: lastBody,
      lastActivityAt,
      read: isUnread ? 0 : 1,
      archived: category === 'ARCHIVE' ? 1 : 0,
      category,
      hasAttachments: 0,
      starred,
    });

    profiles.push({
      urn: personUrn,
      publicId: `${person.firstName.toLowerCase()}-${person.lastName.toLowerCase()}`,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName,
      occupation: `${person.title} at ${person.company}`,
      location: '',
      pictureUrl: person.picture,
      company: person.company,
      title: person.title,
    });
  }

  await database.conversations.bulkPut(conversations);
  await database.messages.bulkPut(messages);
  await database.profiles.bulkPut(profiles);
}

// ── Bridge message handler ─────────────────────────────────────────────────

export async function handleDemoBridgeMessage(msg: BridgeMessage): Promise<BridgeResponse> {
  switch (msg.type) {
    case 'CHECK_AUTH':
      return {
        success: true,
        data: {
          authenticated: true,
          memberUrn: DEMO_ME_URN,
          displayName: 'Demo User',
          profilePicture: '',
        },
      };

    case 'SYNC_CONVERSATIONS':
    case 'SYNC_CATEGORY':
    case 'BURST_DISCOVER':
    case 'REEVAL_BACKFILL_WINDOW':
    case 'TOGGLE_SYNC_PAUSE':
    case 'RESET_SYNC_STATE':
    case 'PREFETCH_MESSAGES':
      return { success: true };

    case 'GET_SYNC_PROGRESS':
      return {
        success: true,
        data: {
          categories: { PRIMARY_INBOX: { phase: 'complete', totalDiscovered: 25 } },
          queue: { pending: 0, syncing: 0, done: 25, failed: 0, total: 25 },
        },
      };

    case 'GET_SSE_STATUS':
      return {
        success: true,
        data: { connected: true, mode: 'demo' },
      };

    case 'GET_DEBUG_LOGS':
      // Must match LogEntry[] shape (DebugPanel/report-a-bug expect objects, not strings).
      return { success: true, data: [] };

    case 'CLEAR_DEBUG_LOGS':
      return { success: true };

    case 'FETCH_MESSAGES':
      return { success: true };

    case 'SEND_MESSAGE': {
      const { conversationId } = msg;
      scheduleAutoReply(conversationId);
      return { success: true };
    }

    case 'CREATE_CONVERSATION':
      return { success: true, data: { conversationId: `demo-conv-new-${Date.now()}` } };

    case 'FETCH_PROFILE_BY_URN': {
      const database = getDb();
      if (!database) return { success: true, data: null };
      const profile = await database.profiles.get(msg.urn);
      return { success: true, data: profile ?? null };
    }

    case 'FETCH_POST':
      return { success: true, data: null };

    case 'SEARCH_CONVERSATIONS':
      // useRemoteSearch reads data.conversationIds / data.nextCursor.
      return { success: true, data: { conversationIds: [], nextCursor: null } };

    case 'TYPEAHEAD_SEARCH':
      // searchTypeahead callers expect an array of results.
      return { success: true, data: [] };

    case 'DIAGNOSTIC_SYNC':
      return { success: true, data: { status: 'demo' } };

    case 'RESET_DB': {
      const database = getDb();
      if (database) {
        await database.conversations.clear();
        await database.messages.clear();
        await database.profiles.clear();
      }
      return { success: true };
    }

    // All mutation messages — the optimistic layer already updated the DB
    case 'ARCHIVE':
    case 'UNARCHIVE':
    case 'MOVE_TO_OTHER':
    case 'MOVE_TO_FOCUSED':
    case 'MOVE_TO_SPAM':
    case 'MARK_READ':
    case 'MARK_UNREAD':
    case 'DELETE_CONVERSATION':
    case 'STAR':
    case 'UNSTAR':
    case 'EDIT_MESSAGE':
    case 'REACT_EMOJI':
    case 'RECALL_MESSAGE':
      return { success: true };

    default:
      return { success: true };
  }
}

// ── Auto-reply ─────────────────────────────────────────────────────────────

// Track pending auto-reply timers so they can be cancelled on teardown and don't
// fire (writing to the DB / dispatching events) after demo mode is stopped.
const autoReplyTimers = new Set<ReturnType<typeof setTimeout>>();

function scheduleAutoReply(conversationId: string): void {
  const delay = randInt(1000, 5000);
  let timer: ReturnType<typeof setTimeout>;
  timer = setTimeout(async () => {
    autoReplyTimers.delete(timer);
    try {
      const database = getDb();
      if (!database) return;

      const conv = await database.conversations.get(conversationId);
      if (!conv) return;

      const senderUrn = conv.participantUrns[0];
      const senderName = conv.participantNames[0];
      const senderPicture = conv.participantPictures[0] || '';
      const body = pick(DEMO_MESSAGES_INBOUND);
      const now = Date.now();

      await database.messages.put({
        id: `demo-reply-${now}`,
        conversationId,
        senderUrn,
        senderName,
        senderPicture,
        body,
        createdAt: now,
        isFromMe: false,
        status: 'sent',
      });

      await database.conversations.update(conversationId, {
        lastMessage: body,
        lastActivityAt: now,
        read: 0,
      });

      window.dispatchEvent(
        new CustomEvent('inflow:demo-incoming', {
          detail: {
            id: `demo-reply-${now}`,
            senderName,
            senderPicture,
            body,
            conversationId,
          },
        }),
      );
    } catch {
      // Silently ignore errors in demo auto-reply
    }
  }, delay);
  autoReplyTimers.add(timer);
}

// ── Incoming conversation simulator ────────────────────────────────────────

let incomingTimer: ReturnType<typeof setTimeout> | null = null;
let usedPeopleIndexes = new Set<number>();

export function startDemoIncoming(): void {
  if (incomingTimer) return;
  usedPeopleIndexes.clear();

  const firstDelay = randInt(10_000, 25_000);
  incomingTimer = setTimeout(() => createIncomingConversation(true), firstDelay);
}

export function stopDemoIncoming(): void {
  if (incomingTimer) {
    clearTimeout(incomingTimer);
    incomingTimer = null;
  }
  // Cancel any pending auto-replies so they don't fire after teardown.
  for (const t of autoReplyTimers) clearTimeout(t);
  autoReplyTimers.clear();
  usedPeopleIndexes.clear();
}

async function createIncomingConversation(scheduleNext: boolean): Promise<void> {
  try {
    const database = getDb();
    if (!database) return;

    let personIdx = randInt(0, DEMO_PEOPLE.length - 1);
    let attempts = 0;
    while (usedPeopleIndexes.has(personIdx) && attempts < DEMO_PEOPLE.length) {
      personIdx = (personIdx + 1) % DEMO_PEOPLE.length;
      attempts++;
    }
    if (attempts >= DEMO_PEOPLE.length) {
      usedPeopleIndexes.clear();
    }
    usedPeopleIndexes.add(personIdx);

    const person = DEMO_PEOPLE[personIdx];
    const now = Date.now();
    const convId = `demo-incoming-${now}`;
    const personUrn = `urn:li:fsd_profile:demo-inc-${now}`;
    const fullName = `${person.firstName} ${person.lastName}`;
    const body = pick(DEMO_OPENERS);

    await database.conversations.put({
      id: convId,
      participantUrns: [personUrn],
      participantNames: [fullName],
      participantPictures: [person.picture],
      lastMessage: body,
      lastActivityAt: now,
      read: 0,
      archived: 0,
      category: 'PRIMARY_INBOX',
      hasAttachments: 0,
      starred: 0,
    });

    await database.messages.put({
      id: `demo-inc-msg-${now}`,
      conversationId: convId,
      senderUrn: personUrn,
      senderName: fullName,
      senderPicture: person.picture,
      body,
      createdAt: now,
      isFromMe: false,
      status: 'sent',
    });

    await database.profiles.put({
      urn: personUrn,
      publicId: `${person.firstName.toLowerCase()}-${person.lastName.toLowerCase()}-${now}`,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName,
      occupation: `${person.title} at ${person.company}`,
      location: '',
      pictureUrl: person.picture,
      company: person.company,
      title: person.title,
    });

    window.dispatchEvent(
      new CustomEvent('inflow:demo-incoming', {
        detail: {
          id: `demo-inc-msg-${now}`,
          senderName: fullName,
          senderPicture: person.picture,
          body,
          conversationId: convId,
        },
      }),
    );
  } catch {
    // Silently ignore errors
  }

  if (scheduleNext) {
    const nextDelay = randInt(45_000, 75_000);
    incomingTimer = setTimeout(() => createIncomingConversation(true), nextDelay);
  }
}

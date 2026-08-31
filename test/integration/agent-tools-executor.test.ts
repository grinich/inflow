/**
 * The agent-tools executor end to end against a real (fake-indexeddb) Dexie
 * database and a spied bridge: settings gating, every v1 tool's happy path
 * and fallbacks, the send cap, local echoes, toasts, and error shapes.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
} from '@/lib/agent-settings';
import {
  AGENT_SEND_CAP_PER_HOUR,
  AGENT_SEND_TIMESTAMPS_KEY,
} from '@/lib/agent-tools/send-cap';
import { makeConversation, makeMessage, resetFactories } from '../fixtures/factories';
import { setLocalStore } from '../mocks/chrome';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

import { callTool, listTools } from '@/lib/agent-tools/executor';
import { useUIStore } from '@/store/ui-store';

function enable(opts: { reads?: boolean; writes?: boolean } = {}) {
  setLocalStore(AGENT_TOOLS_ENABLED_KEY, opts.reads !== false);
  setLocalStore(AGENT_WRITES_ENABLED_KEY, opts.writes === true);
}

function parse(result: { content: [{ text: string }]; isError?: boolean }) {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

beforeEach(async () => {
  resetFactories();
  testDb = new Dexie(`TestDB_agent_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  useUIStore.setState({ toast: null });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('gating', () => {
  it('reads disabled: every call errors with the enable hint, tool list is empty', async () => {
    const result = await callTool('get_unread_count', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Agent access is disabled');
    expect(result.content[0].text).toContain('Configure agent access');

    const list = await listTools();
    expect(list).toEqual({ tools: [], readsEnabled: false, writesEnabled: false });
  });

  it('reads on, writes off: write tools error and are not advertised', async () => {
    enable();
    const result = await callTool('send_message', { conversationId: 'x', body: 'hi' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('write actions are disabled');

    const list = await listTools();
    expect(list.readsEnabled).toBe(true);
    expect(list.writesEnabled).toBe(false);
    expect(list.tools.some((t) => t.name === 'list_conversations')).toBe(true);
    expect(list.tools.some((t) => t.name === 'send_message')).toBe(false);
  });

  it('both on: full catalog advertised with schemas', async () => {
    enable({ writes: true });
    const list = await listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      'archive_conversation', 'get_unread_count', 'list_conversations',
      'list_invitations', 'mark_read', 'mark_unread', 'read_thread',
      'search_conversations', 'send_message',
    ]);
    for (const t of list.tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('unknown tool and validation failures produce actionable errors', async () => {
    enable({ writes: true });
    const unknown = await callTool('rm_rf', {});
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain('unknown tool "rm_rf"');

    const invalid = await callTool('send_message', { conversationId: 'x' });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toContain('missing required parameter "body"');

    const typo = await callTool('list_conversations', { tabb: 'focused' });
    expect(typo.isError).toBe(true);
    expect(typo.content[0].text).toContain('unknown parameter "tabb"');
  });

  it('db not open yet: clean error, not a crash', async () => {
    enable();
    testDb = null;
    const result = await callTool('get_unread_count', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no open database');
  });
});

describe('read tools', () => {
  beforeEach(() => enable());

  it('list_conversations filters by tab, applies the search grammar, and slices to limit', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'f1', read: 0, lastActivityAt: 4000 }),
      makeConversation({ id: 'f2', read: 1, lastActivityAt: 3000 }),
      makeConversation({ id: 'arch', archived: 1, category: 'ARCHIVE', lastActivityAt: 2000 }),
      makeConversation({ id: 'spam', category: 'SPAM', lastActivityAt: 1000 }),
    ]);

    const focused = parse(await callTool('list_conversations', {}));
    expect(focused.conversations.map((c: any) => c.id)).toEqual(['f1', 'f2']);
    expect(focused.total).toBe(2);
    expect(focused.conversations[0].unread).toBe(true);

    const archived = parse(await callTool('list_conversations', { tab: 'archived' }));
    expect(archived.conversations.map((c: any) => c.id)).toEqual(['arch']);

    const unread = parse(await callTool('list_conversations', { query: 'is:unread' }));
    expect(unread.conversations.map((c: any) => c.id)).toEqual(['f1']);

    const limited = parse(await callTool('list_conversations', { limit: 1 }));
    expect(limited.conversations).toHaveLength(1);
    expect(limited.total).toBe(2); // pre-slice count
  });

  it('read_thread refreshes via the bridge, reads merge siblings, dedups, and serializes', async () => {
    const urn = 'urn:li:fsd_profile:same-person';
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'main', participantUrns: [urn], lastActivityAt: 2000 }),
      makeConversation({ id: 'sibling', participantUrns: [urn], lastActivityAt: 1000 }),
    ]);
    const t = Date.parse('2026-03-01T10:00:00Z');
    await testDb.messages.bulkPut([
      makeMessage({ id: 'urn:li:msg_message:1', conversationId: 'main', createdAt: t, senderUrn: 'u1', body: 'hello' }),
      // SSE duplicate of the same logical message — must be deduped away
      makeMessage({ id: 'urn:li:fsd_message:1', conversationId: 'main', createdAt: t, senderUrn: 'u1', body: 'hello' }),
      makeMessage({ id: 'urn:li:msg_message:2', conversationId: 'sibling', createdAt: t + 1000, senderUrn: 'u2', body: 'from the sibling thread' }),
    ]);

    const data = parse(await callTool('read_thread', { conversationId: 'main' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'FETCH_MESSAGES', conversationId: 'main' });
    expect(data.refreshed).toBe(true);
    expect(data.conversation.id).toBe('main');
    expect(data.messages.map((m: any) => m.body)).toEqual(['hello', 'from the sibling thread']);
  });

  it('read_thread serves cache with refreshed:false when the bridge fails, and skips it with refresh:false', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c1' }));
    await testDb.messages.put(makeMessage({ conversationId: 'c1' }));

    mockSendBridgeMessage.mockResolvedValue({ success: false, error: 'offline' });
    const data = parse(await callTool('read_thread', { conversationId: 'c1' }));
    expect(data.refreshed).toBe(false);
    expect(data.messages).toHaveLength(1);

    mockSendBridgeMessage.mockClear();
    const cached = parse(await callTool('read_thread', { conversationId: 'c1', refresh: false }));
    expect(mockSendBridgeMessage).not.toHaveBeenCalled();
    expect(cached.refreshed).toBe(false);
  });

  it('read_thread on an unknown id points the agent to list_conversations', async () => {
    const result = await callTool('read_thread', { conversationId: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
    expect(result.content[0].text).toContain('list_conversations');
  });

  it('search_conversations reads back the ids the background merged into Dexie', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'hit1' }),
      makeConversation({ id: 'hit2' }),
    ]);
    mockSendBridgeMessage.mockResolvedValue({
      success: true,
      data: { conversationIds: ['hit1', 'hit2', 'not-synced-yet'], nextCursor: 'abc' },
    });
    const data = parse(await callTool('search_conversations', { query: 'jane' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'SEARCH_CONVERSATIONS', query: 'jane' });
    expect(data.source).toBe('linkedin');
    expect(data.nextCursor).toBe('abc');
    expect(data.conversations.map((c: any) => c.id)).toEqual(['hit1', 'hit2']); // missing row dropped
  });

  it('search_conversations degrades to the local cache when the bridge fails', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'jane', participantNames: ['Jane Doe'] }),
      makeConversation({ id: 'other', participantNames: ['Someone Else'] }),
    ]);
    mockSendBridgeMessage.mockRejectedValue(new Error('no receiver'));
    const data = parse(await callTool('search_conversations', { query: 'jane' }));
    expect(data.source).toBe('local-cache');
    expect(data.conversations.map((c: any) => c.id)).toEqual(['jane']);
  });

  it('get_unread_count counts unread focused conversations', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ read: 0 }),
      makeConversation({ read: 0, archived: 1, category: 'ARCHIVE' }), // not focused
      makeConversation({ read: 1 }),
    ]);
    expect(parse(await callTool('get_unread_count', {}))).toEqual({ focusedUnread: 1 });
  });

  it('list_invitations refreshes best-effort and serializes pending rows newest-first', async () => {
    await testDb.invitations.bulkPut([
      {
        id: 'inv1', sharedSecret: 's', fromUrn: 'u1', name: 'Ada', headline: 'Engineer',
        pictureUrl: '', publicId: 'ada', message: 'hi!', sentAt: 1000, status: 'pending',
        mutualCount: 3, mutualNames: [], mutualPictures: [],
      },
      {
        id: 'inv2', sharedSecret: 's', fromUrn: 'u2', name: 'Bob', headline: 'PM',
        pictureUrl: '', publicId: 'bob', message: '', sentAt: 2000, status: 'pending',
        mutualCount: 0, mutualNames: [], mutualPictures: [],
      },
      {
        id: 'inv3', sharedSecret: 's', fromUrn: 'u3', name: 'Eve', headline: '',
        pictureUrl: '', publicId: 'eve', message: '', sentAt: 3000, status: 'accepted',
        mutualCount: 0, mutualNames: [], mutualPictures: [],
      },
    ]);
    mockSendBridgeMessage.mockResolvedValue({ success: false }); // refresh failure is fine
    const data = parse(await callTool('list_invitations', {}));
    expect(data.invitations.map((i: any) => i.id)).toEqual(['inv2', 'inv1']);
    expect(data.invitations[1].note).toBe('hi!');
    expect('note' in data.invitations[0]).toBe(false);
  });
});

describe('write tools', () => {
  beforeEach(() => enable({ writes: true }));

  it('send_message bridges, records the send, toasts, and reports the recipient', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c1', participantNames: ['Jane Doe'] })
    );
    const data = parse(await callTool('send_message', { conversationId: 'c1', body: ' hi there ' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({
      type: 'SEND_MESSAGE', conversationId: 'c1', body: 'hi there',
    });
    expect(data).toEqual({ sent: true, conversationId: 'c1', to: ['Jane Doe'] });
    expect(useUIStore.getState().toast?.message).toBe('Agent sent a message to Jane Doe');
    const stored = await chrome.storage.local.get(AGENT_SEND_TIMESTAMPS_KEY);
    expect(stored[AGENT_SEND_TIMESTAMPS_KEY]).toHaveLength(1);
  });

  it('send_message enforces the hourly cap', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c1' }));
    setLocalStore(
      AGENT_SEND_TIMESTAMPS_KEY,
      Array.from({ length: AGENT_SEND_CAP_PER_HOUR }, () => Date.now())
    );
    const result = await callTool('send_message', { conversationId: 'c1', body: 'hi' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`send limit reached (${AGENT_SEND_CAP_PER_HOUR}/hour)`);
    expect(mockSendBridgeMessage).not.toHaveBeenCalled();
  });

  it('send_message rejects an all-whitespace body and surfaces bridge errors', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c1' }));
    const blank = await callTool('send_message', { conversationId: 'c1', body: '   ' });
    expect(blank.isError).toBe(true);
    expect(blank.content[0].text).toContain('must not be empty');

    mockSendBridgeMessage.mockResolvedValue({ success: false, error: 'LinkedIn said no' });
    const failed = await callTool('send_message', { conversationId: 'c1', body: 'hi' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('LinkedIn said no');
    expect(useUIStore.getState().toast).toBeNull(); // no toast on failure
  });

  it('archive_conversation bridges and writes the local echo (both directions)', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c1', archived: 0 }));
    parse(await callTool('archive_conversation', { conversationId: 'c1' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'ARCHIVE', conversationId: 'c1' });
    expect((await testDb.conversations.get('c1')).archived).toBe(1);
    expect(useUIStore.getState().toast?.message).toContain('Agent archived');

    parse(await callTool('archive_conversation', { conversationId: 'c1', unarchive: true }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'UNARCHIVE', conversationId: 'c1' });
    expect((await testDb.conversations.get('c1')).archived).toBe(0);
  });

  it('mark_read / mark_unread bridge and echo the read flag', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c1', read: 0 }));
    parse(await callTool('mark_read', { conversationId: 'c1' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_READ', conversationId: 'c1' });
    expect((await testDb.conversations.get('c1')).read).toBe(1);

    parse(await callTool('mark_unread', { conversationId: 'c1' }));
    expect(mockSendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_UNREAD', conversationId: 'c1' });
    expect((await testDb.conversations.get('c1')).read).toBe(0);
  });

  it('write tools verify the conversation exists BEFORE bridging', async () => {
    const result = await callTool('archive_conversation', { conversationId: 'ghost' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
    expect(mockSendBridgeMessage).not.toHaveBeenCalled();
  });
});

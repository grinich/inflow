/**
 * MCP read tools — the toolbox inflow exposes to Claude. Verifies each tool's
 * shape and filtering over a real (fake-indexeddb) database.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { toolDescriptors, callTool } from '@/lib/mcp/tools';
import type { Connection } from '@/types/connection';

function conn(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'urn:li:fsd_profile:' + Math.random().toString(36).slice(2),
    connectionUrn: 'urn:li:fsd_connection:C',
    connectedAt: 1000,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

function conv(over: Partial<any>): any {
  return {
    id: 'c' + Math.random().toString(36).slice(2),
    participantUrns: [],
    participantNames: ['Someone'],
    participantPictures: [],
    lastMessage: '',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  };
}

function msg(over: Partial<any>): any {
  return {
    id: 'm' + Math.random().toString(36).slice(2),
    conversationId: 'c1',
    senderUrn: 'urn:li:fsd_profile:X',
    senderName: 'Ada',
    senderPicture: '',
    body: '',
    createdAt: 1000,
    isFromMe: false,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('MEMBER_MCP');
  await db!.connections.clear();
  await db!.conversations.clear();
  await db!.messages.clear();
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_MCP').catch(() => {});
});

it('advertises the read tools plus create_draft, and never a send tool', () => {
  const names = toolDescriptors().map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'list_connections', 'search_connections', 'get_connection',
      'get_network_stats', 'get_conversation_summary', 'create_draft',
      'search_messages', 'list_conversations', 'get_thread', 'find_stale_connections',
    ]),
  );
  // The only write is create_draft (Outbox). Nothing may send on the user's behalf.
  expect(names.some((n) => /send/i.test(n))).toBe(false);
  for (const t of toolDescriptors()) expect(t.inputSchema).toHaveProperty('type', 'object');
});

it('list_connections filters by role and interest', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada', roleCategory: 'Investor', interestTags: ['Investors'], connectedAt: 3 }),
    conn({ profileUrn: 'b', fullName: 'Alan', roleCategory: 'Engineering', connectedAt: 2 }),
    conn({ profileUrn: 'c', fullName: 'Grace', roleCategory: 'Investor', connectedAt: 1 }),
  ]);

  const byRole: any = await callTool('list_connections', { role: 'Investor' });
  expect(byRole.total).toBe(2);
  expect(byRole.results.map((r: any) => r.name)).toEqual(['Ada', 'Grace']); // most recent first

  const byInterest: any = await callTool('list_connections', { interest: 'Investors' });
  expect(byInterest.total).toBe(1);
  expect(byInterest.results[0].name).toBe('Ada');
});

it('search_connections matches name and headline', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada Lovelace', headline: 'Mathematician' }),
    conn({ profileUrn: 'b', fullName: 'Alan Turing', headline: 'Cryptanalyst at Bletchley' }),
  ]);
  const byName: any = await callTool('search_connections', { query: 'ada' });
  expect(byName.results.map((r: any) => r.name)).toEqual(['Ada Lovelace']);
  const byHeadline: any = await callTool('search_connections', { query: 'bletchley' });
  expect(byHeadline.results.map((r: any) => r.name)).toEqual(['Alan Turing']);
});

it('get_connection returns full detail incl. conversation summary', async () => {
  await db!.connections.add(
    conn({ profileUrn: 'a', publicId: 'ada', fullName: 'Ada', aiSummary: 'A pioneer', conversationSummary: 'Chatted about looms' }),
  );
  const res: any = await callTool('get_connection', { publicId: 'ada' });
  expect(res.found).toBe(true);
  expect(res.connection.summary).toBe('A pioneer');
  expect(res.connection.conversationSummary).toBe('Chatted about looms');

  const miss: any = await callTool('get_connection', { profileUrn: 'nope' });
  expect(miss.found).toBe(false);
});

it('get_network_stats summarizes roles and firms', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada', roleCategory: 'Investor', headline: 'Partner at Acme', categorizedAt: 1 }),
    conn({ profileUrn: 'b', fullName: 'Al', roleCategory: 'Investor', headline: 'GP at Acme', categorizedAt: 1 }),
    conn({ profileUrn: 'c', fullName: 'Gr', roleCategory: 'Founder', headline: 'CEO at Solo', categorizedAt: 1 }),
  ]);
  const res: any = await callTool('get_network_stats', {});
  expect(res.total).toBe(3);
  const investor = res.roles.find((r: any) => r.role === 'Investor');
  expect(investor.count).toBe(2);
  expect(res.topFirms.find((f: any) => f.name === 'Acme').count).toBe(2);
});

it('create_draft adds a draft to the Outbox for an existing connection (never sends)', async () => {
  await db!.connections.add(conn({ profileUrn: 'urn:li:fsd_profile:Z', publicId: 'zack', fullName: 'Zack Allen' }));
  const res: any = await callTool('create_draft', { profileUrn: 'urn:li:fsd_profile:Z', body: 'Hi Zack' });
  expect(res).toMatchObject({ created: true, recipient: 'Zack Allen', status: 'draft' });

  const rows = await db!.scheduledMessages.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipientUrns: ['urn:li:fsd_profile:Z'], body: 'Hi Zack', status: 'draft' });
  // Nothing is ever sent.
  expect(rows[0].status).not.toBe('sent');
});

it('create_draft can schedule (still not sent) and validates input', async () => {
  await db!.connections.add(conn({ profileUrn: 'urn:li:fsd_profile:Z', publicId: 'zack', fullName: 'Zack Allen' }));

  const when = new Date(Date.now() + 3600_000).toISOString();
  const res: any = await callTool('create_draft', { publicId: 'zack', body: 'Later', scheduleAt: when });
  expect(res.status).toBe('scheduled');
  const row = (await db!.scheduledMessages.toArray()).find((r) => r.body === 'Later')!;
  expect(row.scheduledAt).toBe(new Date(when).getTime());

  await expect(callTool('create_draft', { profileUrn: 'urn:li:fsd_profile:Z', body: '' })).rejects.toThrow(/body/i);
  // A stranger's URN is allowed (that's InMail), but it still has to be a URN.
  await expect(callTool('create_draft', { profileUrn: 'nope', body: 'hi' })).rejects.toThrow(/well-formed/i);
  await expect(callTool('create_draft', { publicId: 'stranger', body: 'hi' })).rejects.toThrow(/not found/i);
});

it('create_draft queues an InMail for someone outside the network', async () => {
  const res: any = await callTool('create_draft', {
    profileUrn: 'urn:li:fsd_profile:COLD',
    recipientName: 'Dana Cold',
    inMailSubject: 'Working smarter at Acme',
    body: 'Hi Dana — saw your billing team is growing.',
  });
  expect(res).toMatchObject({ created: true, recipient: 'Dana Cold', status: 'draft', inMail: true });

  const row = (await db!.scheduledMessages.toArray())[0];
  // The subject on the row is what makes this send as an InMail later, rather
  // than silently going out as a normal message that LinkedIn would reject.
  expect(row.inMailSubject).toBe('Working smarter at Acme');
  expect(row.recipientUrns).toEqual(['urn:li:fsd_profile:COLD']);
  expect(row.status).toBe('draft');
});

it('create_draft requires a subject for a stranger and refuses one for a connection', async () => {
  await db!.connections.add(conn({ profileUrn: 'urn:li:fsd_profile:Z', publicId: 'zack', fullName: 'Zack Allen' }));

  // No subject for a non-connection: the draft could only ever go out as InMail.
  await expect(
    callTool('create_draft', { profileUrn: 'urn:li:fsd_profile:COLD', body: 'hi' }),
  ).rejects.toThrow(/inMailSubject is required/i);

  // Subject for a connection: messaging them is free, so this would burn a
  // credit on something LinkedIn gives away.
  await expect(
    callTool('create_draft', { profileUrn: 'urn:li:fsd_profile:Z', body: 'hi', inMailSubject: 'Hello' }),
  ).rejects.toThrow(/first-degree/i);

  await expect(
    callTool('create_draft', {
      profileUrn: 'urn:li:fsd_profile:COLD',
      body: 'hi',
      inMailSubject: 'x'.repeat(201),
    }),
  ).rejects.toThrow(/200 characters/i);

  expect(await db!.scheduledMessages.count()).toBe(0);
});

it('throws on an unknown tool', async () => {
  await expect(callTool('delete_everything', {})).rejects.toThrow(/unknown tool/i);
});

// --- Inbox / history tools -------------------------------------------------

describe('search_messages', () => {
  beforeEach(async () => {
    await db!.conversations.bulkAdd([
      conv({ id: 'c1', participantNames: ['Ada Lovelace'], participantUrns: ['urn:a'] }),
      conv({ id: 'c2', participantNames: ['Bo Chen'], participantUrns: ['urn:b'] }),
    ]);
    await db!.messages.bulkAdd([
      msg({ conversationId: 'c1', body: 'Can we revisit the pricing next week?', createdAt: 100, isFromMe: false, senderName: 'Ada Lovelace' }),
      msg({ conversationId: 'c1', body: 'Sure — sending our PRICING sheet now.', createdAt: 200, isFromMe: true }),
      msg({ conversationId: 'c2', body: 'Unrelated chatter', createdAt: 300, isFromMe: false, senderName: 'Bo Chen' }),
    ]);
  });

  it('finds matches case-insensitively, newest first, with who and a snippet', async () => {
    const r: any = await callTool('search_messages', { query: 'pricing' });
    expect(r.returned).toBe(2);
    expect(r.results[0].from).toBe('You'); // newest match first
    expect(r.results[0].snippet).toMatch(/PRICING/);
    expect(r.results[1].with).toEqual(['Ada Lovelace']);
  });

  it('filters by sender and by conversation', async () => {
    const mine: any = await callTool('search_messages', { query: 'pricing', from: 'me' });
    expect(mine.returned).toBe(1);
    expect(mine.results[0].from).toBe('You');

    const theirs: any = await callTool('search_messages', { query: 'pricing', from: 'them' });
    expect(theirs.returned).toBe(1);
    expect(theirs.results[0].from).toBe('Ada Lovelace');

    const scoped: any = await callTool('search_messages', { query: 'chatter', conversationId: 'c1' });
    expect(scoped.returned).toBe(0);
  });

  it('honours `since` and returns nothing for an empty query', async () => {
    const recent: any = await callTool('search_messages', { query: 'pricing', since: new Date(150).toISOString() });
    expect(recent.returned).toBe(1);
    expect(await callTool('search_messages', { query: '  ' })).toMatchObject({ returned: 0 });
  });
});

describe('list_conversations', () => {
  beforeEach(async () => {
    await db!.conversations.bulkAdd([
      conv({ id: 'c1', participantNames: ['Ada'], lastActivityAt: 300, read: 0 }),
      conv({ id: 'c2', participantNames: ['Bo'], lastActivityAt: 200, read: 1 }),
      conv({ id: 'c3', participantNames: ['Cy'], lastActivityAt: 100, archived: 1 }),
      conv({ id: 'c4', participantNames: ['Draft'], lastActivityAt: 400, draft: 1 }),
    ]);
    await db!.messages.bulkAdd([
      msg({ conversationId: 'c1', createdAt: 300, isFromMe: false }), // awaiting reply
      msg({ conversationId: 'c2', createdAt: 200, isFromMe: true }),  // we replied last
    ]);
  });

  it('defaults to active conversations, newest first, and skips drafts/archived', async () => {
    const r: any = await callTool('list_conversations', {});
    expect(r.results.map((x: any) => x.conversationId)).toEqual(['c1', 'c2']);
    expect(r.results[0].unread).toBe(true);
  });

  it('filters to unread, to archived, and to those awaiting the user\'s reply', async () => {
    expect((await callTool('list_conversations', { status: 'unread' }) as any).results.map((x: any) => x.conversationId)).toEqual(['c1']);
    expect((await callTool('list_conversations', { status: 'archived' }) as any).results.map((x: any) => x.conversationId)).toEqual(['c3']);

    const awaiting: any = await callTool('list_conversations', { awaitingReply: true });
    expect(awaiting.results.map((x: any) => x.conversationId)).toEqual(['c1']);
    expect(awaiting.results[0].awaitingYourReply).toBe(true);
  });
});

describe('get_thread', () => {
  beforeEach(async () => {
    await db!.conversations.add(conv({ id: 'c1', participantNames: ['Ada'], participantUrns: ['urn:a'] }));
    await db!.messages.bulkAdd([
      msg({ conversationId: 'c1', body: 'first', createdAt: 100, isFromMe: false, senderName: 'Ada' }),
      msg({ conversationId: 'c1', body: 'second', createdAt: 200, isFromMe: true }),
    ]);
  });

  it('returns messages oldest to newest with speakers', async () => {
    const r: any = await callTool('get_thread', { conversationId: 'c1' });
    expect(r.found).toBe(true);
    expect(r.messages.map((m: any) => [m.from, m.body])).toEqual([['Ada', 'first'], ['You', 'second']]);
  });

  it('resolves the thread by profileUrn, and reports not-found otherwise', async () => {
    expect((await callTool('get_thread', { profileUrn: 'urn:a' }) as any).conversationId).toBe('c1');
    expect(await callTool('get_thread', { profileUrn: 'urn:nope' })).toMatchObject({ found: false });
  });
});

describe('find_stale_connections', () => {
  it('lists never-messaged first, then longest-silent, honouring the cutoff', async () => {
    const now = Date.now();
    const old = now - 400 * 24 * 60 * 60 * 1000;   // ~13 months — stale
    const fresh = now - 5 * 24 * 60 * 60 * 1000;   // 5 days — not stale
    await db!.connections.bulkAdd([
      conn({ profileUrn: 'urn:never', fullName: 'Never Messaged' }),
      conn({ profileUrn: 'urn:old', fullName: 'Long Silent' }),
      conn({ profileUrn: 'urn:fresh', fullName: 'Recently Spoke' }),
    ]);
    await db!.conversations.bulkAdd([
      conv({ id: 'c1', participantUrns: ['urn:old'], lastActivityAt: old }),
      conv({ id: 'c2', participantUrns: ['urn:fresh'], lastActivityAt: fresh }),
    ]);

    const r: any = await callTool('find_stale_connections', { months: 6 });
    expect(r.results.map((x: any) => x.name)).toEqual(['Never Messaged', 'Long Silent']);
    expect(r.results[0].neverMessaged).toBe(true);
    expect(r.results[0].lastInteractionAt).toBeNull();
    expect(r.results[1].daysSinceLastInteraction).toBeGreaterThan(300);
  });

  it('can exclude never-messaged connections and filter by role', async () => {
    await db!.connections.bulkAdd([
      conn({ profileUrn: 'urn:never', fullName: 'Never', roleCategory: 'Founder' }),
      conn({ profileUrn: 'urn:never2', fullName: 'Never Investor', roleCategory: 'Investor' }),
    ]);
    expect((await callTool('find_stale_connections', { includeNeverMessaged: false }) as any).total).toBe(0);
    const byRole: any = await callTool('find_stale_connections', { role: 'Investor' });
    expect(byRole.results.map((x: any) => x.name)).toEqual(['Never Investor']);
  });
});

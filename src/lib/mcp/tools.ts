/**
 * MCP read tools — the "toolbox" inflow exposes to an external agent (Claude).
 *
 * These are transport-agnostic: pure async functions over the local database.
 * The bridge advertises {@link toolDescriptors} to the companion and routes
 * incoming calls through {@link callTool}. Tools are read-only except for one
 * write tool, `create_draft`, which only adds a draft to the local Outbox for
 * the user to review — nothing here ever sends a message or touches the account.
 *
 * Coverage: the network (list/search/get connection, network stats), the inbox
 * (list_conversations, get_thread, search_messages, get_conversation_summary),
 * relationship upkeep (find_stale_connections), and drafting (create_draft).
 */
import { db } from '@/db/database';
import { computeInsights, parseCompany } from '@/lib/connection-insights';
import type { Connection } from '@/types/connection';
import type { Conversation } from '@/types/conversation';

export interface McpToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (as MCP expects). */
  inputSchema: Record<string, unknown>;
}

export interface McpTool extends McpToolDescriptor {
  handler: (args: Record<string, any>) => Promise<unknown>;
}

/** Compact, agent-friendly view of a connection (drops heavy/UI-only fields). */
function shape(c: Connection) {
  return {
    name: c.fullName,
    profileUrn: c.profileUrn,
    publicId: c.publicId || undefined,
    headline: c.headline || undefined,
    company: parseCompany(c.headline || '') || undefined,
    role: c.roleCategory,
    interests: c.interestTags?.length ? c.interestTags : undefined,
    connectedAt: c.connectedAt || undefined,
    summary: c.aiSummary || undefined,
    hasConversation: !!c.conversationSummary,
  };
}

async function allConnections(): Promise<Connection[]> {
  if (!db) return [];
  return db.connections.toArray();
}

/** Clamp a caller-supplied limit into [1, max], falling back to `dflt`. */
function clampLimit(v: unknown, dflt: number, max: number): number {
  const n = Number(v);
  return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : dflt, 1), max);
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

/** Collapse whitespace and cut to `max` characters. */
function clip(s: string, max: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** A window of `body` centred on the first match of `q`, for search results. */
function snippet(body: string, q: string, span = 180): string {
  const flat = (body || '').replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(q);
  if (i < 0) return clip(flat, span);
  const start = Math.max(0, i - Math.floor(span / 3));
  const end = Math.min(flat.length, start + span);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}

/** Compact, agent-friendly view of a conversation. */
function convShape(c: Conversation) {
  return {
    conversationId: c.id,
    with: (c.participantNames || []).filter(Boolean),
    lastMessage: clip(c.lastMessage || '', 160),
    lastActivityAt: iso(c.lastActivityAt),
    unread: c.read === 0,
    archived: c.archived === 1,
    category: c.category || undefined,
  };
}

/** Was the most recent message in this conversation sent by the user? */
async function lastMessageFromMe(conversationId: string): Promise<boolean | undefined> {
  if (!db) return undefined;
  const last = await db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
    .last();
  return last ? last.isFromMe : undefined;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_connections',
    description:
      "List the user's LinkedIn connections, optionally filtered by role category or interest tag. Returns compact records; use get_connection for full detail.",
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role category to filter by, e.g. "Investor", "Founder".' },
        interest: { type: 'string', description: 'Interest tag to filter by, e.g. "Investors".' },
        limit: { type: 'number', description: 'Max results (default 50, max 200).' },
        offset: { type: 'number', description: 'Number of results to skip, for paging.' },
      },
      additionalProperties: false,
    },
    handler: async ({ role, interest, limit, offset }) => {
      const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const off = Math.max(Number(offset) || 0, 0);
      let list = await allConnections();
      if (role) list = list.filter((c) => c.roleCategory === role);
      if (interest) list = list.filter((c) => c.interestTags?.includes(interest));
      list.sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0));
      return { total: list.length, offset: off, results: list.slice(off, off + lim).map(shape) };
    },
  },
  {
    name: 'search_connections',
    description: "Search the user's connections by name or headline (case-insensitive substring).",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against name and headline.' },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async ({ query, limit }) => {
      const q = String(query || '').trim().toLowerCase();
      const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
      if (!q) return { total: 0, results: [] };
      const list = (await allConnections()).filter(
        (c) => c.fullName?.toLowerCase().includes(q) || (c.headline || '').toLowerCase().includes(q),
      );
      return { total: list.length, results: list.slice(0, lim).map(shape) };
    },
  },
  {
    name: 'get_connection',
    description:
      'Get full detail for one connection by profileUrn or publicId, including the AI summary and any conversation recap.',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrn: { type: 'string' },
        publicId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async ({ profileUrn, publicId }) => {
      const list = await allConnections();
      const c = list.find(
        (x) => (profileUrn && x.profileUrn === profileUrn) || (publicId && x.publicId === publicId),
      );
      if (!c) return { found: false };
      return {
        found: true,
        connection: {
          ...shape(c),
          conversationSummary: c.conversationSummary || undefined,
        },
      };
    },
  },
  {
    name: 'get_network_stats',
    description:
      "Summary statistics about the user's network: totals, breakdown by role, top firms, and interest-tag counts.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const insights = computeInsights(await allConnections());
      return {
        total: insights.total,
        categorized: insights.categorized,
        uncategorized: insights.uncategorized,
        roles: insights.roles.map((r) => ({ role: r.role, count: r.count })),
        topFirms: insights.companies.slice(0, 15),
        interests: insights.interests,
      };
    },
  },
  {
    name: 'get_conversation_summary',
    description:
      'Get the AI recap of the message history with one connection (by profileUrn). Returns the summary text, not raw messages.',
    inputSchema: {
      type: 'object',
      properties: { profileUrn: { type: 'string' } },
      required: ['profileUrn'],
      additionalProperties: false,
    },
    handler: async ({ profileUrn }) => {
      const list = await allConnections();
      const c = list.find((x) => x.profileUrn === profileUrn);
      if (!c) return { found: false };
      return {
        found: true,
        name: c.fullName,
        hasConversation: !!c.conversationSummary,
        conversationSummary: c.conversationSummary || undefined,
      };
    },
  },
  {
    name: 'search_messages',
    description:
      "Full-text search across the user's message history (case-insensitive substring over message bodies). Use this to recall what was discussed, with whom, and when — e.g. 'where did I talk about pricing'. Returns a snippet per match plus the conversation it belongs to; follow up with get_thread to read the surrounding conversation.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find in message bodies.' },
        from: {
          type: 'string',
          enum: ['anyone', 'me', 'them'],
          description: 'Restrict to messages the user sent ("me"), received ("them"), or either (default).',
        },
        conversationId: { type: 'string', description: 'Restrict to a single conversation.' },
        since: { type: 'string', description: 'Only messages at or after this ISO 8601 date.' },
        limit: { type: 'number', description: 'Max results, newest first (default 25, max 100).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async ({ query, from, conversationId, since, limit }) => {
      if (!db) return { returned: 0, results: [] };
      const q = String(query || '').trim().toLowerCase();
      if (!q) return { returned: 0, results: [] };
      const lim = clampLimit(limit, 25, 100);
      const sinceMs = since ? new Date(since).getTime() : NaN;
      const floor = Number.isFinite(sinceMs) ? sinceMs : 0;
      const who = from === 'me' ? 'me' : from === 'them' ? 'them' : 'anyone';

      const matches = await db.messages
        .orderBy('createdAt')
        .reverse()
        .filter((m) => {
          if (floor && m.createdAt < floor) return false;
          if (conversationId && m.conversationId !== conversationId) return false;
          if (who === 'me' && !m.isFromMe) return false;
          if (who === 'them' && m.isFromMe) return false;
          // An InMail's subject is part of what was said, so search it too.
          return (
            (m.body || '').toLowerCase().includes(q) ||
            (m.subject || '').toLowerCase().includes(q)
          );
        })
        .limit(lim)
        .toArray();

      const convIds = [...new Set(matches.map((m) => m.conversationId))];
      const convs = await db.conversations.bulkGet(convIds);
      const byId = new Map(convs.filter(Boolean).map((c) => [c!.id, c!]));

      return {
        returned: matches.length,
        // True when we stopped at the limit — ask for more or narrow the query.
        truncated: matches.length === lim,
        results: matches.map((m) => ({
          conversationId: m.conversationId,
          with: (byId.get(m.conversationId)?.participantNames || []).filter(Boolean),
          from: m.isFromMe ? 'You' : m.senderName || 'Them',
          at: iso(m.createdAt),
          // Only InMail has one; it marks the message as an InMail too.
          ...(m.subject ? { subject: m.subject } : {}),
          snippet: snippet(`${m.subject ? m.subject + ' — ' : ''}${m.body || ''}`, q),
        })),
      };
    },
  },
  {
    name: 'list_conversations',
    description:
      "List the user's conversations (inbox state): who it's with, the last message, when, unread/archived status, and whether the last message came from the other person (i.e. it's awaiting the user's reply). Use for triage; read one with get_thread.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'unread', 'archived', 'all'],
          description: 'Which conversations to include. Default "active" (not archived).',
        },
        category: {
          type: 'string',
          description: 'LinkedIn inbox category, e.g. "PRIMARY_INBOX" or "SECONDARY_INBOX".',
        },
        awaitingReply: {
          type: 'boolean',
          description: "Only conversations whose last message was from the other person.",
        },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
        offset: { type: 'number', description: 'Number of results to skip, for paging.' },
      },
      additionalProperties: false,
    },
    handler: async ({ status, category, awaitingReply, limit, offset }) => {
      if (!db) return { returned: 0, results: [] };
      const lim = clampLimit(limit, 25, 100);
      const off = Math.max(Number(offset) || 0, 0);
      const st = status || 'active';
      // Determining "awaiting reply" needs the last message of each candidate,
      // so bound how many we inspect rather than walking the whole inbox.
      const SCAN_CAP = 300;

      const candidates = await db.conversations
        .orderBy('lastActivityAt')
        .reverse()
        .filter((c) => {
          if (c.draft === 1) return false;
          if (st === 'active' && c.archived === 1) return false;
          if (st === 'unread' && (c.read !== 0 || c.archived === 1)) return false;
          if (st === 'archived' && c.archived !== 1) return false;
          if (category && c.category !== category) return false;
          return true;
        })
        .limit(awaitingReply ? SCAN_CAP : off + lim)
        .toArray();

      const withFlags = await Promise.all(
        candidates.map(async (c) => ({ c, fromMe: await lastMessageFromMe(c.id) })),
      );
      const filtered = awaitingReply ? withFlags.filter((x) => x.fromMe === false) : withFlags;
      const page = filtered.slice(off, off + lim);

      return {
        returned: page.length,
        offset: off,
        results: page.map(({ c, fromMe }) => ({
          ...convShape(c),
          lastMessageFromMe: fromMe,
          awaitingYourReply: fromMe === false,
        })),
      };
    },
  },
  {
    name: 'get_thread',
    description:
      'Read the full message history of one conversation, oldest to newest. Identify it by conversationId (from list_conversations or search_messages) or by the profileUrn of the person. Returns the actual messages, unlike get_conversation_summary which returns an AI recap.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The conversation to read.' },
        profileUrn: { type: 'string', description: 'Alternative: the connection whose thread to read.' },
        limit: { type: 'number', description: 'Max messages, keeping the most recent (default 50, max 200).' },
      },
      additionalProperties: false,
    },
    handler: async ({ conversationId, profileUrn, limit }) => {
      if (!db) return { found: false };
      const lim = clampLimit(limit, 50, 200);

      let convId: string | undefined = conversationId || undefined;
      if (!convId && profileUrn) {
        // participantUrns isn't indexed, so scan and take the most recent match.
        const all = await db.conversations.toArray();
        convId = all
          .filter((c) => c.draft !== 1 && (c.participantUrns || []).includes(String(profileUrn)))
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]?.id;
      }
      if (!convId) return { found: false };

      const conv = await db.conversations.get(convId);
      if (!conv) return { found: false };

      const msgs = await db.messages
        .where('[conversationId+createdAt]')
        .between([convId, 0], [convId, Number.MAX_SAFE_INTEGER])
        .reverse()
        .limit(lim)
        .toArray();
      msgs.reverse(); // oldest → newest reads naturally

      return {
        found: true,
        ...convShape(conv),
        messageCount: msgs.length,
        messages: msgs.map((m) => ({
          from: m.isFromMe ? 'You' : m.senderName || 'Them',
          at: iso(m.createdAt),
          ...(m.subject ? { subject: m.subject } : {}),
          body: m.body || (m.attachments?.length ? '[attachment]' : ''),
          ...(m.attachments?.length ? { attachments: m.attachments.length } : {}),
        })),
      };
    },
  },
  {
    name: 'find_stale_connections',
    description:
      "Find connections the user hasn't exchanged messages with recently — reconnect candidates. Returns each person with when they last spoke (or null if never), sorted by never-messaged first, then longest-silent. Pair with create_draft to queue reconnect notes.",
    inputSchema: {
      type: 'object',
      properties: {
        months: { type: 'number', description: 'Stale means no messages in this many months (default 6).' },
        role: { type: 'string', description: 'Only this role category, e.g. "Investor".' },
        interest: { type: 'string', description: 'Only connections with this interest tag.' },
        includeNeverMessaged: {
          type: 'boolean',
          description: 'Include connections never messaged at all (default true).',
        },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
      additionalProperties: false,
    },
    handler: async ({ months, role, interest, includeNeverMessaged, limit }) => {
      if (!db) return { total: 0, results: [] };
      const lim = clampLimit(limit, 25, 100);
      const m = Number(months);
      const monthsN = Number.isFinite(m) && m > 0 ? m : 6;
      const cutoff = Date.now() - monthsN * 30 * 24 * 60 * 60 * 1000;
      const includeNever = includeNeverMessaged !== false;

      // Most recent activity per participant, across all their conversations.
      const lastByUrn = new Map<string, number>();
      for (const c of await db.conversations.toArray()) {
        if (c.draft === 1) continue;
        for (const urn of c.participantUrns || []) {
          if ((lastByUrn.get(urn) ?? 0) < c.lastActivityAt) lastByUrn.set(urn, c.lastActivityAt);
        }
      }

      let list = await allConnections();
      if (role) list = list.filter((c) => c.roleCategory === role);
      if (interest) list = list.filter((c) => c.interestTags?.includes(interest));

      const rows = list
        .map((c) => ({ c, last: lastByUrn.get(c.profileUrn) ?? 0 }))
        .filter((r) => (r.last === 0 ? includeNever : r.last < cutoff))
        .sort((a, b) => a.last - b.last); // never-messaged (0) first, then oldest

      return {
        staleAfterMonths: monthsN,
        total: rows.length,
        results: rows.slice(0, lim).map(({ c, last }) => ({
          ...shape(c),
          lastInteractionAt: last ? iso(last) : null,
          daysSinceLastInteraction: last ? Math.floor((Date.now() - last) / 86_400_000) : null,
          neverMessaged: last === 0,
        })),
      };
    },
  },
  {
    name: 'create_draft',
    description:
      "Create a draft message to one of the user's connections. It lands in the user's Outbox for them to review and send — this NEVER sends. Optionally schedule it for a time (still surfaced for the user to send with one click; never auto-sent). The recipient must be an existing connection (by profileUrn or publicId).",
    inputSchema: {
      type: 'object',
      properties: {
        profileUrn: { type: 'string', description: 'Recipient connection profileUrn (preferred).' },
        publicId: { type: 'string', description: 'Recipient publicId (alternative to profileUrn).' },
        body: { type: 'string', description: 'The message text to draft.' },
        scheduleAt: {
          type: 'string',
          description: 'Optional ISO 8601 time to schedule for. The user still sends it — nothing auto-sends.',
        },
      },
      required: ['body'],
      additionalProperties: false,
    },
    handler: async ({ profileUrn, publicId, body, scheduleAt }) => {
      if (!db) throw new Error('Database unavailable');
      const text = String(body || '').trim();
      if (!text) throw new Error('body is required');
      if (!profileUrn && !publicId) throw new Error('profileUrn or publicId is required');
      const list = await allConnections();
      const c = list.find(
        (x) => (profileUrn && x.profileUrn === profileUrn) || (publicId && x.publicId === publicId),
      );
      if (!c) throw new Error('Recipient not found among your connections');

      let status: 'draft' | 'scheduled' = 'draft';
      let scheduledAt: number | undefined;
      if (scheduleAt) {
        const t = new Date(scheduleAt).getTime();
        if (!Number.isFinite(t)) throw new Error('scheduleAt is not a valid date');
        scheduledAt = t;
        status = 'scheduled';
      }
      const now = Date.now();
      const id = crypto.randomUUID();
      await db.scheduledMessages.add({
        id,
        recipientUrns: [c.profileUrn],
        recipientName: c.fullName || 'Unknown',
        body: text,
        status,
        ...(scheduledAt ? { scheduledAt } : {}),
        createdAt: now,
        updatedAt: now,
      });
      return { created: true, id, recipient: c.fullName, status };
    },
  },
];

const BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));

/** Tool metadata to advertise to the MCP client (no handlers). */
export function toolDescriptors(): McpToolDescriptor[] {
  return MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Run a tool by name. Throws on an unknown tool. */
export async function callTool(name: string, args: Record<string, any> = {}): Promise<unknown> {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args || {});
}

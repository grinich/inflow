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
import { sendBridgeMessage } from '@/lib/bridge';
import { getConfirmRecipient } from '@/lib/send-settings';
import { isValidProfileUrn } from '@/lib/voyager-normalizer';
import type { Connection } from '@/types/connection';
import type { Conversation } from '@/types/conversation';
import type { ScheduledMessage } from '@/types/scheduled-message';

/** A typeahead hit as the background's searchTypeahead returns it. */
interface TypeaheadHit {
  name: string;
  headline: string;
  pictureUrl: string;
  profileUrn: string;
  publicId: string;
}

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
    name: 'update_draft',
    description:
      "Fix a draft that is still waiting in the user's Outbox: its body, InMail subject, recipient display name, profile URL, or scheduled time. Pass only the fields you are changing. Use this instead of deleting and re-creating, which loses the user's place in the queue. Cannot change who it goes to — create a new draft for that — and cannot touch anything already sent. Editing the body or subject clears any recipient confirmation the user had given, since they confirmed a different message.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Draft id from list_drafts.' },
        body: { type: 'string', description: 'Replacement message text.' },
        inMailSubject: { type: 'string', description: 'Replacement InMail subject, max 200 chars.' },
        recipientName: { type: 'string', description: 'Display name for the Outbox row.' },
        profileUrl: { type: 'string', description: "The recipient's linkedin.com/in/... URL." },
        scheduleAt: {
          type: 'string',
          description: 'ISO 8601 time to send, or "" to turn it back into an unscheduled draft.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async ({ id, body, inMailSubject, recipientName, profileUrl, scheduleAt }) => {
      if (!db) throw new Error('Database unavailable');
      const row = await db.scheduledMessages.get(String(id || ''));
      if (!row) throw new Error('No draft with that id — list_drafts shows what is there');
      if (row.status === 'sent' || row.status === 'sending') {
        throw new Error(`That message is ${row.status} — only something still waiting can be edited`);
      }

      const patch: Partial<ScheduledMessage> = { updatedAt: Date.now() };

      if (body !== undefined) {
        const text = String(body).trim();
        if (!text) throw new Error('body cannot be empty');
        patch.body = text;
      }

      if (inMailSubject !== undefined) {
        const subject = String(inMailSubject).trim();
        if (!subject) throw new Error('inMailSubject cannot be empty — an InMail needs one');
        if (subject.length > 200) throw new Error('inMailSubject is longer than 200 characters');
        // Only on something already queued as an InMail: adding a subject to a
        // plain draft would silently turn a free message into a paid one.
        if (row.inMailSubject === undefined) {
          throw new Error('That draft is not an InMail, so it has no subject to change');
        }
        patch.inMailSubject = subject;
      }

      if (recipientName !== undefined) {
        const name = String(recipientName).trim();
        if (!name) throw new Error('recipientName cannot be empty');
        patch.recipientName = name;
      }

      if (profileUrl !== undefined) {
        const link = String(profileUrl).trim();
        if (!/^https:\/\/(www\.)?linkedin\.com\/in\/[^/\s]+\/?$/.test(link)) {
          throw new Error('profileUrl must be a https://www.linkedin.com/in/... URL');
        }
        patch.profileUrl = link;
      }

      if (scheduleAt !== undefined) {
        const when = String(scheduleAt).trim();
        if (!when) {
          patch.status = 'draft';
          patch.scheduledAt = undefined;
        } else {
          const t = new Date(when).getTime();
          if (!Number.isFinite(t)) throw new Error('scheduleAt is not a valid date');
          patch.scheduledAt = t;
          patch.status = 'scheduled';
        }
      }

      // What the user confirmed was a specific message to a specific person.
      // Change either and that confirmation no longer covers what would send,
      // which matters most when auto-send is on and nobody is watching.
      if (patch.body !== undefined || patch.inMailSubject !== undefined || patch.profileUrl !== undefined) {
        patch.recipientConfirmedAt = undefined;
      }

      await db.scheduledMessages.update(row.id, patch);
      const after = await db.scheduledMessages.get(row.id);
      return {
        updated: true,
        id: row.id,
        status: after?.status,
        recipientConfirmationCleared: patch.recipientConfirmedAt === undefined
          && !!row.recipientConfirmedAt,
      };
    },
  },
  {
    name: 'delete_draft',
    description:
      "Remove one draft or scheduled message from the user's Outbox. Takes a single id from list_drafts. Refuses anything already sent, so it can only discard something still waiting and never rewrites the user's sent history. Prefer update_draft when the message just needs fixing.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Draft id from list_drafts.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async ({ id }) => {
      if (!db) throw new Error('Database unavailable');
      const row = await db.scheduledMessages.get(String(id || ''));
      if (!row) throw new Error('No draft with that id — list_drafts shows what is there');
      if (row.status === 'sent') {
        throw new Error('That message was already sent — the Outbox keeps it as history');
      }
      if (row.status === 'sending') {
        throw new Error('That message is being sent right now');
      }
      await db.scheduledMessages.delete(row.id);
      return { deleted: true, id: row.id, was: row.status, to: row.recipientName };
    },
  },
  {
    name: 'list_drafts',
    description:
      "Read the user's Outbox: the drafts and scheduled messages waiting for them to send, plus recently sent and failed ones. Use it to confirm a draft you created actually landed, to check whether an InMail draft still needs the user to confirm the recipient before it can send, and to avoid drafting a second message to someone who already has one waiting. Nothing here has been sent unless its status says so.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'draft', 'scheduled', 'sent', 'failed', 'all'],
          description: 'Which to include. Default "pending" (draft, scheduled and failed — everything still waiting).',
        },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
      additionalProperties: false,
    },
    handler: async ({ status, limit }) => {
      if (!db) return { total: 0, results: [] };
      const lim = clampLimit(limit, 25, 100);
      const want = String(status || 'pending');
      const all = await db.scheduledMessages.toArray();

      const keep = (m: { status: string }) =>
        want === 'all' ? true : want === 'pending' ? m.status !== 'sent' && m.status !== 'sending' : m.status === want;

      const rows = all.filter(keep).sort((a, b) => b.createdAt - a.createdAt);
      return {
        total: rows.length,
        results: rows.slice(0, lim).map((m) => ({
          id: m.id,
          to: m.recipientName,
          status: m.status,
          // Present only on an InMail, and its presence is what makes it one.
          inMailSubject: m.inMailSubject,
          preview: clip(m.body, 160),
          profileUrl: m.profileUrl,
          createdAt: iso(m.createdAt),
          scheduledAt: iso(m.scheduledAt),
          sentAt: iso(m.sentAt),
          error: m.error,
          // A draft Claude made, whose recipient came from a name search, needs
          // the user to confirm the profile before the Send button works.
          ...(m.source === 'mcp' && m.inMailSubject !== undefined
            ? { awaitingRecipientConfirmation: !m.recipientConfirmedAt }
            : {}),
        })),
      };
    },
  },
  {
    name: 'find_person',
    description:
      "Look up someone on LinkedIn by name, INCLUDING people the user is not connected to, and get the profileUrn that create_draft needs to draft an InMail. Names repeat, so check the headline against what you already know about the person before using a result. You may pass a /in/<slug> as publicId, but LinkedIn often omits that field, in which case the filter is skipped and the response says so. Each result says whether that person is already a connection: if they are, messaging them is free and create_draft takes no subject; if they are not, a draft to them is a Premium InMail, and create_draft will also need their profile URL and name, which this tool cannot give you — LinkedIn omits the slug here, so take the URL from the record you found them in or ask the user. This searches LinkedIn live rather than the local database.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The person's name, e.g. \"Dana Whitfield\"." },
        publicId: {
          type: 'string',
          description: 'Optional /in/<slug> from a known profile URL (a full URL is fine). Narrows results to an exact match on it.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async ({ name, publicId }) => {
      const query = String(name || '').trim();
      if (!query) throw new Error('name is required');

      const res = await sendBridgeMessage({ type: 'TYPEAHEAD_SEARCH', query });
      if (!res?.success) throw new Error(res?.error || 'LinkedIn search failed');
      let hits = (res.data as TypeaheadHit[]) || [];

      // Accept a whole URL as well as a bare slug, since that is what a CRM
      // record holds. Trailing slash and query string are LinkedIn's, not part
      // of the identifier.
      const slug = String(publicId || '')
        .trim()
        .replace(/[?#].*$/, '')
        .replace(/^.*\/in\//, '')
        .replace(/\/+$/, '');
      // The typeahead projection does not actually return publicIdentifier
      // (verified live), so filtering on it silently matched nothing and looked
      // exactly like "no such person". Only filter when some hit carries one,
      // and say so otherwise rather than returning a misleading empty list.
      let unmatchedSlug = false;
      if (slug) {
        if (hits.some((h) => h.publicId)) hits = hits.filter((h) => h.publicId === slug);
        else unmatchedSlug = hits.length > 0;
      }

      // Whether they are a connection decides InMail vs a free message, so the
      // caller should not have to ask separately.
      const known = new Set((await allConnections()).map((c) => c.profileUrn));
      return {
        total: hits.length,
        ...(unmatchedSlug
          ? {
              note: 'LinkedIn did not return a publicId for these results, so the publicId filter was not applied. Match on the headline instead before drafting.',
            }
          : {}),
        results: hits.map((h) => ({
          name: h.name,
          headline: h.headline || undefined,
          profileUrn: h.profileUrn,
          publicId: h.publicId || undefined,
          isConnection: known.has(h.profileUrn),
        })),
      };
    },
  },
  {
    name: 'create_draft',
    description:
      "Create a draft message and put it in the user's Outbox for them to review and send — this NEVER sends. Optionally schedule it for a time (still surfaced for the user to send with one click; never auto-sent). Recipient: for an existing connection pass profileUrn (preferred) or publicId. For someone the user is NOT connected to — a cold lead — pass their full profileUrn plus inMailSubject, recipientName and profileUrl: that draft goes out as a Premium InMail, spends one of the user's InMail credits, and the user confirms the person by opening profileUrl before they can send it.",
    inputSchema: {
      type: 'object',
      properties: {
        profileUrn: { type: 'string', description: 'Recipient profileUrn (urn:li:fsd_profile:…). Required for a non-connection.' },
        publicId: { type: 'string', description: 'Recipient publicId. Resolves existing connections only.' },
        body: { type: 'string', description: 'The message text to draft.' },
        scheduleAt: {
          type: 'string',
          description: 'Optional ISO 8601 time to schedule for. The user still sends it — nothing auto-sends.',
        },
        inMailSubject: {
          type: 'string',
          description:
            'Subject line, max 200 chars. Required for a non-connection (sends as Premium InMail, costs a credit). Rejected for a connection, who can be messaged for free.',
        },
        recipientName: {
          type: 'string',
          description: "Display name for the Outbox queue. REQUIRED for a non-connection, whose name inflow does not know; otherwise the row reads \"Unknown\".",
        },
        profileUrl: {
          type: 'string',
          description:
            "The recipient's linkedin.com/in/... URL. Required for an InMail while the user has recipient confirmation on (the default), since they confirm by opening it; refused without it. find_person does not return it, so take it from the record you found them in (a CRM contact, a URL the user gave you) or ask. Derived automatically for an existing connection. Always pass it when you have it.",
        },
      },
      required: ['body'],
      additionalProperties: false,
    },
    handler: async ({ profileUrn, publicId, body, scheduleAt, inMailSubject, recipientName, profileUrl }) => {
      if (!db) throw new Error('Database unavailable');
      const text = String(body || '').trim();
      if (!text) throw new Error('body is required');
      if (!profileUrn && !publicId) throw new Error('profileUrn or publicId is required');
      const list = await allConnections();
      const c = list.find(
        (x) => (profileUrn && x.profileUrn === profileUrn) || (publicId && x.publicId === publicId),
      );
      const subject = String(inMailSubject || '').trim();
      // Only a real LinkedIn profile URL: this becomes a link the user clicks
      // to verify identity, so it must not be able to point anywhere else.
      let link = String(profileUrl || '').trim();
      if (link && !/^https:\/\/(www\.)?linkedin\.com\/in\/[^/\s]+\/?$/.test(link)) {
        throw new Error('profileUrl must be a https://www.linkedin.com/in/... URL');
      }

      // Connections are first-degree, so LinkedIn messages them for free and
      // InMail is simply the wrong product. Anyone else can ONLY be reached by
      // InMail, which is why the subject is required there: its presence on the
      // queued row is what makes this send as an InMail days later.
      let urn: string;
      let name: string;
      if (c) {
        if (subject) {
          throw new Error(
            `${c.fullName} is a first-degree connection — messaging them is free. Drop inMailSubject; InMail is for people outside the user's network.`,
          );
        }
        urn = c.profileUrn;
        name = c.fullName || 'Unknown';
        // A synced connection knows its own slug, so the link needs no caller.
        if (!link && c.publicId) link = `https://www.linkedin.com/in/${c.publicId}/`;
      } else {
        if (!profileUrn) {
          throw new Error(
            'Recipient not found among your connections, and publicId resolves connections only. Pass the full profileUrn (urn:li:fsd_profile:…) to draft an InMail to someone else.',
          );
        }
        if (!isValidProfileUrn(profileUrn)) {
          throw new Error('profileUrn is not a well-formed urn:li:fsd_profile:… URN');
        }
        if (!subject) {
          throw new Error(
            'This recipient is not a connection, so the draft can only go out as a Premium InMail — inMailSubject is required.',
          );
        }
        // The link exists so the user can confirm the person before sending.
        // If they have turned that check off, demanding it is pure friction —
        // so this is required exactly when the check is on. find_person cannot
        // supply it (LinkedIn omits the slug); it comes from wherever the
        // person was found.
        const mustConfirm = await getConfirmRecipient();
        if (mustConfirm && !link) {
          throw new Error(
            'profileUrl is required for an InMail: the user confirms the person by opening it before sending. Take the linkedin.com/in/... URL from the record you found them in, or ask the user for it.',
          );
        }
        if (mustConfirm && !String(recipientName || '').trim()) {
          throw new Error(
            'recipientName is required for an InMail: inflow does not know this person, so the Outbox would show "Unknown".',
          );
        }
        if (subject.length > 200) throw new Error('inMailSubject is longer than 200 characters');
        urn = profileUrn;
        name = String(recipientName || '').trim() || 'Unknown';
      }

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
        recipientUrns: [urn],
        recipientName: name,
        body: text,
        status,
        ...(subject ? { inMailSubject: subject } : {}),
        ...(link ? { profileUrl: link } : {}),
        source: 'mcp',
        ...(scheduledAt ? { scheduledAt } : {}),
        createdAt: now,
        updatedAt: now,
      });
      return { created: true, id, recipient: name, status, inMail: !!subject, profileUrl: link || undefined };
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

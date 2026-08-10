import type { Message } from '@/types/message';
import type { Connection } from '@/types/connection';
import type { PredictFn } from './connection-classifier';

/**
 * AI recap of a message thread with a connection. Summarizes what was discussed,
 * where things stand, and any open thread/next step — so the user gets context
 * on a relationship without re-reading the whole conversation. The result is
 * cached on the connection row and marked stale when new messages arrive.
 *
 * Judgment/writing task → routed to the quality model tier (see PredictFn).
 */

/** Cap how many messages we serialize into the prompt (bounds token cost). */
export const CONV_SUMMARY_MESSAGE_LIMIT = 60;
/** Truncate each message body to this many characters. */
const MAX_BODY_CHARS = 600;

const SYSTEM_PROMPT =
  'You summarize a 1:1 LinkedIn message thread for the account owner ("Me"). ' +
  'If the thread spans several distinct topics, format the summary as short ' +
  'markdown bullet points ("- "), one per topic, so they are easy to scan; if ' +
  'it is a single simple thread, use 2–3 short sentences instead. Cover the ' +
  'relationship/context, the main things discussed, and any open item or next ' +
  'step. Be specific and factual — do not invent anything not in the messages. ' +
  'No preamble like "This conversation".';

/** One display line per message, oldest first, for the prompt context. */
function serializeMessages(name: string, messages: Message[]): string {
  const them = name || 'Them';
  return messages
    .map((m) => {
      const who = m.isFromMe ? 'Me' : them;
      let body = (m.body || '').trim();
      if (!body && m.attachments?.length) body = `[${m.attachments[0].type} attachment]`;
      if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS) + '…';
      return body ? `${who}: ${body}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function buildConversationSummaryPrompt(name: string, messages: Message[]): string {
  // Keep the most RECENT window when a thread is very long.
  const windowed = messages.slice(-CONV_SUMMARY_MESSAGE_LIMIT);
  const transcript = serializeMessages(name, windowed);
  return (
    `Summarize my message thread with ${name || 'this connection'}.\n\n` +
    `Messages (oldest to newest):\n${transcript}\n\nSummary:`
  );
}

/**
 * Generate a conversation summary. Returns null when there's nothing to
 * summarize (no messages with text) or the model returns nothing.
 */
export async function summarizeConversation(
  name: string,
  messages: Message[],
  predict: PredictFn,
): Promise<string | null> {
  // No usable content (e.g. an attachments-only thread) — nothing to summarize.
  const windowed = messages.slice(-CONV_SUMMARY_MESSAGE_LIMIT);
  if (!serializeMessages(name, windowed).trim()) return null;

  const prompt = buildConversationSummaryPrompt(name, messages);
  const text = await predict(prompt, {
    fullResponse: true,
    maxTokens: 320,
    temperature: 0.3,
    systemPrompt: SYSTEM_PROMPT,
    tier: 'quality',
  });
  const clean = (text || '').trim().replace(/^["']|["']$/g, '').trim();
  return clean || null;
}

/**
 * True when a stored conversation summary no longer reflects the thread — i.e.
 * the thread's latest activity is newer than what the summary covered. Also true
 * when there is no summary yet but messages exist.
 */
export function isConversationSummaryStale(
  connection: Pick<Connection, 'conversationSummary' | 'conversationSummaryLastMsgAt'>,
  threadLastActivityAt: number | null | undefined,
): boolean {
  if (!connection.conversationSummary) return false; // nothing to be stale
  if (!threadLastActivityAt) return false;
  return threadLastActivityAt > (connection.conversationSummaryLastMsgAt ?? 0);
}

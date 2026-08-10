import type { Connection } from '@/types/connection';
import type { PredictFn } from './connection-classifier';

/**
 * "Ask about your network" — answers natural-language questions over the user's
 * connections. Retrieval is simple: we serialize a compact view of the
 * connections into the prompt context (the model has a large context window),
 * so answers are grounded in the actual list rather than the model's guesses.
 *
 * Provider-agnostic: takes a PredictFn. Today that's Gemini (the wired
 * provider); the same function can be pointed at Claude later without touching
 * callers.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Cap how many connections we serialize into one prompt, to bound tokens. */
export const CHAT_CONTEXT_LIMIT = 600;

const SYSTEM_PROMPT =
  'You answer questions about the user\'s LinkedIn connections using ONLY the ' +
  'provided list. Each line is: "name (role) — headline [interests: …] — about: ' +
  '<what they do> — history: <recap of past messages with them>". Use the ' +
  '"about" and "history" notes to understand who each person is and your ' +
  'relationship with them. Be concise and specific. When listing people, use ' +
  'their names. If the list lacks the info to answer, say so plainly. Never ' +
  'invent connections or facts.';

/** Compact one-line-per-person serialization for the prompt context. */
export function buildConnectionContext(
  connections: Connection[],
  limit: number = CHAT_CONTEXT_LIMIT,
): { text: string; included: number; total: number } {
  const total = connections.length;
  const slice = connections.slice(0, limit);
  const lines = slice.map((c) => {
    const role = c.roleCategory && c.roleCategory !== 'Other' ? ` (${c.roleCategory})` : '';
    const headline = c.headline ? ` — ${c.headline}` : '';
    const interests = c.interestTags?.length ? ` [interests: ${c.interestTags.join(', ')}]` : '';
    // Ground answers in the AI summaries we already generate: the one-line
    // "about" summary and any conversation recap. This is what makes the chat
    // actually understand who people are and how the user knows them.
    const about = c.aiSummary ? ` — about: ${c.aiSummary}` : '';
    const history = c.conversationSummary ? ` — history: ${c.conversationSummary}` : '';
    return `- ${c.fullName}${role}${headline}${interests}${about}${history}`;
  });
  return { text: lines.join('\n'), included: slice.length, total };
}

/**
 * Ask one question, optionally with prior turns for follow-up context.
 * Returns the answer text, or null if the model returned nothing.
 */
export async function answerConnectionQuestion(
  connections: Connection[],
  question: string,
  predict: PredictFn,
  history: ChatMessage[] = [],
  limit: number = CHAT_CONTEXT_LIMIT,
): Promise<string | null> {
  const { text, included, total } = buildConnectionContext(connections, limit);
  const note = total > included ? `\n\n(Showing ${included} of ${total} connections.)` : '';
  const system = `${SYSTEM_PROMPT}\n\nConnections:\n${text}${note}`;

  const convo = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const prompt = `${convo ? convo + '\n' : ''}User: ${question}\nAssistant:`;

  const answer = await predict(prompt, {
    fullResponse: true,
    maxTokens: 2048, // was 700 — answers were getting cut off mid-response
    temperature: 0.3,
    systemPrompt: system,
    tier: 'quality', // reasoning over the network — route to the stronger model
  });
  return (answer || '').trim() || null;
}

/** Starter questions shown before the user has asked anything. */
export const SUGGESTED_QUESTIONS = [
  'Which of my connections are investors?',
  'Who works at a fintech company?',
  'Summarize the kinds of people in my network.',
  'Who might be a good intro to a founder?',
];

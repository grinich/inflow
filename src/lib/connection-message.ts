import type { PredictFn } from './connection-classifier';

/**
 * Drafts a short, warm reconnect message for a follow-up. Deliberately generic
 * and placeholder-free so the user can send or lightly edit it — never invents
 * specifics beyond the person's name/headline.
 */

const SYSTEM_PROMPT =
  'You write a short, warm LinkedIn reconnect message (1–3 sentences). Friendly ' +
  'and specific to the person\'s role, no placeholders like [company], no ' +
  'subject line, no sign-off name. Plain text only.';

export function buildFollowUpDraftPrompt(name: string, headline: string): string {
  return `Write a brief message to reconnect with ${name || 'this connection'}${
    headline ? `, whose headline is "${headline}"` : ''
  }. Keep it casual and genuine.`;
}

export async function draftFollowUpMessage(
  name: string,
  headline: string,
  predict: PredictFn,
): Promise<string | null> {
  const text = await predict(buildFollowUpDraftPrompt(name, headline), {
    fullResponse: true,
    maxTokens: 160,
    temperature: 0.6,
    systemPrompt: SYSTEM_PROMPT,
    tier: 'quality', // writing quality matters here — route to the stronger model
  });
  const clean = (text || '').trim().replace(/^["']|["']$/g, '').trim();
  return clean || null;
}

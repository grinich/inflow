import type { PredictFn } from './connection-classifier';

/**
 * Generates a short, human one-line summary of a connection from the sparse
 * data we have (name + headline). Deliberately conservative: if the headline is
 * empty/uninformative the model is told to return nothing, so we don't
 * fabricate detail we can't support.
 */

const SYSTEM_PROMPT =
  'You summarize a professional in ONE concise sentence (max 25 words) from their ' +
  'name and LinkedIn headline. Write plainly, no lead-in like "This person". ' +
  'Do not invent facts beyond the headline. If the headline is empty or ' +
  'uninformative, reply with an empty string.';

export function buildSummaryPrompt(name: string, headline: string): string {
  return `Name: ${name || 'Unknown'}\nHeadline: ${headline || '(none)'}\n\nOne sentence:`;
}

export async function summarizeConnection(
  name: string,
  headline: string,
  predict: PredictFn,
): Promise<string | null> {
  if (!headline.trim()) return null;
  const text = await predict(buildSummaryPrompt(name, headline), {
    fullResponse: true,
    maxTokens: 80,
    temperature: 0.2,
    systemPrompt: SYSTEM_PROMPT,
  });
  // Strip wrapping quotes the model sometimes adds.
  const clean = (text || '').trim().replace(/^["']|["']$/g, '').trim();
  return clean || null;
}

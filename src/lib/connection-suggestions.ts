import type { Connection, ConnectionRole } from '@/types/connection';
import type { PredictFn, ClassifyResult } from './connection-classifier';

/**
 * AI suggestions for organizing the network:
 *  - suggestInterestTags: propose new interest tags from patterns in headlines
 *  - diffRoles: turn a fresh classification into "re-categorize" candidates
 *    (only concrete role changes, never X → Other)
 */

const TAG_SYSTEM =
  'You suggest concise interest-tag categories to help someone organize their ' +
  'LinkedIn network. Reply with ONLY a JSON array of 2–6 short tag strings ' +
  '(1–3 words each), no prose.';

/** How many headlines to sample into the tag-suggestion prompt. */
export const TAG_SAMPLE_SIZE = 150;

export function buildTagSuggestionPrompt(headlines: string[], existing: string[]): string {
  const existingLine = existing.length
    ? `Do NOT repeat these existing tags: ${existing.join(', ')}.`
    : 'The user has no tags yet.';
  return (
    `From these LinkedIn headlines, suggest up to 6 interest-tag categories that ` +
    `would help the user group and filter people (e.g. "Design leaders", ` +
    `"Fintech founders"). ${existingLine}\n\n` +
    `Reply with ONLY a JSON array of strings.\n\nHeadlines:\n${headlines.join('\n')}`
  );
}

/** Parse suggested tags: strings only, deduped, excluding existing (ci). */
export function parseTagSuggestions(text: string, existing: string[]): string[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

export async function suggestInterestTags(
  connections: Connection[],
  existing: string[],
  predict: PredictFn,
): Promise<string[]> {
  const headlines = connections
    .map((c) => c.headline)
    .filter((h): h is string => !!h && h.trim().length > 0)
    .slice(0, TAG_SAMPLE_SIZE);
  if (headlines.length === 0) return [];
  const text = await predict(buildTagSuggestionPrompt(headlines, existing), {
    fullResponse: true,
    maxTokens: 200,
    temperature: 0.4,
    systemPrompt: TAG_SYSTEM,
  });
  return text ? parseTagSuggestions(text, existing) : [];
}

export interface RecatCandidate {
  profileUrn: string;
  fullName: string;
  headline: string;
  from: ConnectionRole | undefined;
  to: ConnectionRole;
}

/**
 * Compare a fresh classification against stored roles and surface concrete
 * changes (e.g. Other → Investor). Never suggests demoting to "Other" — those
 * aren't actionable improvements.
 */
export function diffRoles(
  connections: Connection[],
  results: Map<string, ClassifyResult>,
): RecatCandidate[] {
  const out: RecatCandidate[] = [];
  for (const c of connections) {
    const r = results.get(c.profileUrn);
    if (!r) continue;
    if (r.roleCategory === 'Other') continue;
    if (r.roleCategory === c.roleCategory) continue;
    out.push({
      profileUrn: c.profileUrn,
      fullName: c.fullName,
      headline: c.headline,
      from: c.roleCategory,
      to: r.roleCategory,
    });
  }
  return out;
}

/**
 * Which connections to re-examine for miscategorization. Prioritizes "Other"/
 * uncategorized (most likely to be improvable), then most-recent, capped so one
 * scan stays cheap.
 */
export function pickRecatSample(connections: Connection[], limit: number): Connection[] {
  return [...connections]
    .sort((a, b) => {
      const aOther = !a.roleCategory || a.roleCategory === 'Other' ? 0 : 1;
      const bOther = !b.roleCategory || b.roleCategory === 'Other' ? 0 : 1;
      if (aOther !== bOther) return aOther - bOther;
      return b.connectedAt - a.connectedAt;
    })
    .slice(0, limit);
}

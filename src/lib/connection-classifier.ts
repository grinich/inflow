import { ROLE_CATEGORIES, type ConnectionRole } from '@/types/connection';

/**
 * AI categorization of LinkedIn connections. Given each person's name +
 * headline, the classifier assigns one {@link ConnectionRole} and matches the
 * user's interest tags. It batches people into one prompt per call to keep the
 * number of Gemini requests low when categorizing a large connection list.
 */

/** How many people to classify per Gemini call. */
export const CLASSIFY_BATCH_SIZE = 15;

const SYSTEM_PROMPT =
  'You are a precise classifier of professional profiles. You always respond ' +
  'with valid JSON only — no prose, no markdown fences.';

/** A person to classify (subset of Connection needed for the prompt). */
export interface ClassifyInput {
  profileUrn: string;
  fullName: string;
  headline: string;
}

/** The classifier result for one person. */
export interface ClassifyResult {
  roleCategory: ConnectionRole;
  interestTags: string[];
}

/** Minimal shape of the AI predict function this module depends on. */
export type PredictFn = (
  prompt: string,
  options?: {
    fullResponse?: boolean;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    signal?: AbortSignal;
    tier?: 'fast' | 'quality';
  },
) => Promise<string | null>;

/** Build the classification prompt for one batch of people. */
export function buildClassifyPrompt(people: ClassifyInput[], interests: string[]): string {
  const roles = ROLE_CATEGORIES.join(', ');
  const list = people
    .map((p, i) => `${i}. ${p.fullName || 'Unknown'} — ${p.headline || '(no headline)'}`)
    .join('\n');

  const interestLine = interests.length
    ? `For each person, also list which of these interest tags apply based on their role/headline (zero or more, use the EXACT tag text): ${interests.join(', ')}.`
    : 'There are no interest tags to match — always use an empty interests array.';

  return (
    `Classify each LinkedIn connection into exactly one role category from this list: ${roles}.\n` +
    `${interestLine}\n\n` +
    `Respond with ONLY a JSON array — one object per person, in order — shaped like:\n` +
    `[{"i":0,"role":"Investor","interests":["Investors"]}]\n` +
    `Use the exact role names and interest tag names given. If unsure of the role, use "Other".\n\n` +
    `People:\n${list}`
  );
}

/** Pull the first JSON array out of a model response (tolerates fences/prose). */
function extractJsonArray(text: string): any[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse a batch response into a map of batch-index → result. Roles outside the
 * known set collapse to "Other"; interest tags are validated (case-insensitive)
 * against the requested list and normalized back to their canonical casing.
 */
export function parseClassifyResponse(
  text: string,
  interests: string[],
): Map<number, ClassifyResult> {
  const out = new Map<number, ClassifyResult>();
  const arr = extractJsonArray(text);
  if (!arr) return out;

  const roleSet = new Set<string>(ROLE_CATEGORIES);
  const interestByLower = new Map(interests.map((t) => [t.toLowerCase(), t]));

  for (const item of arr) {
    if (!item || typeof item.i !== 'number') continue;
    const roleCategory = (roleSet.has(item.role) ? item.role : 'Other') as ConnectionRole;
    const interestTags = Array.isArray(item.interests)
      ? (item.interests as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => interestByLower.get(t.toLowerCase()))
          .filter((t): t is string => !!t)
      : [];
    out.set(item.i, { roleCategory, interestTags });
  }
  return out;
}

export interface ClassifyCallbacks {
  /** Fires after each responded batch with a result for EVERY person in it
   *  (model-omitted people default to "Other"), so callers persist per batch. */
  onBatch?: (results: Array<{ profileUrn: string } & ClassifyResult>) => Promise<void> | void;
  /** Fires when a whole batch fails (no response / thrown). Those people are
   *  left unresolved so the caller can retry them, and the error is surfaced. */
  onError?: (profileUrns: string[], error: unknown) => void;
}

/** Throttle + retry controls (defaults tuned to survive the Gemini free tier). */
export interface ClassifyThrottle {
  /** Pause between successful batches, to pace requests (default 500ms). */
  batchDelayMs?: number;
  /** Retries per failing batch before giving up (default 3). */
  maxRetries?: number;
  /** Base backoff, doubled each retry: 3s → 6s → 12s (default 3000ms). */
  backoffMs?: number;
  /** Injectable sleep (tests pass a no-op); defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Abort the run (e.g. component unmount). */
  signal?: { aborted: boolean };
}

/** Stop the whole run after this many batches fail all their retries in a row —
 *  almost always means the daily quota is exhausted, so backing off won't help. */
const CIRCUIT_BREAK_AFTER = 3;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Classify a list of connections in batches, paced and retried so a large scan
 * survives the free-tier rate limit:
 *  - a short delay between batches (throttle) keeps requests under the per-minute cap;
 *  - a failing batch is retried with exponential backoff (recovers from transient 429s);
 *  - after retries are exhausted the batch is reported via `onError` (left for later);
 *  - if several batches fail completely in a row (quota exhausted) the run stops early.
 *
 * A responded batch resolves every person in it (unknowns → "Other") via `onBatch`.
 * Returns the map of profileUrn → result for successfully-resolved people.
 */
export async function classifyConnections(
  people: ClassifyInput[],
  interests: string[],
  predict: PredictFn,
  onBatch?: ClassifyCallbacks['onBatch'],
  onError?: ClassifyCallbacks['onError'],
  throttle?: ClassifyThrottle,
): Promise<Map<string, ClassifyResult>> {
  const batchDelayMs = throttle?.batchDelayMs ?? 500;
  const maxRetries = throttle?.maxRetries ?? 3;
  const backoffMs = throttle?.backoffMs ?? 3000;
  const sleep = throttle?.sleep ?? defaultSleep;
  const aborted = () => throttle?.signal?.aborted === true;

  const out = new Map<string, ClassifyResult>();
  let consecutiveFailures = 0;

  for (let i = 0; i < people.length; i += CLASSIFY_BATCH_SIZE) {
    if (aborted()) break;
    if (i > 0 && batchDelayMs > 0) await sleep(batchDelayMs);

    const batch = people.slice(i, i + CLASSIFY_BATCH_SIZE);
    const urns = batch.map((p) => p.profileUrn);
    const prompt = buildClassifyPrompt(batch, interests);

    // Attempt the batch with exponential backoff.
    let text: string | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (aborted()) break;
      try {
        text = await predict(prompt, { fullResponse: true, maxTokens: 900, temperature: 0, systemPrompt: SYSTEM_PROMPT });
      } catch (e) {
        lastErr = e;
        text = null;
      }
      if (text) break;
      if (attempt < maxRetries && backoffMs > 0) await sleep(backoffMs * 2 ** attempt);
    }
    if (aborted()) break;

    if (!text) {
      onError?.(
        urns,
        lastErr instanceof Error
          ? lastErr
          : new Error('No response — the AI may be rate-limited or the API key may be invalid. Wait a minute, then Retry.'),
      );
      if (++consecutiveFailures >= CIRCUIT_BREAK_AFTER) break; // quota likely exhausted
      continue;
    }
    consecutiveFailures = 0;

    // Responded: resolve every person in the batch. Anyone the model omitted
    // is recorded as "Other" so we don't keep retrying an answered batch.
    const parsed = parseClassifyResponse(text, interests);
    const batchResults = batch.map((person, idx) => {
      const result = parsed.get(idx) ?? { roleCategory: 'Other' as const, interestTags: [] };
      out.set(person.profileUrn, result);
      return { profileUrn: person.profileUrn, ...result };
    });
    if (onBatch) await onBatch(batchResults);
  }

  return out;
}

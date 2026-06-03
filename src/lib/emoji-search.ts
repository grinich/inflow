import { gemoji } from 'gemoji';

export interface EmojiResult {
  emoji: string;
  name: string;
}

/**
 * Matches an in-progress emoji shortcode at the end of the text being typed,
 * e.g. ":smi" -> captures "smi". Used by the compose box and message editor to
 * trigger emoji autocomplete. Anchored to the end; capture group 1 is the query.
 */
export const EMOJI_SHORTCODE_RE = /:([a-z0-9_+-]*)$/;

interface EmojiEntry {
  emoji: string;
  name: string;
  tags: string[];
}

// Build flat searchable list from gemoji data.
// Each gemoji entry has names[] (array of shortcode names) and tags[].
// We flatten so each name gets its own entry for simpler search.
const entries: EmojiEntry[] = [];
for (const g of gemoji) {
  for (const name of g.names) {
    entries.push({ emoji: g.emoji, name, tags: g.tags });
  }
}

// Popular emojis shown when query is empty (just typed `:`)
const POPULAR = [
  'thumbsup', 'heart', 'smile', 'fire', 'rocket',
  'eyes', 'tada', 'pray', 'ok_hand', 'wave',
];

const popularResults: EmojiResult[] = POPULAR
  .map((n) => entries.find((e) => e.name === n))
  .filter((e): e is EmojiEntry => !!e)
  .map((e) => ({ emoji: e.emoji, name: e.name }));

export function searchEmoji(query: string, limit = 8): EmojiResult[] {
  if (!query) return popularResults.slice(0, limit);

  const q = query.toLowerCase();

  // Rank each emoji by its BEST match: exact name (0) > name-prefix (1) > tag-prefix (2).
  // Scan the full (small, in-memory) list — no early budget cutoff — so a perfect
  // match can never be buried behind, or dropped before, weaker matches.
  const best = new Map<string, { rank: number; name: string }>();
  for (const entry of entries) {
    let rank = -1;
    if (entry.name === q) rank = 0;
    else if (entry.name.startsWith(q)) rank = 1;
    else if (entry.tags.some((t) => t.startsWith(q))) rank = 2;
    if (rank === -1) continue;
    const cur = best.get(entry.emoji);
    if (!cur || rank < cur.rank) best.set(entry.emoji, { rank, name: entry.name });
  }

  // Map iteration preserves first-seen (gemoji) order; sort is stable, so within
  // each rank tier the original ordering is kept.
  return [...best.entries()]
    .map(([emoji, v]) => ({ emoji, name: v.name, rank: v.rank }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ emoji, name }) => ({ emoji, name }));
}

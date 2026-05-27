import { gemoji } from 'gemoji';

export interface EmojiResult {
  emoji: string;
  name: string;
}

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

  // Partition into name-prefix matches and tag-prefix matches
  const nameMatches: EmojiResult[] = [];
  const tagMatches: EmojiResult[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (nameMatches.length + tagMatches.length >= limit * 3) break;

    if (entry.name.startsWith(q)) {
      if (!seen.has(entry.emoji)) {
        seen.add(entry.emoji);
        nameMatches.push({ emoji: entry.emoji, name: entry.name });
      }
    } else if (entry.tags.some((t) => t.startsWith(q))) {
      if (!seen.has(entry.emoji)) {
        seen.add(entry.emoji);
        tagMatches.push({ emoji: entry.emoji, name: entry.name });
      }
    }
  }

  return [...nameMatches, ...tagMatches].slice(0, limit);
}

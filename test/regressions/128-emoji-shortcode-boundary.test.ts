/**
 * Regression: the emoji shortcode trigger fired mid-word, swallowing Enter.
 *
 * EMOJI_SHORTCODE_RE had no left boundary, so any colon directly after a word
 * character opened the emoji popup: typing "ratio is 3:1" matched with query
 * "1" (💯, 🥇, 🔢), the textarea got data-emoji-open, useKeyboard skipped
 * send, and Enter INSERTED an emoji — "ratio is 3:💯" — instead of sending
 * the message. Same for scores ("100:8") and times ("10:1").
 *
 * Real shortcodes start at a word boundary: the colon must be at the start of
 * the text or preceded by whitespace.
 */
import { EMOJI_SHORTCODE_RE, searchEmoji } from '@/lib/emoji-search';

function queryFor(textBeforeCursor: string): string | null {
  const m = textBeforeCursor.match(EMOJI_SHORTCODE_RE);
  return m ? m[1] : null;
}

it('does not trigger on a colon inside a word or number', () => {
  expect(queryFor('ratio is 3:1')).toBeNull();
  expect(queryFor('the score was 100:8')).toBeNull();
  expect(queryFor('meet at 10:3')).toBeNull();
  expect(queryFor('http:')).toBeNull();
});

it('still triggers at the start of the message', () => {
  expect(queryFor(':fire')).toBe('fire');
  expect(queryFor(':')).toBe('');
});

it('still triggers after whitespace', () => {
  expect(queryFor('great job :tada')).toBe('tada');
  expect(queryFor('line one\n:smi')).toBe('smi');
});

it('the mid-number query would have produced emoji results (the swallow-Enter path)', () => {
  // Guard the mechanism: "1" DOES match emoji (💯 100, 1st_place_medal…), so a
  // false trigger is not harmless — it consumes Enter.
  expect(searchEmoji('1').length).toBeGreaterThan(0);
});

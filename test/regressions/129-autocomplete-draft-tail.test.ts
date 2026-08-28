/**
 * Regression: the autocomplete prompt HEAD-truncated the in-progress draft,
 * asking the model to complete the wrong prefix.
 *
 * The line being completed was built with the same head-truncation used for
 * history (first 100 chars + "..."). With a 250-char draft the model saw a
 * sentence fragment ending mid-message and predicted a continuation of char
 * 100 — which useAutocomplete then appended at char 250. The draft line needs
 * a TAIL window: the model must see the text immediately before the cursor.
 */
import { buildAutocompletePrompt } from '@/lib/autocomplete-prompt';

it('keeps the tail of a long draft, not the head', () => {
  const draft =
    'I wanted to circle back on the conversation we had last week about the platform migration timeline. ' +
    'After talking it over with the team, we think the best path forward is to start with the';
  const prompt = buildAutocompletePrompt([], ['Kane'], draft)!;

  const youLine = prompt.split('\n').find((l) => l.startsWith('You: '))!;
  // The completion context must end with what the user just typed…
  expect(youLine.endsWith('to start with the')).toBe(true);
  // …never with an ellipsis after the head of the message.
  expect(youLine.endsWith('...')).toBe(false);
});

it('leaves short drafts untouched', () => {
  const prompt = buildAutocompletePrompt([], ['Kane'], 'sounds good, let me')!;
  expect(prompt).toContain('You: sounds good, let me');
});

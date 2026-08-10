// @vitest-environment jsdom
// The clickable emoji picker: default grid, search, select, and close.
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker } from '@/components/thread/EmojiPicker';
import { COMMON_EMOJI, searchEmoji } from '@/lib/emoji-search';

it('has a non-empty curated common set for the default grid', () => {
  expect(COMMON_EMOJI.length).toBeGreaterThan(20);
  // Sanity: entries carry a real emoji glyph + name.
  expect(COMMON_EMOJI[0].emoji).toBeTruthy();
  expect(COMMON_EMOJI[0].name).toBeTruthy();
});

it('shows the common grid by default and fires onSelect with the emoji char', () => {
  const onSelect = vi.fn();
  render(<EmojiPicker onSelect={onSelect} onClose={vi.fn()} />);

  // A known common emoji (🔥 fire) is present as a button.
  const fire = screen.getByRole('button', { name: 'fire' });
  fireEvent.mouseDown(fire);
  expect(onSelect).toHaveBeenCalledWith('🔥');
});

it('filters to matches when searching', () => {
  render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(/Search emoji/i), { target: { value: 'rocket' } });
  const expected = searchEmoji('rocket', 64)[0].emoji; // 🚀
  expect(screen.getByRole('button', { name: 'rocket' }).textContent).toBe(expected);
});

it('closes on Escape', () => {
  const onClose = vi.fn();
  render(<EmojiPicker onSelect={vi.fn()} onClose={onClose} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

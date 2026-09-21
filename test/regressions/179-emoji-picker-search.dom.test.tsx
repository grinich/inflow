// @vitest-environment jsdom
// The reaction picker used to offer a hardcoded tray of 20 emoji, which was
// our own limit, not LinkedIn's: `reactWithEmoji` takes any emoji string and
// reaction summaries come back verbatim. The picker now searches the whole
// gemoji set — the same data behind `:shortcode` autocomplete — with the 20 as
// the starting point before anything is typed.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

const reactToMessage = vi.fn();
vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    reactToMessage,
    editMessage: vi.fn(),
    recallMessage: vi.fn(),
  }),
}));

import { render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

function openPicker() {
  reactToMessage.mockClear();
  const view = render(
    <MessageBubble
      message={makeMessage({ id: 'urn:li:msg_message:search', isFromMe: false })}
      grouped={false}
      isLastInGroup={false}
      senderProfileUrl={null}
    />,
  );
  fireEvent.click(view.getByTitle('More reactions'));
  const picker = view.container.querySelector('[data-emoji-picker]') as HTMLElement;
  const search = picker.querySelector('[data-emoji-search]') as HTMLInputElement;
  const emojis = () => [...picker.querySelectorAll('button')].map((b) => b.textContent);
  return { ...view, picker, search, emojis };
}

describe('regression #179: the reaction picker searches every emoji', () => {
  it('starts on the quick picks and takes focus for typing', () => {
    const { search, emojis } = openPicker();
    expect(emojis()).toContain('👍');
    expect(emojis()).toHaveLength(20);
    expect(document.activeElement).toBe(search);
  });

  it('finds emoji well outside the old tray of 20', () => {
    const { search, emojis } = openPicker();
    fireEvent.change(search, { target: { value: 'dragon' } });
    expect(emojis()).toContain('🐉');
    expect(emojis()).not.toContain('👍');
  });

  it('matches on tags, not just the exact shortcode', () => {
    const { search, emojis } = openPicker();
    fireEvent.change(search, { target: { value: 'coffee' } });
    expect(emojis().length).toBeGreaterThan(0);
    expect(emojis()).toContain('☕');
  });

  it('reacts with a searched emoji on click', () => {
    const { search, picker } = openPicker();
    fireEvent.change(search, { target: { value: 'taco' } });
    const taco = [...picker.querySelectorAll('button')].find((b) => b.textContent === '🌮')!;
    fireEvent.click(taco);
    expect(reactToMessage).toHaveBeenCalledWith(expect.any(String), 'urn:li:msg_message:search', '🌮');
  });

  it('picks the highlighted result with the keyboard', () => {
    const { search } = openPicker();
    fireEvent.change(search, { target: { value: 'rocket' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(reactToMessage).toHaveBeenCalledWith(expect.any(String), 'urn:li:msg_message:search', '🚀');
  });

  it('moves the selection with the arrow keys', () => {
    const { search, picker } = openPicker();
    const selected = () => picker.querySelector('[data-emoji-selected]')!.textContent;
    fireEvent.keyDown(search, { key: 'ArrowRight' });
    expect(selected()).toBe('👎');
    // One row down is six columns along
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(selected()).toBe('🔥');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(reactToMessage).toHaveBeenCalledWith(expect.any(String), 'urn:li:msg_message:search', '🔥');
  });

  it('closes on Escape without reacting', () => {
    const { search, container } = openPicker();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(container.querySelector('[data-emoji-picker]')).toBeNull();
    expect(reactToMessage).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', () => {
    const { search, picker } = openPicker();
    fireEvent.change(search, { target: { value: 'zzzznope' } });
    expect(picker.querySelectorAll('button')).toHaveLength(0);
    expect(picker.textContent).toContain('No emoji');
  });
});

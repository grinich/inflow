// @vitest-environment jsdom
// A reaction that appears in real time gets a pop-in animation
// (animate-reaction-pop). Reactions already present when the bubble first
// mounts (e.g. on thread open / scroll) must NOT animate — only ones added
// while the bubble is on screen.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';
import type { ReactionSummary } from '@/types/message';

function reaction(emoji: string): ReactionSummary {
  return { emoji, count: 1, firstReactedAt: 1000, viewerReacted: false };
}

function pillFor(emoji: string): HTMLElement {
  // Scope to the reaction pills (the quick-react hover menu shows emojis too).
  // Match by attribute value in JS — jsdom's querySelector mishandles astral
  // emoji chars inside attribute selectors.
  const pills = Array.from(document.querySelectorAll('[data-reaction-pill]'));
  const pill = pills.find((el) => el.getAttribute('data-reaction-pill') === emoji);
  if (!pill) throw new Error(`reaction pill for ${emoji} not found`);
  return pill as HTMLElement;
}

function props(reactions: ReactionSummary[]) {
  return {
    message: makeMessage({ id: 'urn:li:msg_message:react', body: 'hi', isFromMe: false, reactions }),
    grouped: false,
    isLastInGroup: false,
    senderProfileUrl: null,
  };
}

it('does not animate reactions already present on first render', () => {
  render(<MessageBubble {...props([reaction('👍')])} />);
  expect(pillFor('👍').className).not.toContain('animate-reaction-pop');
});

it('animates a reaction that appears after mount, but not the existing ones', () => {
  const { rerender } = render(<MessageBubble {...props([reaction('👍')])} />);
  expect(pillFor('👍').className).not.toContain('animate-reaction-pop');

  // A new reaction arrives while the bubble is on screen
  rerender(<MessageBubble {...props([reaction('👍'), reaction('🎉')])} />);

  expect(pillFor('🎉').className).toContain('animate-reaction-pop'); // newly added → pops
  expect(pillFor('👍').className).not.toContain('animate-reaction-pop'); // pre-existing → static
});

it('stops animating a reaction on the next render after it appeared', () => {
  const { rerender } = render(<MessageBubble {...props([reaction('👍')])} />);
  rerender(<MessageBubble {...props([reaction('👍'), reaction('🎉')])} />);
  expect(pillFor('🎉').className).toContain('animate-reaction-pop');

  // An unrelated re-render (e.g. another field changes) must not keep replaying it
  rerender(<MessageBubble {...props([reaction('👍'), reaction('🎉')])} />);
  expect(pillFor('🎉').className).not.toContain('animate-reaction-pop');
});

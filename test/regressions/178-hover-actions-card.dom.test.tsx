// @vitest-environment jsdom
// Bug: the hover action strip lived in the gutter beside the bubble, which the
// thread pane often can't spare — a wide bubble left under ~200px, so the
// quick reactions, the "More reactions" button and the timestamp clipped at
// the pane edge (the scroll container is overflow-x-hidden). The emoji picker
// hanging off that strip also rendered *behind* later message bubbles: the
// strip's own `-translate-y-1/2` made it a stacking context with z-index auto,
// so its z-50 popover was trapped inside it and lost to any later `relative`
// bubble in DOM order.
//
// Fix (Slack-style): the actions moved onto the bubble itself as a floating
// card straddling its top right corner, with a real z-index, and the card
// clamps to the scroll container when the bubble sits near an edge.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

/** Scroll container occupying x ∈ [360, 960] — a thread pane beside the list. */
const CONTAINER = { top: 64, bottom: 800, left: 360, right: 960, width: 600, height: 736 };

const realRect = Element.prototype.getBoundingClientRect;

/**
 * Stub layout: the card reports `cardRect` as its natural position, moved by
 * whatever translateX it currently carries — the way a real browser reports a
 * transformed element, so a second measurement can't silently compound.
 */
function stubLayout(cardRect: { top: number; left: number; right: number }) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-scroll-container')) return { ...CONTAINER } as DOMRect;
    if (this.hasAttribute('data-hover-actions')) {
      const applied = Number(
        /translateX\((-?[\d.]+)px\)/.exec((this as HTMLElement).style.transform)?.[1] ?? 0,
      );
      return {
        ...cardRect,
        left: cardRect.left + applied,
        right: cardRect.right + applied,
        bottom: cardRect.top + 34,
        width: cardRect.right - cardRect.left,
        height: 34,
      } as DOMRect;
    }
    return realRect.call(this);
  };
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function renderBubble(isFromMe: boolean) {
  const scroll = document.createElement('div');
  scroll.setAttribute('data-scroll-container', '');
  document.body.appendChild(scroll);
  const view = render(
    <MessageBubble
      message={makeMessage({ id: `urn:li:msg_message:card-${isFromMe}`, isFromMe })}
      grouped={false}
      isLastInGroup={false}
      senderProfileUrl={null}
    />,
    { container: scroll },
  );
  const card = scroll.querySelector('[data-hover-actions]') as HTMLElement;
  const row = scroll.querySelector('[data-message-id]') as HTMLElement;
  return { ...view, card, row };
}

describe('regression #178: hover actions ride the bubble, not the gutter', () => {
  it('anchors the card to the top right corner of a received bubble', () => {
    const { card } = renderBubble(false);
    expect(card.className).toContain('absolute');
    expect(card.className).toContain('-top-5');
    expect(card.className).toContain('right-2');
    expect(card.className).not.toContain('left-full');
  });

  it('keeps sent bubbles on the same corner rather than mirroring', () => {
    const { card } = renderBubble(true);
    expect(card.className).toContain('right-2');
    expect(card.className).not.toContain('left-2');
    expect(card.className).not.toContain('right-full');
  });

  it('gives the card a stacking context that outranks later bubbles', () => {
    const { card, getByTitle, row } = renderBubble(false);
    // A positive z-index paints the card — and the popover nested inside it —
    // above the `relative` (z-auto) bubbles that follow it in the thread.
    expect(card.className).toMatch(/\bz-\d+\b/);
    fireEvent.click(getByTitle('More reactions'));
    const picker = row.querySelector('[data-emoji-picker]')!;
    expect(card.contains(picker)).toBe(true);
  });

  it('keeps the card interactive while the picker is open', () => {
    const { card, getByTitle } = renderBubble(false);
    // Hover-only until then: the invisible card must not eat clicks
    expect(card.className).toContain('pointer-events-none');
    fireEvent.click(getByTitle('More reactions'));
    // Mouse can now leave the message without the open picker fading out
    expect(card.className).not.toContain('pointer-events-none');
    expect(card.className).toContain('opacity-100');
  });

  it('slides the card back inside the pane when the bubble sits near an edge', () => {
    // A short received bubble hugs the pane's left edge, so a card hung off its
    // right corner reaches back to x=200 — 168px short of the usable edge.
    stubLayout({ top: 300, left: 200, right: 436 });
    const { card, row } = renderBubble(false);
    fireEvent.mouseEnter(row);
    expect(card.style.transform).toBe('translateX(168px)');
  });

  it('slides the card in from the right edge too', () => {
    stubLayout({ top: 300, left: 800, right: 1036 });
    const { card, row } = renderBubble(true);
    fireEvent.mouseEnter(row);
    expect(card.style.transform).toBe('translateX(-84px)');
  });

  it('does not compound the correction when the message is hovered again', () => {
    stubLayout({ top: 300, left: 200, right: 436 });
    const { card, row } = renderBubble(false);
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.mouseEnter(row);
    expect(card.style.transform).toBe('translateX(168px)');
  });

  it('leaves a card that already fits untouched', () => {
    stubLayout({ top: 300, left: 500, right: 736 });
    const { card, row } = renderBubble(false);
    fireEvent.mouseEnter(row);
    expect(card.style.transform).toBe('');
  });
});

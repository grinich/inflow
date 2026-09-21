// @vitest-environment jsdom
// Bug: the reaction emoji picker chose its vertical placement (above/below the
// smiley button) but never its horizontal one — it was hard-anchored `left-0`
// for received messages and `right-0` for sent ones. The hover strip sits
// beside the bubble, so on a wide bubble or a narrow thread pane the grid ran
// past the edge of the scroll container, which clips (`overflow-x-hidden`):
// the outer columns were simply cut off and unclickable.
//
// Fix: measure the picker against the scroll container and translate it back
// inside, keeping an 8px margin; pick the side of the button with more room
// and cap the height to it.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

/** Scroll container occupying x ∈ [360, 960], y ∈ [64, 800]. */
const CONTAINER = { top: 64, bottom: 800, left: 360, right: 960, width: 600, height: 736 };

const realRect = Element.prototype.getBoundingClientRect;

/**
 * Stub layout: the scroll container gets a fixed viewport box, the picker the
 * position it would take with no correction applied, and the smiley button it
 * hangs off — which is what decides above vs. below — `anchorTop`.
 */
function stubLayout(
  pickerRect: { top: number; left: number; right: number },
  anchorTop = 400,
) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-scroll-container')) return { ...CONTAINER } as DOMRect;
    if (this.hasAttribute('data-emoji-anchor')) {
      return { top: anchorTop, bottom: anchorTop + 28, left: 700, right: 728, width: 28, height: 28 } as DOMRect;
    }
    if (this.hasAttribute('data-emoji-picker')) {
      return {
        ...pickerRect,
        bottom: pickerRect.top + 240,
        width: pickerRect.right - pickerRect.left,
        height: 240,
      } as DOMRect;
    }
    return realRect.call(this);
  };
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function openPicker(isFromMe: boolean) {
  const scroll = document.createElement('div');
  scroll.setAttribute('data-scroll-container', '');
  document.body.appendChild(scroll);
  const { getByTitle, container } = render(
    <MessageBubble
      message={makeMessage({ id: 'urn:li:msg_message:picker', isFromMe })}
      grouped={false}
      isLastInGroup={false}
      senderProfileUrl={null}
    />,
    { container: scroll },
  );
  fireEvent.click(getByTitle('More reactions'));
  const picker = container.querySelector('[data-emoji-picker]') as HTMLElement;
  expect(picker).not.toBeNull();
  return picker;
}

describe('regression #177: emoji picker stays inside the thread pane', () => {
  it('slides a received-message picker left when it overflows the right edge', () => {
    // Opens rightward from x=800, so its right edge (1040) is 80px past the
    // container and 88px past the 8px margin.
    stubLayout({ top: 300, left: 800, right: 1040 });
    expect(openPicker(false).style.transform).toBe('translateX(-88px)');
  });

  it('slides a sent-message picker right when it overflows the left edge', () => {
    // Sent messages open leftward (`right-0`), so a bubble near the pane's
    // left edge pushes the grid out the other side.
    stubLayout({ top: 300, left: 100, right: 340 });
    expect(openPicker(true).style.transform).toBe('translateX(268px)');
  });

  it('leaves a picker that already fits untouched', () => {
    stubLayout({ top: 300, left: 500, right: 740 });
    expect(openPicker(false).style.transform).toBe('');
  });

  it('opens below the button when the room above is thinner', () => {
    stubLayout({ top: 300, left: 500, right: 740 }, /* anchorTop */ 120);
    const picker = openPicker(false);
    expect(picker.className).toContain('top-full');
    expect(picker.className).not.toContain('invisible');
    // Capped to the room below: 800 - 148 - 8
    expect(picker.style.maxHeight).toBe('644px');
  });

  it('opens above the button when the room below is thinner', () => {
    stubLayout({ top: 300, left: 500, right: 740 }, /* anchorTop */ 700);
    const picker = openPicker(false);
    expect(picker.className).toContain('bottom-full');
    // Capped to the room above: 700 - 64 - 8
    expect(picker.style.maxHeight).toBe('628px');
  });
});

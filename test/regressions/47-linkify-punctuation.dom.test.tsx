// @vitest-environment jsdom
// Regression: linkify stripped trailing punctuation from a URL match for the
// href/display (correct) but advanced past the FULL raw match, so the stripped
// punctuation was never emitted as plain text. The greedy https?:// branch of
// URL_REGEX includes trailing ".,;:!?" in the raw match, so
// "see https://example.com. Then call me" rendered without the sentence
// period. (Bare-domain matches are unaffected — the TLD \b stops before
// punctuation.)
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

function renderBody(body: string) {
  const message = makeMessage({ id: 'urn:li:msg_message:linkify', body, isFromMe: false });
  return render(
    <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );
}

it('keeps the sentence period after a linkified https URL', () => {
  const { container } = renderBody('see https://example.com. Then call me');
  expect(container.textContent).toContain('see https://example.com. Then call me');
  const link = container.querySelector('a');
  expect(link?.textContent).toBe('https://example.com');
  expect(link?.getAttribute('href')).toBe('https://example.com');
});

it('keeps trailing question marks and commas after https URLs', () => {
  const { container } = renderBody('is it https://example.com/x? or https://example.org/y, hm');
  expect(container.textContent).toContain('is it https://example.com/x? or https://example.org/y, hm');
});

it('still renders bare-domain links with surrounding punctuation intact', () => {
  const { container } = renderBody('see example.com. Then call me');
  expect(container.textContent).toContain('see example.com. Then call me');
  const link = container.querySelector('a');
  expect(link?.textContent).toBe('example.com');
});

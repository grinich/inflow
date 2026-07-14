// @vitest-environment jsdom
// Regression: message links used `break-all`, which lets the browser break a
// URL at ANY character boundary — so "getbitwit.com" rendered as "getbitwit.c"
// / "om" across lines even when the whole URL fit on the next line. Links must
// use `break-words` (overflow-wrap: break-word) instead: wrap the URL as a
// whole word when possible, and only break mid-word when it's longer than the
// bubble.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

function renderBody(body: string, isFromMe = false) {
  const message = makeMessage({ id: 'urn:li:msg_message:linkwrap', body, isFromMe });
  return render(
    <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );
}

it('styles message links with break-words, not break-all', () => {
  const { container } = renderBody('free account on getbitwit.com to run trivia');
  const link = container.querySelector('a[href="https://getbitwit.com"]');
  expect(link).not.toBeNull();
  expect(link!.className).toContain('break-words');
  expect(link!.className).not.toContain('break-all');
});

it('applies the same wrapping to links in own (sent) messages', () => {
  const { container } = renderBody('check https://axrank.ai/ for the report', true);
  const link = container.querySelector('a[href="https://axrank.ai/"]');
  expect(link).not.toBeNull();
  expect(link!.className).toContain('break-words');
  expect(link!.className).not.toContain('break-all');
});

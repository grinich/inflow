// @vitest-environment jsdom
// Regression: LinkedIn delivers @-mentions as body.attributes with the
// mentioned person's profile URN, but every normalize path kept only
// body.text — so a mentioned name (e.g. "Nathaniel Botwick") rendered as
// plain text with no profile link. Mentions must render as links to the
// mentioned entity's LinkedIn page.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';
import type { MessageMention } from '@/types/message';

function renderBody(body: string, mentions: MessageMention[], isFromMe = false) {
  const message = makeMessage({ id: 'urn:li:msg_message:mention', body, mentions, isFromMe });
  return render(
    <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );
}

it('renders a mentioned person as a link to their profile', () => {
  const body = 'Thanks Nathaniel Botwick for the intro!';
  const { container } = renderBody(body, [
    { start: 7, length: 17, urn: 'urn:li:fsd_profile:NATE123' },
  ]);
  const link = container.querySelector('a[href="https://www.linkedin.com/in/NATE123"]');
  expect(link).not.toBeNull();
  expect(link!.textContent).toBe('Nathaniel Botwick');
  expect(link!.getAttribute('target')).toBe('_blank');
  expect(link!.getAttribute('rel')).toContain('noopener');
  // Surrounding text is preserved
  expect(container.textContent).toContain('Thanks ');
  expect(container.textContent).toContain(' for the intro!');
});

it('renders a mentioned company as a link to its company page', () => {
  const body = 'I just joined Acme Corp today';
  const { container } = renderBody(body, [
    { start: 14, length: 9, urn: 'urn:li:fsd_company:12345' },
  ]);
  const link = container.querySelector('a[href="https://www.linkedin.com/company/12345"]');
  expect(link).not.toBeNull();
  expect(link!.textContent).toBe('Acme Corp');
});

it('renders multiple mentions alongside a URL link', () => {
  const body = 'Alice Smith meet Bob Jones — see example.com';
  const { container } = renderBody(body, [
    { start: 0, length: 11, urn: 'urn:li:fsd_profile:ALICE' },
    { start: 17, length: 9, urn: 'urn:li:fsd_profile:BOB' },
  ]);
  expect(container.querySelector('a[href="https://www.linkedin.com/in/ALICE"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://www.linkedin.com/in/BOB"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull();
});

it('a mention takes priority over an overlapping URL/email match', () => {
  // A mentioned display name that itself looks like a domain must link to the
  // profile, not be shadowed by the URL matcher.
  const body = 'ping Acme.io Team about this';
  const { container } = renderBody(body, [
    { start: 5, length: 12, urn: 'urn:li:fsd_company:999' },
  ]);
  const link = container.querySelector('a[href="https://www.linkedin.com/company/999"]');
  expect(link).not.toBeNull();
  expect(link!.textContent).toBe('Acme.io Team');
  expect(container.querySelector('a[href="https://acme.io"]')).toBeNull();
});

it('renders an unrecognized mention URN as plain text', () => {
  const body = 'see Some Group for details';
  const { container } = renderBody(body, [
    { start: 4, length: 10, urn: 'urn:li:fsd_group:777' },
  ]);
  expect(container.querySelectorAll('a[href*="linkedin.com"]')).toHaveLength(0);
  expect(container.textContent).toContain('see Some Group for details');
});

it('messages without mentions render exactly as before', () => {
  const message = makeMessage({
    id: 'urn:li:msg_message:plain',
    body: 'no mentions here, just getbitwit.com',
    isFromMe: false,
  });
  const { container } = render(
    <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );
  expect(container.querySelector('a[href="https://getbitwit.com"]')).not.toBeNull();
});

// @vitest-environment jsdom
// Regression: AvatarCircle set failed=true on <img onError> but never reset it
// when src changed. Conversation rows are long-lived and LinkedIn CDN avatar
// URLs expire and get refreshed by profile sync, so one transient load failure
// showed the letter-initial fallback forever — even after a valid image URL
// became available.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render, fireEvent } from '@testing-library/react';
import { GroupAvatar } from '@/components/common/GroupAvatar';

it('recovers from an image load failure when the picture URL changes', () => {
  const { container, rerender } = render(
    <GroupAvatar names={['Ada']} pictures={['https://cdn.example.com/expired.jpg']} />
  );

  const img = container.querySelector('img');
  expect(img).not.toBeNull();

  // Expired CDN URL fails to load → letter fallback
  fireEvent.error(img!);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('A');

  // Profile sync refreshes the picture URL → the image must come back
  rerender(<GroupAvatar names={['Ada']} pictures={['https://cdn.example.com/fresh.jpg']} />);
  const refreshed = container.querySelector('img');
  expect(refreshed).not.toBeNull();
  expect(refreshed!.getAttribute('src')).toBe('https://cdn.example.com/fresh.jpg');
});

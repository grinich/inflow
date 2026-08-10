// @vitest-environment jsdom
// Right-click menu: set a role or toggle interest tags on one connection.
import '../dom-setup';

const update = vi.fn();
vi.mock('@/db/database', () => ({ db: { connections: { update: (...a: any[]) => update(...a) } } }));
vi.mock('@/hooks/useConnectionInterests', () => ({
  useConnectionInterests: () => [['Investors', 'Physician'], vi.fn()] as const,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionContextMenu } from '@/components/connections/ConnectionContextMenu';
import type { Connection } from '@/types/connection';

const conn: Connection = {
  profileUrn: 'urn:li:fsd_profile:P1',
  connectionUrn: 'c1',
  connectedAt: 0,
  publicId: 'ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  headline: 'Mathematician',
  pictureUrl: '',
  syncedAt: 0,
};

beforeEach(() => update.mockReset());

it('sets a role and stamps categorizedAt', async () => {
  render(<ConnectionContextMenu connection={conn} x={10} y={10} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Founder/ }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      'urn:li:fsd_profile:P1',
      expect.objectContaining({ roleCategory: 'Founder', categorizedAt: expect.any(Number) }),
    ),
  );
});

it('toggles an interest tag', async () => {
  render(<ConnectionContextMenu connection={conn} x={10} y={10} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Investors/ }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      'urn:li:fsd_profile:P1',
      expect.objectContaining({ interestTags: ['Investors'] }),
    ),
  );
});

it('removes a tag the connection already has', async () => {
  render(
    <ConnectionContextMenu connection={{ ...conn, interestTags: ['Investors'] }} x={10} y={10} onClose={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Investors/ }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith('urn:li:fsd_profile:P1', expect.objectContaining({ interestTags: [] })),
  );
});

it('closes on Escape', () => {
  const onClose = vi.fn();
  render(<ConnectionContextMenu connection={conn} x={10} y={10} onClose={onClose} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

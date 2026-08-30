// @vitest-environment jsdom
// Mutual connections on the invitation detail: the faces, then "X and N other
// mutual connections", between the bio and View Profile.
//
// The data was being requested all along (`includeInsights=true`) but never
// read: the insight hangs off the InvitationView, and the parser looked for it
// on the Invitation. So the line silently never appeared.
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { InvitationDetail } from '@/components/network/InvitationDetail';
import { mutualsLabel } from '@/components/network/MutualConnections';
import type { Invitation } from '@/types/network';

function invitation(over: Partial<Invitation> = {}): Invitation {
  return {
    id: 'i1', sharedSecret: 's', fromUrn: 'urn:li:fsd_profile:p1', name: 'Grace Hopper',
    headline: 'Rear Admiral @ US Navy', pictureUrl: '', publicId: 'grace', message: '',
    sentAt: 1_750_000_000_000, status: 'pending',
    mutualCount: 63, mutualNames: ['Viren Baraiya'],
    mutualPictures: ['https://media.licdn.com/mutual/viren.jpg'],
    ...over,
  };
}

const renderDetail = (over: Partial<Invitation> = {}) =>
  render(
    <InvitationDetail
      invitation={invitation(over)}
      onAccept={() => {}}
      onIgnore={() => {}}
      onOpenProfile={() => {}}
    />
  );

describe('regression #161: mutual connections on an invitation', () => {
  it('names one mutual and counts the rest', () => {
    renderDetail();

    expect(screen.getByText('Viren Baraiya and 62 other mutual connections')).toBeTruthy();
  });

  it('shows the mutual’s face', () => {
    const { container } = renderDetail();
    const img = container.querySelector('img[src="https://media.licdn.com/mutual/viren.jpg"]');

    expect(img).toBeTruthy();
    // Decorative — the sentence beside it already names them.
    expect(img!.getAttribute('aria-hidden')).toBe('true');
  });

  it('sits between the bio and View Profile', () => {
    const { container } = renderDetail();
    const text = container.textContent!;

    expect(text.indexOf('Rear Admiral')).toBeLessThan(text.indexOf('Viren Baraiya'));
    expect(text.indexOf('Viren Baraiya')).toBeLessThan(text.indexOf('View Profile'));
  });

  it('says nothing at all when there are no mutuals', () => {
    renderDetail({ mutualCount: 0, mutualNames: [], mutualPictures: [] });

    expect(screen.queryByText(/mutual connection/)).toBeNull();
  });

  it('renders no face when the payload named nobody', () => {
    // A count with no named mutual still deserves the line, just without a
    // picture we do not have.
    const { container } = renderDetail({ mutualNames: [], mutualPictures: [] });

    expect(screen.getByText('63 mutual connections')).toBeTruthy();
    expect(container.querySelector('img[src^="https://media.licdn.com/mutual"]')).toBeNull();
  });
});

describe('mutualsLabel', () => {
  const label = (mutualCount: number, mutualNames: string[] = []) =>
    mutualsLabel({ mutualCount, mutualNames, mutualPictures: [] });

  it.each([
    [63, ['Viren Baraiya'], 'Viren Baraiya and 62 other mutual connections'],
    [2, ['Ada Lovelace'], 'Ada Lovelace and 1 other mutual connection'],
    [1, ['Ada Lovelace'], 'Ada Lovelace is a mutual connection'],
    [7, [], '7 mutual connections'],
    [1, [], '1 mutual connection'],
  ])('reads %i / %j as %j', (count, names, expected) => {
    expect(label(count, names)).toBe(expected);
  });
});

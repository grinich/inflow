// @vitest-environment jsdom
// Mutual connections on the invitation detail: the faces, then "X and N other
// mutual connections", between the bio and View Profile.
//
// The data was being requested all along (`includeInsights=true`) but never
// read: the insight hangs off the InvitationView, and the parser looked for it
// on the Invitation. So the line silently never appeared.
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';

// Recorded rather than replaced: the hook returns the url until the bytes are
// cached, so the existing assertions still hold and we can also see that these
// faces go through it at all.
const cachedFor: string[] = [];
vi.mock('@/hooks/useCachedImage', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useCachedImage: (url?: string) => {
      if (url) cachedFor.push(url);
      return url;
    },
  };
});
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

// Every avatar in the app goes through the image cache; these did not. LinkedIn
// CDN urls carry an expiry and a signature, and invitation rows are stored — so
// the url outlives the page that produced it and a raw <img> eventually shows a
// broken face where every other avatar still works.
describe('regression #161: mutual faces go through the image cache', () => {
  beforeEach(() => { cachedFor.length = 0; });

  it('loads the face through the cache rather than straight from the CDN', () => {
    renderDetail();

    expect(cachedFor).toContain('https://media.licdn.com/mutual/viren.jpg');
  });

  it('drops a face that fails to load instead of showing a broken image', () => {
    // Decorative — the sentence beside it carries the meaning, so a broken
    // image or a letter tile would both be noise.
    const { container } = renderDetail();
    const img = container.querySelector('img[src="https://media.licdn.com/mutual/viren.jpg"]')!;

    fireEvent.error(img);

    expect(container.querySelector('img[src^="https://media.licdn.com/mutual"]')).toBeNull();
    // The sentence stays.
    expect(screen.getByText(/mutual connection/)).toBeTruthy();
  });
});

import { normalizeConnections } from '@/lib/connections-normalizer';

// ---------------------------------------------------------------------------
// Fixture helpers — mirror the real `/relationships/dash/connections`
// (accept: normalized+json) response shape confirmed against live Voyager.
// ---------------------------------------------------------------------------

function makeConnection(opts: { id: string; profileId: string; createdAt: number }) {
  const profileUrn = `urn:li:fsd_profile:${opts.profileId}`;
  return {
    $type: 'com.linkedin.voyager.dash.relationships.Connection',
    entityUrn: `urn:li:fsd_connection:${opts.id}`,
    createdAt: opts.createdAt,
    connectedMember: profileUrn,
    '*connectedMemberResolutionResult': profileUrn,
  };
}

function makeProfile(opts: {
  profileId: string;
  firstName: string;
  lastName: string;
  headline?: string;
  publicId?: string;
  pictureSegment?: string;
}) {
  return {
    $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
    entityUrn: `urn:li:fsd_profile:${opts.profileId}`,
    firstName: opts.firstName,
    lastName: opts.lastName,
    headline: opts.headline ?? '',
    publicIdentifier: opts.publicId ?? '',
    profilePicture: opts.pictureSegment
      ? {
          displayImageReference: {
            vectorImage: {
              rootUrl: 'https://cdn.example.com/',
              artifacts: [
                { width: 100, height: 100, fileIdentifyingUrlPathSegment: opts.pictureSegment },
              ],
            },
          },
        }
      : undefined,
  };
}

function makeResponse(elements: string[], included: any[]) {
  return {
    data: {
      $type: 'com.linkedin.restli.common.CollectionResponse',
      entityUrn: 'urn:li:fsd_connectionList:1',
      paging: { count: elements.length, start: 0, links: [] },
      '*elements': elements,
    },
    included,
  };
}

describe('normalizeConnections', () => {
  it('parses connections with their resolved profile fields', () => {
    const raw = makeResponse(
      ['urn:li:fsd_connection:C1'],
      [
        makeConnection({ id: 'C1', profileId: 'P1', createdAt: 1785945393000 }),
        makeProfile({
          profileId: 'P1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          headline: 'Mathematician',
          publicId: 'adalovelace',
          pictureSegment: '100_100/ada.jpg',
        }),
      ],
    );

    const { connections, profiles } = normalizeConnections(raw, 999);
    expect(connections).toHaveLength(1);
    const c = connections[0];
    expect(c.profileUrn).toBe('urn:li:fsd_profile:P1');
    expect(c.connectionUrn).toBe('urn:li:fsd_connection:C1');
    expect(c.connectedAt).toBe(1785945393000);
    expect(c.fullName).toBe('Ada Lovelace');
    expect(c.headline).toBe('Mathematician');
    expect(c.publicId).toBe('adalovelace');
    expect(c.pictureUrl).toBe('https://cdn.example.com/100_100/ada.jpg');
    expect(c.syncedAt).toBe(999);

    // Underlying profile is also emitted for the profiles table.
    expect(profiles).toHaveLength(1);
    expect(profiles[0].urn).toBe('urn:li:fsd_profile:P1');
    expect(profiles[0].occupation).toBe('Mathematician');
  });

  it('preserves the RECENTLY_ADDED order from data.*elements, not included order', () => {
    // included lists P1's connection first, but *elements says C2 (newer) is first.
    const raw = makeResponse(
      ['urn:li:fsd_connection:C2', 'urn:li:fsd_connection:C1'],
      [
        makeConnection({ id: 'C1', profileId: 'P1', createdAt: 1000 }),
        makeProfile({ profileId: 'P1', firstName: 'Older', lastName: 'One' }),
        makeConnection({ id: 'C2', profileId: 'P2', createdAt: 2000 }),
        makeProfile({ profileId: 'P2', firstName: 'Newer', lastName: 'Two' }),
      ],
    );

    const { connections } = normalizeConnections(raw);
    expect(connections.map((c) => c.fullName)).toEqual(['Newer Two', 'Older One']);
  });

  it('falls back to included order when *elements is absent', () => {
    const raw = {
      data: { paging: { count: 2, start: 0 } },
      included: [
        makeConnection({ id: 'C1', profileId: 'P1', createdAt: 1000 }),
        makeProfile({ profileId: 'P1', firstName: 'First', lastName: 'A' }),
        makeConnection({ id: 'C2', profileId: 'P2', createdAt: 2000 }),
        makeProfile({ profileId: 'P2', firstName: 'Second', lastName: 'B' }),
      ],
    };
    const { connections } = normalizeConnections(raw);
    expect(connections.map((c) => c.fullName)).toEqual(['First A', 'Second B']);
  });

  it('emits a connection even when its profile is missing, without a profile row', () => {
    const raw = makeResponse(
      ['urn:li:fsd_connection:C1'],
      [makeConnection({ id: 'C1', profileId: 'P1', createdAt: 1000 })],
    );
    const { connections, profiles } = normalizeConnections(raw);
    expect(connections).toHaveLength(1);
    expect(connections[0].profileUrn).toBe('urn:li:fsd_profile:P1');
    expect(connections[0].fullName).toBe('');
    expect(profiles).toHaveLength(0);
  });

  it('handles empty / malformed input safely', () => {
    expect(normalizeConnections(undefined)).toEqual({ connections: [], profiles: [] });
    expect(normalizeConnections({})).toEqual({ connections: [], profiles: [] });
    expect(normalizeConnections({ included: [] })).toEqual({ connections: [], profiles: [] });
  });
});

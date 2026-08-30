import { describe, it, expect } from 'vitest';
import { normalizeInvitations, normalizeConnections } from '@/lib/network-normalizer';
import { RAW_INVITATIONS_RESPONSE, RAW_CONNECTIONS_RESPONSE } from '../fixtures/voyager-network';

describe('normalizeInvitations', () => {
  it('joins invitations to sender mini-profiles', () => {
    const { invitations: result } = normalizeInvitations(RAW_INVITATIONS_RESPONSE);
    expect(result).toHaveLength(3);
    const grace = result.find((i) => i.name === 'Grace Hopper')!;
    expect(grace.id).toBe('7300001');
    expect(grace.sharedSecret).toBe('secret-aaa');
    expect(grace.fromUrn).toBe('urn:li:fsd_profile:ACoAAAfrom1');
    expect(grace.headline).toBe('Rear Admiral @ US Navy');
    expect(grace.publicId).toBe('grace-hopper');
    expect(grace.message).toBe('Hey! Loved your post on local-first software.');
    expect(grace.sentAt).toBe(1750000000000);
    expect(grace.status).toBe('pending');
    expect(grace.pictureUrl).toBe('https://media.licdn.com/dms/image/abc/100_100/pic1.jpg');
  });

  it('tolerates missing message and picture', () => {
    const alan = normalizeInvitations(RAW_INVITATIONS_RESPONSE).invitations.find((i) => i.name === 'Alan Turing')!;
    expect(alan.message).toBe('');
    expect(alan.pictureUrl).toBe('');
  });

  it('resolves the sender via the *inviter ref fallback', () => {
    const edsger = normalizeInvitations(RAW_INVITATIONS_RESPONSE).invitations.find((i) => i.name === 'Edsger Dijkstra')!;
    expect(edsger).toBeTruthy();
    expect(edsger.id).toBe('7300003');
    expect(edsger.fromUrn).toBe('urn:li:fsd_profile:ACoAAAfrom3');
    expect(edsger.headline).toBe('Computing Scientist');
  });

  it('returns [] on garbage input', () => {
    expect(normalizeInvitations({})).toEqual({ invitations: [], profiles: [], rawCount: 0 });
    expect(normalizeInvitations(null)).toEqual({ invitations: [], profiles: [], rawCount: 0 });
  });

  it('feeds sender profiles to the shared profile cache', () => {
    const { profiles } = normalizeInvitations(RAW_INVITATIONS_RESPONSE);
    const grace = profiles.find((p) => p.fullName === 'Grace Hopper')!;
    expect(grace.urn).toBe('urn:li:fsd_profile:ACoAAAfrom1');
    expect(grace.publicId).toBe('grace-hopper');
    expect(grace.occupation).toBe('Rear Admiral @ US Navy');
  });

  it('counts the raw entities the server sent, not the readable ones', () => {
    // A page whose entities are all unreadable still reports its true size, so
    // the pagination walk cannot mistake a full page for the end of the list.
    const raw = {
      included: [
        { $type: 'com.linkedin.voyager.relationships.invitation.Invitation' }, // no entityUrn
        { $type: 'com.linkedin.voyager.relationships.invitation.Invitation' },
      ],
    };
    const { invitations, rawCount } = normalizeInvitations(raw);
    expect(invitations).toHaveLength(0);
    expect(rawCount).toBe(2);
  });
});

describe('normalizeInvitations — pictures and insights', () => {
  // Normalized+json hoists shared sub-objects out of their parent and leaves a
  // urn string behind. The extractor only understood inline envelopes, so every
  // by-reference picture resolved to '' and every row fell back to a grey
  // letter avatar.
  const withRefPicture = {
    included: [
      {
        $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
        entityUrn: 'urn:li:fs_miniProfile:ACoAAAref',
        firstName: 'Ada', lastName: 'Lovelace', occupation: 'Analyst',
        publicIdentifier: 'ada',
        '*picture': 'urn:li:fsd_profilePicture:ref-pic',
      },
      {
        entityUrn: 'urn:li:fsd_profilePicture:ref-pic',
        rootUrl: 'https://media.licdn.com/dms/image/ref/',
        artifacts: [{ width: 100, fileIdentifyingUrlPathSegment: '100_100/ada.jpg' }],
      },
      {
        $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
        entityUrn: 'urn:li:fs_relInvitation:7300009',
        '*fromMember': 'urn:li:fs_miniProfile:ACoAAAref',
        sharedSecret: 'secret-ref',
        sentTime: 1750000000000,
      },
    ],
  };

  it('follows a by-reference profile picture', () => {
    const { invitations } = normalizeInvitations(withRefPicture);
    expect(invitations[0].pictureUrl).toBe('https://media.licdn.com/dms/image/ref/100_100/ada.jpg');
  });

  it('reads the shared-connections insight', () => {
    const raw = {
      included: [
        ...withRefPicture.included.map((e: any) =>
          String(e.$type || '').endsWith('invitation.Invitation')
            ? { ...e, '*insight': 'urn:li:fs_insight:i1' }
            : e
        ),
        {
          entityUrn: 'urn:li:fs_insight:i1',
          sharedConnectionsInsight: {
            totalCount: 12,
            '*connections': ['urn:li:fs_miniProfile:ACoAAAmut'],
          },
        },
        {
          $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
          entityUrn: 'urn:li:fs_miniProfile:ACoAAAmut',
          firstName: 'Grace', lastName: 'Hopper',
        },
      ],
    };
    const { invitations } = normalizeInvitations(raw);
    expect(invitations[0].mutualCount).toBe(12);
    expect(invitations[0].mutualNames).toEqual(['Grace Hopper']);
  });

  it('degrades to no mutuals when the insight shape is unrecognised', () => {
    // These entities are undocumented and drift; an unknown shape must not
    // throw and take the whole invitation sync down with it.
    const raw = {
      included: withRefPicture.included.map((e: any) =>
        String(e.$type || '').endsWith('invitation.Invitation')
          ? { ...e, insight: { somethingNewEntirely: { nested: true } } }
          : e
      ),
    };
    const { invitations } = normalizeInvitations(raw);
    expect(invitations[0].mutualCount).toBe(0);
    expect(invitations[0].mutualNames).toEqual([]);
  });
});

describe('normalizeConnections', () => {
  it('joins connection edges to dash profiles', () => {
    const { connections, profiles } = normalizeConnections(RAW_CONNECTIONS_RESPONSE);
    expect(connections).toHaveLength(2);
    const kat = connections.find((c) => c.name === 'Katherine Johnson')!;
    expect(kat.profileUrn).toBe('urn:li:fsd_profile:ACoAAAconn1');
    expect(kat.connectedAt).toBe(1749900000000);
    expect(kat.publicId).toBe('katherine-johnson');
    expect(kat.pictureUrl).toBe('https://media.licdn.com/dms/image/def/200_200/pic2.jpg');
    expect(profiles).toHaveLength(2);
    expect(profiles[0].urn).toMatch(/^urn:li:fsd_profile:/);
    expect(profiles.find((p) => p.fullName === 'Margaret Hamilton')).toBeTruthy();
  });

  it('returns empty on garbage input', () => {
    expect(normalizeConnections({})).toEqual({ connections: [], profiles: [] });
    expect(normalizeConnections(undefined)).toEqual({ connections: [], profiles: [] });
  });
});

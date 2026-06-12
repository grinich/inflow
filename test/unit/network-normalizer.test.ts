import { describe, it, expect } from 'vitest';
import { normalizeInvitations, normalizeConnections } from '@/lib/network-normalizer';
import { RAW_INVITATIONS_RESPONSE, RAW_CONNECTIONS_RESPONSE } from '../fixtures/voyager-network';

describe('normalizeInvitations', () => {
  it('joins invitations to sender mini-profiles', () => {
    const result = normalizeInvitations(RAW_INVITATIONS_RESPONSE);
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
    const alan = normalizeInvitations(RAW_INVITATIONS_RESPONSE).find((i) => i.name === 'Alan Turing')!;
    expect(alan.message).toBe('');
    expect(alan.pictureUrl).toBe('');
  });

  it('resolves the sender via the *inviter ref fallback', () => {
    const edsger = normalizeInvitations(RAW_INVITATIONS_RESPONSE).find((i) => i.name === 'Edsger Dijkstra')!;
    expect(edsger).toBeTruthy();
    expect(edsger.id).toBe('7300003');
    expect(edsger.fromUrn).toBe('urn:li:fsd_profile:ACoAAAfrom3');
    expect(edsger.headline).toBe('Computing Scientist');
  });

  it('returns [] on garbage input', () => {
    expect(normalizeInvitations({})).toEqual([]);
    expect(normalizeInvitations(null)).toEqual([]);
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

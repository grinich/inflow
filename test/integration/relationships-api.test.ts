import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockFetch } from '../mocks/fetch';
import {
  fetchInvitationsRaw,
  fetchConnectionsRaw,
  respondToInvitation,
} from '../../entrypoints/background/api/relationships';
import { RAW_INVITATIONS_RESPONSE, RAW_CONNECTIONS_RESPONSE } from '../fixtures/voyager-network';

describe('relationships API', () => {
  let requests: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    requests = [];
    (globalThis as any).chrome.cookies.get = vi.fn(async ({ name }: { name: string }) => {
      if (name === 'li_at') return { value: 'test-li-at' };
      if (name === 'JSESSIONID') return { value: '"ajax:test"' };
      return null;
    });
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => [
      { name: 'li_at', value: 'test-li-at' },
      { name: 'JSESSIONID', value: '"ajax:test"' },
    ]);
  });

  it('fetchInvitationsRaw hits invitationViews with paging', async () => {
    mockFetch('/voyager/api/relationships/invitationViews', async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(RAW_INVITATIONS_RESPONSE), { status: 200 });
    });
    const raw = await fetchInvitationsRaw(0, 40);
    expect(raw.included.length).toBeGreaterThanOrEqual(4);
    expect(requests[0].url).toContain('q=receivedInvitation');
    expect(requests[0].url).toContain('start=0');
    expect(requests[0].url).toContain('count=40');
  });

  it('respondToInvitation POSTs id + sharedSecret with the action', async () => {
    mockFetch('/voyager/api/relationships/invitations/7300001', async (url, init) => {
      requests.push({ url, init });
      return new Response('', { status: 200 });
    });
    await respondToInvitation('7300001', 'secret-aaa', 'accept');
    expect(requests[0].url).toContain('action=accept');
    expect(requests[0].init?.method).toBe('POST');
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body).toEqual({
      invitationId: '7300001',
      invitationSharedSecret: 'secret-aaa',
      isGenericInvitation: false,
    });
  });

  it('respondToInvitation throws on non-OK status', async () => {
    mockFetch('/voyager/api/relationships/invitations/', async () => new Response('', { status: 403 }));
    await expect(respondToInvitation('1', 's', 'ignore')).rejects.toThrow('403');
  });

  it('fetchConnectionsRaw requests RECENTLY_ADDED with paging', async () => {
    mockFetch('/voyager/api/relationships/dash/connections', async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(RAW_CONNECTIONS_RESPONSE), { status: 200 });
    });
    const raw = await fetchConnectionsRaw(40, 40);
    expect(raw.included.length).toBeGreaterThanOrEqual(4);
    expect(requests[0].url).toContain('sortType=RECENTLY_ADDED');
    expect(requests[0].url).toContain('start=40');
  });
});

// @vitest-environment jsdom
// useConnections hides nameless "Unknown" rows from the whole app.
import '../dom-setup';
import { renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { useConnections } from '@/hooks/useConnections';
import { isNamedConnection } from '@/components/connections/connection-format';
import type { Connection } from '@/types/connection';

function conn(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'p',
    connectionUrn: 'c',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_UC').catch(() => {});
});

describe('isNamedConnection', () => {
  it('accepts a real name, rejects empty/whitespace', () => {
    expect(isNamedConnection({ fullName: 'Ada Lovelace' })).toBe(true);
    expect(isNamedConnection({ fullName: '' })).toBe(false);
    expect(isNamedConnection({ fullName: '   ' })).toBe(false);
    expect(isNamedConnection({ fullName: undefined as any })).toBe(false);
  });
});

describe('useConnections', () => {
  it('filters out connections without a resolvable name', async () => {
    await switchDatabase('MEMBER_UC');
    await db!.connections.bulkPut([
      conn({ profileUrn: 'a', fullName: 'Ada Lovelace', connectedAt: 3 }),
      conn({ profileUrn: 'b', fullName: '', connectedAt: 2 }), // Unknown
      conn({ profileUrn: 'c', fullName: '   ', connectedAt: 1 }), // Unknown (whitespace)
    ]);

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.connections).toHaveLength(1));
    expect(result.current.connections[0].profileUrn).toBe('a');
  });
});

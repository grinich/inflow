/**
 * fetchAllConnections pages through the whole connection list instead of
 * stopping at the first 40 (the bug where only the 40 most-recent people
 * showed). It stops on the first short page and respects the max cap.
 */
import { debugLog } from '@/lib/debug-log';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

const voyagerFetch = vi.fn();
vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: (...args: any[]) => voyagerFetch(...args),
}));

import {
  fetchAllConnections,
  CONNECTIONS_PAGE_SIZE,
  MAX_CONNECTIONS,
} from '../../entrypoints/background/api/connections';

/** A raw page response with `n` connection element refs. */
function page(n: number) {
  const elements = Array.from({ length: n }, (_, i) => `urn:li:fsd_connection:${i}`);
  return new Response(JSON.stringify({ data: { '*elements': elements } }), { status: 200 });
}

/** The query `start=` value from a voyagerFetch call's path argument. */
function startOf(call: any[]): number {
  const m = /start=(\d+)/.exec(call[0]);
  return m ? Number(m[1]) : -1;
}

beforeEach(() => {
  voyagerFetch.mockReset();
});

describe('fetchAllConnections', () => {
  it('pages until a short page and reports the running total', async () => {
    // Two full pages then a partial one → 40 + 40 + 12 = 92 total.
    voyagerFetch
      .mockResolvedValueOnce(page(CONNECTIONS_PAGE_SIZE))
      .mockResolvedValueOnce(page(CONNECTIONS_PAGE_SIZE))
      .mockResolvedValueOnce(page(12));

    const seen: number[] = [];
    const total = await fetchAllConnections(async (raw) => {
      seen.push((raw.data['*elements'] as any[]).length);
    });

    expect(total).toBe(92);
    expect(seen).toEqual([40, 40, 12]);
    expect(voyagerFetch).toHaveBeenCalledTimes(3);
    expect(voyagerFetch.mock.calls.map(startOf)).toEqual([0, 40, 80]);
  });

  it('stops immediately when the first page is already short', async () => {
    voyagerFetch.mockResolvedValueOnce(page(7));
    const total = await fetchAllConnections(() => {});
    expect(total).toBe(7);
    expect(voyagerFetch).toHaveBeenCalledTimes(1);
  });

  it('treats an exactly-full final page followed by an empty page correctly', async () => {
    voyagerFetch
      .mockResolvedValueOnce(page(CONNECTIONS_PAGE_SIZE))
      .mockResolvedValueOnce(page(0));
    const total = await fetchAllConnections(() => {});
    expect(total).toBe(40);
    expect(voyagerFetch).toHaveBeenCalledTimes(2);
  });

  it('never fetches beyond the max cap', async () => {
    // Fresh Response per call — a Response body can only be read once.
    voyagerFetch.mockImplementation(() => Promise.resolve(page(CONNECTIONS_PAGE_SIZE)));
    await fetchAllConnections(() => {}, 100);
    // cap 100 → pages at start 0, 40, 80 (last count clamped to 20), then stop.
    expect(voyagerFetch).toHaveBeenCalledTimes(3);
    const lastCall = voyagerFetch.mock.calls[2][0] as string;
    expect(lastCall).toContain('start=80');
    expect(lastCall).toContain('count=20');
  });

  it('has a sane default cap', () => {
    expect(MAX_CONNECTIONS).toBeGreaterThanOrEqual(500);
  });
});

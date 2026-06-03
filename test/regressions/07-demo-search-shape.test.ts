// Bug (Medium): demo SEARCH_CONVERSATIONS returned { results: [] }, but
// useRemoteSearch reads data.conversationIds / data.nextCursor -> crash.
import { handleDemoBridgeMessage } from '@/lib/demo-mode';

describe('demo SEARCH_CONVERSATIONS response shape', () => {
  it('returns the { conversationIds, nextCursor } shape useRemoteSearch expects', async () => {
    const res: any = await handleDemoBridgeMessage({ type: 'SEARCH_CONVERSATIONS', query: 'x', cursor: null } as any);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.data.conversationIds)).toBe(true);
    expect('nextCursor' in res.data).toBe(true);
  });
});

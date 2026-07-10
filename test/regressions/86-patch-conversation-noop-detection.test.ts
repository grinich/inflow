/**
 * Bug: marking a conversation read/unread sometimes never synced to LinkedIn.
 *
 * The read/unread sync goes through patchConversation, a rest.li batch partial
 * update. Such a request can return HTTP 200 while silently rejecting the entity
 * (an unmatched key or a per-entity error) — so the mutation "succeeded" from the
 * client's view, was never re-queued, and yet the read state never changed on
 * LinkedIn. The failure was invisible: patchConversation only checked res.ok and
 * logged a bare success line.
 *
 * Fix: patchConversation now logs the full server response (both directions) and
 * treats a per-entity error/rejection in a 200 body as a failure, so it surfaces
 * (error log) and re-queues instead of passing quietly. Covers read AND unread —
 * both share patchConversation.
 */
import { debugLog } from '@/lib/debug-log';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

const voyagerFetch = vi.fn();
vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: (...args: any[]) => voyagerFetch(...args),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

import {
  markConversationRead,
  markConversationUnread,
} from '../../entrypoints/background/api/conversations';

const CONV_ID = '2-abc';
const RAW_URN = 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-abc)';

beforeEach(() => {
  voyagerFetch.mockReset();
  vi.mocked(debugLog).mockClear();
});

describe('patchConversation no-op / error detection', () => {
  it('resolves on a 204-style empty 200 body (genuine success)', async () => {
    voyagerFetch.mockResolvedValue(new Response('', { status: 200 }));
    await expect(markConversationRead(CONV_ID)).resolves.toBeUndefined();
  });

  it('resolves when the batch result reports a success status', async () => {
    voyagerFetch.mockResolvedValue(
      new Response(JSON.stringify({ results: { [RAW_URN]: { status: 204 } } }), { status: 200 }),
    );
    await expect(markConversationRead(CONV_ID)).resolves.toBeUndefined();
  });

  it('throws when a 200 body carries a non-empty errors map (silent rejection)', async () => {
    voyagerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ errors: { [RAW_URN]: { status: 422, message: 'nope' } } }),
        { status: 200 },
      ),
    );
    await expect(markConversationRead(CONV_ID)).rejects.toThrow(/rejected by server/);
    // Surfaced as an error log so it's visible in the debug panel.
    expect(debugLog).toHaveBeenCalledWith('error', expect.stringContaining('rejected'));
  });

  it('throws when the matched entity result has an error status', async () => {
    voyagerFetch.mockResolvedValue(
      new Response(JSON.stringify({ results: { [RAW_URN]: { status: 403 } } }), { status: 200 }),
    );
    await expect(markConversationRead(CONV_ID)).rejects.toThrow(/rejected by server/);
  });

  it('propagates a non-2xx failure (kept re-queueable)', async () => {
    voyagerFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(markConversationRead(CONV_ID)).rejects.toThrow(/Failed to patch/);
  });

  it('logs the response body on success (both read and unread)', async () => {
    voyagerFetch.mockResolvedValue(new Response('', { status: 200 }));

    await markConversationRead(CONV_ID);
    expect(debugLog).toHaveBeenCalledWith('info', expect.stringContaining('{"read":true}'));

    vi.mocked(debugLog).mockClear();
    await markConversationUnread(CONV_ID);
    expect(debugLog).toHaveBeenCalledWith('info', expect.stringContaining('{"read":false}'));
  });

  it('detects the same rejection for unread as for read', async () => {
    voyagerFetch.mockResolvedValue(
      new Response(JSON.stringify({ errors: { [RAW_URN]: { status: 422 } } }), { status: 200 }),
    );
    await expect(markConversationUnread(CONV_ID)).rejects.toThrow(/rejected by server/);
  });
});

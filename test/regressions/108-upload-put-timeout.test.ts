/**
 * Regression: an attachment upload could hang a conversation's sends forever.
 *
 * uploadFile's step-2 PUT (raw bytes to LinkedIn's media host) used a bare
 * fetch() with no AbortSignal — unlike every voyagerFetch call, which is
 * bounded by VOYAGER_TIMEOUT_MS exactly so "a hung connection can't stall
 * sync/queue". Sends are serialized per conversation via enqueueSend, so one
 * PUT stuck on a dead connection blocked every later send to that
 * conversation until the service worker restarted.
 *
 * Fix: the upload PUT carries an AbortSignal.timeout bound (generous, since
 * file uploads legitimately take longer than API calls).
 */
import type { BridgeAttachment } from '@/types/bridge';

const voyagerFetch = vi.fn();
vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: (...args: any[]) => voyagerFetch(...args),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  findConversationByRecipients: vi.fn(),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { sendMessage } from '../../entrypoints/background/api/messages';

it('bounds the attachment upload PUT with an abort signal', async () => {
  // Step 1 (register, via voyagerFetch) succeeds; step 3 (createMessage) too.
  voyagerFetch.mockImplementation(async (path: string) => {
    if (path.includes('MediaUploadMetadata')) {
      return new Response(
        JSON.stringify({
          value: {
            singleUploadUrl: 'https://media.example/upload',
            urn: 'urn:li:digitalmediaAsset:TEST',
            singleUploadHeaders: {},
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ value: {} }), { status: 200 });
  });

  // Step 2: capture the raw fetch the PUT uses.
  let putInit: RequestInit | undefined;
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: any, init?: RequestInit) => {
    putInit = init;
    return new Response('', { status: 201 });
  });

  try {
    const attachment: BridgeAttachment = {
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 3,
      dataBase64: btoa('abc'),
    };
    await sendMessage('2-conv', 'here you go', [attachment]);
  } finally {
    (globalThis as any).fetch = origFetch;
  }

  expect(putInit).toBeDefined();
  expect(putInit!.method).toBe('PUT');
  expect(putInit!.signal).toBeInstanceOf(AbortSignal);
});

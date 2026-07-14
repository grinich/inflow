import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildNotificationIcon } from '@/lib/notification-icon';
import { resetChromeMock } from '../mocks/chrome';
import { resetFetchMock, mockFetch } from '../mocks/fetch';

const AVATAR_URL = 'https://media.licdn.com/dms/image/avatar.jpg';
const ICON_URL = 'chrome-extension://test-extension-id/icon-128.png';

// Known bytes so the base64 output is verifiable: "PNG!" → "UE5HIQ=="
const OUTPUT_BYTES = new Uint8Array([0x50, 0x4e, 0x47, 0x21]);

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  };
}

let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  resetChromeMock();
  resetFetchMock();
  ctx = makeCtx();

  (globalThis as any).OffscreenCanvas = class {
    getContext() {
      return ctx;
    }
    async convertToBlob() {
      return new Blob([OUTPUT_BYTES], { type: 'image/png' });
    }
  };
  (globalThis as any).createImageBitmap = vi.fn(async (blob: Blob) => ({
    kind: 'bitmap',
    size: blob.size,
  }));
});

afterEach(() => {
  delete (globalThis as any).OffscreenCanvas;
  delete (globalThis as any).createImageBitmap;
});

describe('buildNotificationIcon', () => {
  it('renders the avatar alone into a PNG data URL — no app-icon badge', async () => {
    mockFetch(AVATAR_URL, async () => new Response(new Blob([new Uint8Array([1])])));

    const result = await buildNotificationIcon(AVATAR_URL);

    expect(result).toBe('data:image/png;base64,UE5HIQ==');
    // Only the avatar is drawn; the extension icon is never fetched
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(AVATAR_URL);
    expect(fetch).not.toHaveBeenCalledWith(ICON_URL);
  });

  it('returns null when the avatar fetch fails (caller falls back to app icon)', async () => {
    // Default fetch mock returns a 500 for unmatched URLs
    const result = await buildNotificationIcon(AVATAR_URL);
    expect(result).toBeNull();
  });

  it('returns null when the avatar bytes cannot be decoded', async () => {
    mockFetch(AVATAR_URL, async () => new Response(new Blob([new Uint8Array([1])])));
    (globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });

    const result = await buildNotificationIcon(AVATAR_URL);
    expect(result).toBeNull();
  });

  it('returns null when OffscreenCanvas is unavailable', async () => {
    mockFetch(AVATAR_URL, async () => new Response(new Blob([new Uint8Array([1])])));
    delete (globalThis as any).OffscreenCanvas;

    const result = await buildNotificationIcon(AVATAR_URL);
    expect(result).toBeNull();
  });
});

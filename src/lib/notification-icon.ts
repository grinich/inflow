/**
 * Build the icon for a native message notification: the sender's avatar,
 * circle-cropped.
 *
 * MV3 requires this indirection — chrome.notifications.create only renders
 * data:/blob: URLs or extension-local resources, so a remote LinkedIn CDN
 * avatar URL passed as iconUrl silently shows nothing. The avatar must be
 * fetched here in the service worker and re-encoded as a data URL.
 *
 * Returns null when the avatar can't be fetched or drawn (offline, expired
 * CDN URL, no canvas support) — callers fall back to the plain app icon.
 */

const CANVAS_SIZE = 192;

export async function buildNotificationIcon(avatarUrl: string): Promise<string | null> {
  try {
    const avatar = await fetchBitmap(avatarUrl);
    if (!avatar) return null;

    const canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

async function fetchBitmap(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return createImageBitmap(await res.blob());
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/**
 * Build the icon for a native message notification: the sender's avatar,
 * circle-cropped, with the inflow logo badged in the bottom-right corner.
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
const BADGE_SIZE = 72;

export async function buildNotificationIcon(avatarUrl: string): Promise<string | null> {
  try {
    const avatar = await fetchBitmap(avatarUrl);
    if (!avatar) return null;

    const canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.restore();

    // Badge failure is non-fatal — a plain avatar beats no icon.
    const badge = await fetchBitmap(chrome.runtime.getURL('icon-128.png')).catch(() => null);
    if (badge) {
      const r = BADGE_SIZE / 2;
      const cx = CANVAS_SIZE - r;
      const cy = CANVAS_SIZE - r;
      // White plate behind the logo so it stays legible over any avatar.
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      const inset = 6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - inset, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        badge,
        cx - r + inset,
        cy - r + inset,
        BADGE_SIZE - inset * 2,
        BADGE_SIZE - inset * 2
      );
      ctx.restore();
    }

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

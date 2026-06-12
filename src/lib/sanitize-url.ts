/**
 * Block dangerous URL protocols (javascript:, data:, vbscript:, …) before using
 * a value as an href or img src. Returns '#' for a disallowed protocol; passes
 * through http(s) and relative URLs unchanged. Shared by MessageBubble and
 * SharedPostCard (previously copy-pasted in both).
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  // Browsers strip ASCII tab/LF/CR anywhere in a URL and leading C0 controls
  // before parsing (WHATWG URL spec), so `java\tscript:` parses as javascript:.
  // Normalize the same way before checking the scheme, and return the
  // normalized value so the checked string is the one actually used.
  const trimmed = url.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return '#'; // block all other protocols
  return trimmed;
}

/**
 * Like sanitizeUrl, but additionally allows the internal image sources the app
 * generates itself: data:image/ URLs from the image cache (useCachedImage) and
 * blob: object URLs for compose-box previews. For <img src> only — never hrefs.
 */
export function sanitizeImageUrl(url: string | undefined): string {
  if (!url) return '#';
  const trimmed = url.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (/^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed;
  return sanitizeUrl(trimmed);
}

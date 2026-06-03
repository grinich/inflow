/**
 * Block dangerous URL protocols (javascript:, data:, vbscript:, …) before using
 * a value as an href or img src. Returns '#' for a disallowed protocol; passes
 * through http(s) and relative URLs unchanged. Shared by MessageBubble and
 * SharedPostCard (previously copy-pasted in both).
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return '#'; // block all other protocols
  return trimmed;
}

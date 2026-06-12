// Regression: sanitizeUrl was bypassable with embedded ASCII tab/newline or
// leading C0 control characters. Browsers strip those before parsing a URL
// (WHATWG URL spec), so `java\tscript:alert(1)` passed both regex checks
// unchanged and became a live javascript: href in message links.
import { sanitizeUrl, sanitizeImageUrl } from '@/lib/sanitize-url';

describe('sanitizeUrl control-character bypass', () => {
  it('blocks javascript: with embedded tab', () => {
    expect(sanitizeUrl('java\tscript:alert(1)')).toBe('#');
  });

  it('blocks javascript: with embedded newline / CR', () => {
    expect(sanitizeUrl('java\nscript:alert(1)')).toBe('#');
    expect(sanitizeUrl('java\rscript:alert(1)')).toBe('#');
  });

  it('blocks javascript: with leading C0 control characters', () => {
    expect(sanitizeUrl('\x01javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('\x00javascript:alert(1)')).toBe('#');
  });

  it('still blocks plain dangerous protocols', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('data:text/html,<script>x</script>')).toBe('#');
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('still passes http(s) URLs through, including ones with stray controls', () => {
    expect(sanitizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeUrl('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(sanitizeUrl('https://example.com/a\n')).toBe('https://example.com/a');
  });
});

// Regression: the image lightbox sanitized its src with sanitizeUrl, which
// rejects data: and blob: — but cached attachments (useCachedImage) are data:
// URLs and compose previews are blob: URLs, so the lightbox rendered '#',
// errored, and instantly closed itself.
describe('sanitizeImageUrl', () => {
  it('allows data:image/ URLs (cached attachments)', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeImageUrl(url)).toBe(url);
  });

  it('allows blob: URLs (compose previews)', () => {
    const url = 'blob:chrome-extension://abc/123-456';
    expect(sanitizeImageUrl(url)).toBe(url);
  });

  it('allows https URLs', () => {
    expect(sanitizeImageUrl('https://media.licdn.com/img.jpg')).toBe('https://media.licdn.com/img.jpg');
  });

  it('blocks javascript: and non-image data: URLs', () => {
    expect(sanitizeImageUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeImageUrl('data:text/html,<script>x</script>')).toBe('#');
    expect(sanitizeImageUrl('java\tscript:alert(1)')).toBe('#');
  });
});

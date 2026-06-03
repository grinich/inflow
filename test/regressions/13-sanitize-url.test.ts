import { sanitizeUrl } from '@/lib/sanitize-url';

describe('sanitizeUrl', () => {
  it('blocks dangerous protocols', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('data:text/html,<script>')).toBe('#');
    expect(sanitizeUrl('vbscript:x')).toBe('#');
  });
  it('passes through http(s) and relative urls', () => {
    expect(sanitizeUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeUrl('/relative/path')).toBe('/relative/path');
  });
  it('returns # for empty input', () => {
    expect(sanitizeUrl(undefined)).toBe('#');
    expect(sanitizeUrl('')).toBe('#');
  });
});

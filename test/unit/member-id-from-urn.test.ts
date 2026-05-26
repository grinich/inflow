import { memberIdFromUrn } from '@/db/database';

describe('memberIdFromUrn()', () => {
  it('extracts member ID from a standard fsd_profile URN', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:ACoAABcdEfG')).toBe('ACoAABcdEfG');
  });

  it('extracts member ID from a different profile URN', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:ABC123XYZ')).toBe('ABC123XYZ');
  });

  it('handles URN with trailing equals signs (base64 padding)', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:ACoAAA==')).toBe('ACoAAA==');
  });

  it('handles URN with only one colon-separated segment', () => {
    expect(memberIdFromUrn('justAnId')).toBe('justAnId');
  });

  it('returns the last segment for any colon-separated string', () => {
    expect(memberIdFromUrn('a:b:c:lastPart')).toBe('lastPart');
  });

  it('returns empty string for empty input', () => {
    expect(memberIdFromUrn('')).toBe('');
  });

  it('returns empty string for a string ending with a colon', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:')).toBe('');
  });

  it('handles member URN with numeric ID', () => {
    expect(memberIdFromUrn('urn:li:fsd_profile:123456789')).toBe('123456789');
  });
});

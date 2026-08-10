import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isNewerVersion, coreVersion } from '@/lib/update';

describe('update version helpers', () => {
  it('parses v-prefixed and plain versions', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0]);
    expect(parseVersion(' V2.0.1 ')).toEqual([2, 0, 1]);
  });

  it('treats malformed/empty input as 0.0.0', () => {
    expect(parseVersion('')).toEqual([0, 0, 0]);
    expect(parseVersion('garbage')).toEqual([0, 0, 0]);
    expect(parseVersion(undefined as unknown as string)).toEqual([0, 0, 0]);
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    // lexical compare would wrongly rank "0.2.0" >= "0.10.0"
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
  });

  it('isNewerVersion is true only when latest is strictly newer', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });

  it('coreVersion drops the 4th build segment', () => {
    // Production manifest versions carry a build segment; the core is 3-part.
    expect(coreVersion('0.5.1.457')).toBe('0.5.1');
    expect(coreVersion('0.5.1')).toBe('0.5.1');
    expect(coreVersion('v0.5.1.9999')).toBe('0.5.1');
  });

  it('a build-segment version compares equal to its core', () => {
    // Two builds of the same release must not read as an update.
    expect(compareVersions('0.5.1.457', '0.5.1')).toBe(0);
    expect(isNewerVersion('0.5.1', '0.5.1.457')).toBe(false);
    // A real patch bump still wins over an older build.
    expect(compareVersions('0.5.2', '0.5.1.999')).toBeGreaterThan(0);
  });
});

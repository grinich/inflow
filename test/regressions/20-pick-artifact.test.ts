import { describe, it, expect } from 'vitest';
import { pickArtifact } from '@/lib/voyager-image';

describe('pickArtifact', () => {
  it('returns the smallest artifact at or above minWidth', () => {
    const arts = [{ width: 40 }, { width: 100 }, { width: 200 }, { width: 800 }];
    expect(pickArtifact(arts, 100)).toEqual({ width: 100 });
    expect(pickArtifact(arts, 150)).toEqual({ width: 200 });
  });

  it('falls back to the largest artifact when none reach minWidth', () => {
    const arts = [{ width: 20 }, { width: 80 }, { width: 60 }];
    expect(pickArtifact(arts, 100)).toEqual({ width: 80 });
  });

  it('does not mutate the input array order', () => {
    const arts = [{ width: 800 }, { width: 40 }, { width: 200 }];
    const snapshot = arts.map((a) => a.width);
    pickArtifact(arts, 100);
    expect(arts.map((a) => a.width)).toEqual(snapshot);
  });

  it('treats missing widths as 0', () => {
    const arts = [{ width: undefined }, { width: 50 }];
    expect(pickArtifact(arts, 100)).toEqual({ width: 50 }); // largest fallback
    expect(pickArtifact(arts, 40)).toEqual({ width: 50 });
  });

  it('returns undefined for empty or missing input', () => {
    expect(pickArtifact([], 100)).toBeUndefined();
    expect(pickArtifact(undefined, 100)).toBeUndefined();
  });
});

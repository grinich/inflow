/**
 * Drag-to-reorder helpers.
 */
import { moveBefore, normalizeOrder } from '@/lib/reorder';

describe('moveBefore', () => {
  it('moves an item to sit before another', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
  });
  it('is a no-op for same item or missing keys', () => {
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveBefore(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
    expect(moveBefore(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });
});

describe('normalizeOrder', () => {
  it('keeps saved order and appends new keys', () => {
    expect(normalizeOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });
  it('drops keys that no longer exist', () => {
    expect(normalizeOrder(['a', 'gone', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

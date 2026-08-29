// @vitest-environment jsdom
/**
 * ?compose is a one-shot launch param (the installed app's dock-menu
 * "Compose" shortcut). Consuming it must strip it from the URL so a reload
 * doesn't re-open the composer, while leaving other params (?demo) alone.
 */
import { consumeComposeParam, isEmbeddedInShell } from '@/lib/launch-params';

function setSearch(search: string) {
  window.history.replaceState(null, '', `/app.html${search}`);
}

describe('consumeComposeParam', () => {
  it('returns false and leaves the URL alone when compose is absent', () => {
    setSearch('?demo');
    expect(consumeComposeParam()).toBe(false);
    expect(window.location.search).toBe('?demo');
  });

  it('returns true and strips compose from the URL', () => {
    setSearch('?compose=1');
    expect(consumeComposeParam()).toBe(true);
    expect(window.location.search).toBe('');
  });

  it('preserves other params while stripping compose', () => {
    setSearch('?demo&compose=1');
    expect(consumeComposeParam()).toBe(true);
    const params = new URLSearchParams(window.location.search);
    expect(params.has('demo')).toBe(true);
    expect(params.has('compose')).toBe(false);
  });

  it('is one-shot: a second call after consuming returns false', () => {
    setSearch('?compose=1');
    expect(consumeComposeParam()).toBe(true);
    expect(consumeComposeParam()).toBe(false);
  });
});

describe('isEmbeddedInShell', () => {
  it('is false when the app is the top-level page', () => {
    expect(isEmbeddedInShell()).toBe(false);
  });

  it('is true when self and top differ (framed)', () => {
    expect(isEmbeddedInShell(window, {} as Window)).toBe(true);
  });

  it('is true when touching top throws (cross-origin frame)', () => {
    const hostile = new Proxy({} as Window, {
      get() {
        throw new Error('Blocked a frame from accessing a cross-origin frame.');
      },
    });
    // The comparison itself doesn't throw, but any equality path that reads
    // through a poisoned top must land on "framed".
    expect(isEmbeddedInShell(window, hostile)).toBe(true);
  });
});

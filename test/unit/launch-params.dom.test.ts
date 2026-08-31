// @vitest-environment jsdom
/**
 * ?compose (the installed app's dock-menu "Compose" shortcut) and ?c= (the
 * conversation a clicked notification launched the app for) are one-shot
 * launch params. Consuming one must strip it from the URL so a reload
 * doesn't replay it, while leaving other params (?demo) alone.
 */
import {
  consumeComposeParam,
  consumeConversationParam,
  consumePairParam,
  isEmbeddedInShell,
} from '@/lib/launch-params';

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

describe('consumeConversationParam', () => {
  it('returns null and leaves the URL alone when c is absent', () => {
    setSearch('?demo');
    expect(consumeConversationParam()).toBeNull();
    expect(window.location.search).toBe('?demo');
  });

  it('returns the conversation id and strips c from the URL', () => {
    setSearch('?c=2-abc%3D%3D');
    expect(consumeConversationParam()).toBe('2-abc==');
    expect(window.location.search).toBe('');
  });

  it('preserves other params while stripping c', () => {
    setSearch('?demo&c=conv-1');
    expect(consumeConversationParam()).toBe('conv-1');
    const params = new URLSearchParams(window.location.search);
    expect(params.has('demo')).toBe(true);
    expect(params.has('c')).toBe(false);
  });

  it('is one-shot: a reload must not re-navigate', () => {
    setSearch('?c=conv-1');
    expect(consumeConversationParam()).toBe('conv-1');
    expect(consumeConversationParam()).toBeNull();
  });

  it('ignores an empty ?c=', () => {
    setSearch('?c=');
    expect(consumeConversationParam()).toBeNull();
  });
});

describe('consumePairParam', () => {
  it('returns null and leaves the URL alone when pair is absent', () => {
    setSearch('?demo');
    expect(consumePairParam()).toBeNull();
    expect(window.location.search).toBe('?demo');
  });

  it('returns the normalized code and strips pair from the URL', () => {
    setSearch('?pair=inf-abc234');
    expect(consumePairParam()).toBe('INF-ABC234');
    expect(window.location.search).toBe('');
  });

  it('rejects malformed codes but still strips the param', () => {
    setSearch('?pair=<script>alert(1)</script>');
    expect(consumePairParam()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('is one-shot: a reload must not re-open the modal', () => {
    setSearch('?pair=INF-ABC234');
    expect(consumePairParam()).toBe('INF-ABC234');
    expect(consumePairParam()).toBeNull();
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

// @vitest-environment jsdom
/**
 * Adversarial coverage for the one-shot launch params: URLs carrying hashes,
 * multi-valued and valueless params, param-order stability, and a
 * history.replaceState that throws (the strip must fail closed — no composer,
 * URL untouched — rather than half-consume).
 */
import { consumeComposeParam, isEmbeddedInShell } from '@/lib/launch-params';

function setUrl(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

describe('consumeComposeParam URL edge cases', () => {
  it('preserves the hash while stripping compose', () => {
    setUrl('/app.html?compose=1#inbox');
    expect(consumeComposeParam()).toBe(true);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#inbox');
    expect(window.location.pathname).toBe('/app.html');
  });

  it('preserves the order of the surviving params (and the hash)', () => {
    setUrl('/app.html?a=1&compose=1&b=2#x');
    expect(consumeComposeParam()).toBe(true);
    expect(window.location.search).toBe('?a=1&b=2');
    expect(window.location.hash).toBe('#x');
  });

  it('consumes a valueless ?compose', () => {
    setUrl('/app.html?compose');
    expect(consumeComposeParam()).toBe(true);
    expect(window.location.search).toBe('');
  });

  it('treats presence as the signal: ?compose=0 still opens the composer', () => {
    // Documents current semantics — the shell only ever forwards compose=1,
    // so the value is never inspected. If a falsy-value opt-out is ever
    // wanted, this is the test to flip.
    setUrl('/app.html?compose=0');
    expect(consumeComposeParam()).toBe(true);
  });

  it('strips every occurrence of a repeated compose param in one consume', () => {
    setUrl('/app.html?compose=1&demo&compose=2');
    expect(consumeComposeParam()).toBe(true);
    // Note: URLSearchParams round-tripping normalizes the valueless `demo`
    // to `demo=` — cosmetic only, both forms parse identically everywhere.
    expect(window.location.search).toBe('?demo=');
    expect(new URLSearchParams(window.location.search).has('demo')).toBe(true);
    expect(new URLSearchParams(window.location.search).has('compose')).toBe(false);
    expect(consumeComposeParam()).toBe(false);
  });

  it('is case-sensitive: ?Compose is not the launch param', () => {
    setUrl('/app.html?Compose=1');
    expect(consumeComposeParam()).toBe(false);
    expect(window.location.search).toBe('?Compose=1');
  });

  it('fails closed when history.replaceState throws: no composer, param left for the next load', () => {
    setUrl('/app.html?compose=1');
    const spy = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });

    // Returning true here would re-open the composer on every reload (the
    // strip never landed); returning false defers to a later load instead.
    expect(consumeComposeParam()).toBe(false);
    spy.mockRestore();
    expect(window.location.search).toBe('?compose=1');

    // Once replaceState works again, the param is consumed normally.
    expect(consumeComposeParam()).toBe(true);
    expect(window.location.search).toBe('');
  });
});

describe('isEmbeddedInShell edge cases', () => {
  it('treats a null top as framed (disowned/detached frames only ever happen embedded)', () => {
    // The false-positive cost is one redundant window.focus() call.
    expect(isEmbeddedInShell(window, null)).toBe(true);
  });

  it('a poisoned self is also read as framed (fail toward embedded)', () => {
    const hostile = new Proxy({} as Window, {
      get() {
        throw new Error('Blocked a frame from accessing a cross-origin frame.');
      },
    });
    expect(isEmbeddedInShell(hostile, window)).toBe(true);
  });
});

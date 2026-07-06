import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import { installChromeMock, resetChromeMock } from './mocks/chrome';
import { resetFetchMock } from './mocks/fetch';

// Install Chrome API mock globally before any module loads
installChromeMock();

// vi.waitFor defaults to a 1s timeout — fine on an idle machine, but a starved
// CI/dev box (full suite + dev server + browser) makes timing-based tests flake
// spuriously. Raise the DEFAULT to 10s suite-wide; explicit longer timeouts at
// call sites are respected, and passing tests are just as fast (waitFor polls).
try {
  const origWaitFor = vi.waitFor.bind(vi);
  (vi as any).waitFor = (cb: any, opts?: any) => {
    if (typeof opts === 'number') return origWaitFor(cb, Math.max(opts, 10_000));
    return origWaitFor(cb, {
      ...(opts || {}),
      timeout: Math.max(opts?.timeout ?? 0, 10_000),
    });
  };
} catch {
  // vi may be frozen in a future vitest version — the 1s default then applies.
}

// WXT's defineBackground is a global macro — stub it for tests
(globalThis as any).defineBackground = (fn: Function) => fn();

// navigator.onLine mock. Only stub the WHOLE navigator when it's missing (node
// env). Under jsdom, navigator already exists with userAgent etc. that react-dom
// reads — clobbering it breaks rendering — so leave it and just set onLine.
if (typeof navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    writable: true,
    configurable: true,
  });
}

// Reset state between tests
beforeEach(() => {
  resetChromeMock();
  resetFetchMock();
  try {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  } catch {
    // jsdom's navigator.onLine may not be redefinable; it already defaults to true.
  }
});

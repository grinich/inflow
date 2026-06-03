import 'fake-indexeddb/auto';
import { installChromeMock, resetChromeMock } from './mocks/chrome';
import { resetFetchMock } from './mocks/fetch';

// Install Chrome API mock globally before any module loads
installChromeMock();

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

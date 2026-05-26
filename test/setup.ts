import 'fake-indexeddb/auto';
import { installChromeMock, resetChromeMock } from './mocks/chrome';
import { resetFetchMock } from './mocks/fetch';

// Install Chrome API mock globally before any module loads
installChromeMock();

// WXT's defineBackground is a global macro — stub it for tests
(globalThis as any).defineBackground = (fn: Function) => fn();

// navigator.onLine mock
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  writable: true,
  configurable: true,
});

// Reset state between tests
beforeEach(() => {
  resetChromeMock();
  resetFetchMock();
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

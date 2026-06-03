// Per-file DOM test setup. Import this at the top of a component/hook test that
// also sets `// @vitest-environment jsdom`. Scoped (not a global setupFile) so the
// large node-only test suite stays on the fast `node` environment untouched.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom doesn't implement matchMedia; ui-store reads it at module load.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());

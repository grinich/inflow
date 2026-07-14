// Per-file DOM test setup. Import this at the top of a component/hook test that
// also sets `// @vitest-environment jsdom`. Scoped (not a global setupFile) so the
// large node-only test suite stays on the fast `node` environment untouched.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Testing-library's waitFor/findBy* default to a 1s timeout — fine on an idle
// machine, but a starved dev box (full suite + dev server + browser competing
// for cores) makes timing-based assertions flake spuriously. Passing tests are
// just as fast (the utils poll); only genuine failures wait longer to report.
configure({ asyncUtilTimeout: 10_000 });

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

// jsdom doesn't implement IntersectionObserver; list rows use it to preload
// avatars. A no-op stub keeps components mountable — tests that care about
// intersection behavior can install their own mock.
if (typeof window !== 'undefined' && typeof (window as any).IntersectionObserver !== 'function') {
  (window as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  (globalThis as any).IntersectionObserver = (window as any).IntersectionObserver;
}

afterEach(() => cleanup());

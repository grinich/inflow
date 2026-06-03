// Per-file DOM test setup. Import this at the top of a component/hook test that
// also sets `// @vitest-environment jsdom`. Scoped (not a global setupFile) so the
// large node-only test suite stays on the fast `node` environment untouched.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

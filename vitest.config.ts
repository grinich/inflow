import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@/': resolve(__dirname, 'src') + '/',
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    // Default to the fast node env; component/hook tests opt into jsdom per-file
    // via `// @vitest-environment jsdom` so the large node suite is unaffected.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**',
        'src/hooks/**',
        'src/store/**',
        'entrypoints/background/**',
        'src/db/**',
      ],
      exclude: [
        'entrypoints/background/index.ts',
        'src/components/**',
      ],
    },
  },
});

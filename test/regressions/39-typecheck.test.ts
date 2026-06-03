import { spawnSync } from 'node:child_process';

it('passes a repository TypeScript no-emit check', () => {
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--pretty', 'false', '--types', 'chrome,vitest/globals,react,react-dom'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  expect(result.status, output.slice(0, 5000)).toBe(0);
}, 35_000);

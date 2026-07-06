import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

it('passes a repository TypeScript no-emit check', () => {
  // Invoke the local tsc binary directly — `npx` adds seconds of resolution
  // overhead, and this test runs while every other worker is competing for
  // CPU, so it needs all the headroom it can get.
  const localTsc = join(process.cwd(), 'node_modules', '.bin', 'tsc');
  const [cmd, baseArgs] = existsSync(localTsc)
    ? [localTsc, [] as string[]]
    : ['npx', ['tsc']];
  const result = spawnSync(
    cmd,
    [...baseArgs, '--noEmit', '--pretty', 'false', '--types', 'chrome,vitest/globals,react,react-dom'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      // Generous: under full-suite load tsc can take far longer than its
      // usual few seconds, and a timeout here is a false alarm, not a type error.
      timeout: 120_000,
    }
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  expect(result.status, output.slice(0, 5000)).toBe(0);
}, 150_000);

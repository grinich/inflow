/**
 * No source file may contain a NUL byte.
 *
 * MessageBubble.tsx once held a literal NUL (a `join('\0')` typed as the raw
 * character rather than the escape). It compiled and ran fine, but `file`
 * reported the module as binary data and grep skipped it SILENTLY — returning
 * no matches rather than an error. A search for the edit UI in that file came
 * back empty and the feature was wrongly reported as not existing.
 *
 * The cost is a wrong answer with no visible failure, so guard the whole tree.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sourceFiles = execSync(
  "git ls-files 'src/*.ts' 'src/**/*.ts' 'src/**/*.tsx' 'entrypoints/**/*.ts' 'entrypoints/**/*.tsx'",
  { cwd: process.cwd(), encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

it('finds source files to check', () => {
  expect(sourceFiles.length).toBeGreaterThan(50);
});

it('contains no NUL bytes, which make grep skip a file without saying so', () => {
  const offenders = sourceFiles.filter((f) => readFileSync(f).includes(0));
  expect(
    offenders,
    `write '\\0' as an escape instead of the raw byte in: ${offenders.join(', ')}`,
  ).toEqual([]);
});

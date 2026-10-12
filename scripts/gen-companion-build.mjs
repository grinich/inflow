/**
 * Stamp the companion with a real build identity, so "which build is running?"
 * is answerable from inflow's activity feed instead of a constant that never
 * changes. Mirrors the app's scheme (CLAUDE.md): 3-part semver from
 * package.json plus a 4th segment that is the git commit count, and the short
 * commit sha alongside it.
 *
 * Generated (not committed) and refreshed by `npm run pack:companion`, so the
 * stamp can't drift from what's actually packed. Running from a checkout with
 * no stamp is fine — the companion falls back to reporting a dev build.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'mcp-companion', 'package.json'), 'utf8'));

const git = (cmd, fallback) => {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback; // not a git checkout (e.g. an unpacked tarball)
  }
};

const build = git('git rev-list --count HEAD', '');
const commit = git('git rev-parse --short HEAD', 'unknown');
// The last commit that touched the companion's own code. This is what decides
// whether an installed companion is stale, NOT the repo HEAD: nearly every
// commit is an extension change that the companion neither ships nor cares
// about, so comparing HEAD told users to reinstall after any commit at all.
// default-tools.json is excluded because the extension refreshes it live at
// pairing, so a change there never needs a reinstall either.
const codeCommit = git(
  "git log -1 --format=%h -- mcp-companion ':(exclude)mcp-companion/src/default-tools.json'",
  'unknown',
);
const info = {
  version: build ? `${pkg.version}.${build}` : pkg.version,
  commit,
  codeCommit,
  builtAt: new Date().toISOString(),
};

const out = join(root, 'mcp-companion', 'src', 'build-info.json');
writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log(`Stamped companion v${info.version} (${info.commit}, code ${info.codeCommit})`);

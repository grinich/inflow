import { compareVersions } from './update';

/**
 * Parses the bundled CHANGELOG.md (Keep a Changelog format) and decides which
 * release notes to show after an update. The parser is pure (takes text), so
 * it's easy to test; the raw changelog import lives in changelog-data.ts.
 */

export interface ChangelogGroup {
  /** e.g. "Added", "Fixed", "Changed". */
  label: string;
  items: string[];
}

export interface ReleaseEntry {
  version: string;
  date: string;
  groups: ChangelogGroup[];
}

const SEEN_KEY = 'inflow-last-seen-version';

/** Strip the bits of markdown we don't render (bold markers). */
function clean(text: string): string {
  return text.replace(/\*\*/g, '').trim();
}

export function parseChangelog(text: string): ReleaseEntry[] {
  const lines = text.split('\n');
  const entries: ReleaseEntry[] = [];
  let entry: ReleaseEntry | null = null;
  let group: ChangelogGroup | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Release header: "## [1.2.3] - 2026-01-02"
    const rel = line.match(/^##\s+\[(\d+\.\d+\.\d+)\](?:\s*-\s*(.+))?/);
    if (rel) {
      entry = { version: rel[1], date: (rel[2] || '').trim(), groups: [] };
      entries.push(entry);
      group = null;
      continue;
    }
    if (!entry) continue;

    // Group header: "### Added"
    const grp = line.match(/^###\s+(.+)/);
    if (grp) {
      group = { label: clean(grp[1]), items: [] };
      entry.groups.push(group);
      continue;
    }

    // Bullet: "- something"
    const bullet = line.match(/^\s*-\s+(.+)/);
    if (bullet) {
      if (!group) {
        group = { label: '', items: [] };
        entry.groups.push(group);
      }
      group.items.push(clean(bullet[1]));
      continue;
    }

    // Continuation of the previous bullet (wrapped line).
    if (group && group.items.length && line.trim()) {
      group.items[group.items.length - 1] += ' ' + clean(line);
    }
  }

  return entries;
}

/**
 * Releases strictly newer than `seenVersion` and no newer than `currentVersion`,
 * newest first. When `seenVersion` is null (fresh install) returns [].
 */
export function releasesSince(
  entries: ReleaseEntry[],
  seenVersion: string | null,
  currentVersion: string,
): ReleaseEntry[] {
  if (!seenVersion) return [];
  return entries
    .filter(
      (e) =>
        compareVersions(e.version, seenVersion) > 0 &&
        compareVersions(e.version, currentVersion) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The entry matching a specific version, if present (for manual "What's new"). */
export function releaseForVersion(entries: ReleaseEntry[], version: string): ReleaseEntry | null {
  return entries.find((e) => e.version === version) ?? null;
}

export function getLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {}
}

#!/usr/bin/env node
/**
 * Builds the GitHub Release body for a version out of CHANGELOG.md.
 *
 *   node scripts/release-notes.mjs 0.6.0 > release-notes.md
 *
 * Why this exists rather than a plain awk slice: GitHub renders release notes
 * with hard line breaks ON, so every newline inside a paragraph or bullet
 * becomes a <br>. CHANGELOG.md is wrapped at ~78 columns for humans, which on
 * the release page came out as a ragged half-width column next to any
 * paragraph that happened to be written as one long line.
 *
 * So the section is unwrapped here: continuation lines are joined back into
 * their bullet or paragraph, and only the breaks that carry meaning (blank
 * lines, headings, list-item starts, blockquotes) survive. CHANGELOG.md keeps
 * its readable wrapping, and the site build (scripts/build-changelog.mjs) does
 * the same joining for inflow.im/changelog.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'CHANGELOG.md');

export const HOW_TO_UPDATE = `## How to update

Installed from the [Chrome Web Store](https://chromewebstore.google.com/detail/ndehgbgifkapdigmefglpgacpagoclge)? Chrome updates inflow on its own — there is nothing to do. This release is submitted to the store automatically; it goes live once review clears.

Still running a manually loaded copy? Move to the store listing above to get automatic updates from here on. The store build is a separate extension to Chrome, so it starts with an empty local database and re-syncs your conversations from LinkedIn.

To stay on a manual install: download the \`.zip\` asset below, unzip it, then reload the inflow card at \`chrome://extensions\` (or \`git pull && npm install && npm run build\` from a clone).`;

/** The lines of one release's section, between its heading and the next one. */
export function extractSection(markdown, version) {
  const out = [];
  let found = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^## \[/.test(line)) {
      if (found) break;
      if (line.includes(`[${version}]`)) found = true;
      continue;
    }
    // Link-reference definitions at the foot of the file are not content.
    if (found && /^\[[^\]]+\]:\s*http/.test(line)) continue;
    if (found) out.push(line);
  }
  return out;
}

/**
 * Join wrapped lines back into one line per bullet or paragraph, so GitHub's
 * hard-break rendering can't turn the wrapping into visible line breaks.
 */
export function unwrap(lines) {
  const out = [];
  let buffer = null;

  const flush = () => {
    if (buffer !== null) out.push(buffer);
    buffer = null;
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      out.push('');
      continue;
    }
    // Headings and blockquotes stand alone: joining a `> [!IMPORTANT]` marker
    // onto its text would stop GitHub rendering the alert.
    if (/^#{1,6} /.test(line) || line.startsWith('>')) {
      flush();
      out.push(line);
      continue;
    }
    // A list marker starts a new item, at whatever depth it sits.
    if (/^\s*[-*+] /.test(line)) {
      flush();
      buffer = line;
      continue;
    }
    // Anything else continues whatever came before it.
    if (buffer !== null) buffer += ` ${line.trim()}`;
    else buffer = line;
  }
  flush();

  // Collapse the runs of blank lines that flushing can leave behind.
  return out
    .filter((l, i) => !(l === '' && out[i - 1] === ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export function buildReleaseNotes(version, markdown = readFileSync(SOURCE, 'utf8')) {
  const body = unwrap(extractSection(markdown, version));
  if (!body.trim()) {
    throw new Error(`No CHANGELOG.md section found for version ${version}`);
  }
  return `${body}\n\n${HOW_TO_UPDATE}\n`;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(1);
  }
  process.stdout.write(buildReleaseNotes(version));
}

#!/usr/bin/env node
/**
 * Renders CHANGELOG.md into the release list on site/changelog.html.
 *
 * CHANGELOG.md stays the single source of truth. Only the region between the
 * CHANGELOG:START / CHANGELOG:END markers is generated — the page shell around
 * it is hand-written, so the design can change without touching this script.
 *
 *   node scripts/build-changelog.mjs           # write
 *   node scripts/build-changelog.mjs --check   # exit 1 if the page is stale
 *
 * A vitest case runs the --check path, so `npm test` fails when a release is
 * added to the markdown and the page is not regenerated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'CHANGELOG.md');
const PAGE = join(ROOT, 'site', 'changelog.html');
const START = '<!-- CHANGELOG:START -->';
const END = '<!-- CHANGELOG:END -->';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-07-13" -> "13 July 2026". Parsed by hand; Date() would apply a timezone. */
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** escapeHtml leaves quotes alone, which is fine in text but not in an attribute. */
function attr(s) {
  return s.replace(/"/g, '&quot;');
}

/**
 * The brand is written "inƒlow" on the site. CHANGELOG.md stays plain ASCII —
 * it is also read in a terminal, in git, and in the GitHub release notes — so
 * the mark is applied here, at render time.
 *
 * Only the standalone word is branded. A domain (inflow.im), a URL path
 * (github.com/grinich/inflow), and an identifier (inflow-notif-asked) must all
 * survive verbatim, or they stop working.
 */
export function brandify(text) {
  return text.replace(/(?<![/\w.-])inflow(?![\w-]|\.im)/g, 'inƒlow');
}

/**
 * Inline markdown -> HTML. Code spans are lifted out first so their contents
 * can't be re-processed as emphasis, a link, or an @mention — which also keeps
 * the brand mark out of anything written as code.
 */
function inline(md) {
  const code = [];
  let s = md.replace(/`([^`]+)`/g, (_, body) => {
    code.push(`<code>${escapeHtml(body)}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });

  s = brandify(s);
  s = escapeHtml(s);
  // Images before links — `![alt](src)` also matches the link pattern, and would
  // otherwise render as a literal "!" followed by a link to the image file.
  // An optional markdown title picks the variant: `![alt](src "icon")` is a
  // small square mark, anything else is a full-width screenshot. Without this
  // every image rendered at the icon's 96px, which is useless for a screenshot.
  // escapeHtml leaves quotes alone, so the title arrives with real " marks.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const cls = title === 'icon' ? 'rel-icon' : 'rel-shot';
    return `<img class="${cls}" src="${attr(src)}" alt="${attr(alt)}" loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

  // Bare GitHub references, as they appear in the markdown.
  s = s.replace(/(^|\s)@([A-Za-z0-9-]+)/g,
    '$1<a href="https://github.com/$2">@$2</a>');
  s = s.replace(/\(#(\d+)\)/g,
    '(<a href="https://github.com/grinich/inflow/issues/$1">#$1</a>)');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)]);
}

/** Group markdown lines into releases, each with its categories and bullets. */
function parseReleases(markdown) {
  const lines = markdown.split('\n');
  const releases = [];
  let release = null;
  let group = null;
  let paragraph = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length && release) {
      release.intro.push({ type: 'p', text: paragraph.join(' ').trim() });
    }
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length && release) {
      release.intro.push({ type: 'callout', text: quote.join(' ').trim() });
    }
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Link-reference definitions at the foot of the file.
    if (/^\[[^\]]+\]:\s*http/.test(line)) continue;

    const heading = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(line);
    if (heading) {
      flushParagraph();
      flushQuote();
      release = { version: heading[1], date: heading[2] ?? null, intro: [], groups: [] };
      group = null;
      releases.push(release);
      continue;
    }
    if (!release) continue;

    const category = /^### (.+)/.exec(line);
    if (category) {
      flushParagraph();
      flushQuote();
      group = { name: category[1].trim(), items: [] };
      release.groups.push(group);
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      const body = line.slice(2).trim();
      if (body !== '[!IMPORTANT]' && body !== '[!NOTE]' && body !== '[!WARNING]') quote.push(body);
      continue;
    }

    if (line === '') {
      flushParagraph();
      flushQuote();
      continue;
    }

    const nested = /^ {2,}- (.+)/.exec(line);
    const top = /^- (.+)/.exec(line);

    if (top && group) {
      group.items.push({ text: top[1], children: [] });
      continue;
    }
    if (nested && group && group.items.length) {
      group.items[group.items.length - 1].children.push({ text: nested[1] });
      continue;
    }
    // A wrapped continuation of whatever came last.
    if (/^\s+\S/.test(line) && group && group.items.length) {
      const item = group.items[group.items.length - 1];
      const target = item.children.length ? item.children[item.children.length - 1] : item;
      target.text += ` ${line.trim()}`;
      continue;
    }
    if (group && group.items.length) {
      const item = group.items[group.items.length - 1];
      item.text += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushQuote();
  return releases;
}

const TAG_CLASS = {
  Added: 't-added',
  Fixed: 't-fixed',
  Changed: 't-changed',
  Removed: 't-removed',
  Security: 't-removed',
  Deprecated: 't-changed',
};

function renderItem(item, indent) {
  const pad = ' '.repeat(indent);
  if (!item.children.length) {
    return `${pad}<li>${inline(item.text)}</li>`;
  }
  const kids = item.children
    .map((c) => `${pad}    <li>${inline(c.text)}</li>`)
    .join('\n');
  return [
    `${pad}<li>${inline(item.text)}`,
    `${pad}  <ul>`,
    kids,
    `${pad}  </ul>`,
    `${pad}</li>`,
  ].join('\n');
}

function renderReleases(releases) {
  const shipped = releases.filter((r) => r.version.toLowerCase() !== 'unreleased');
  const latest = shipped.find((r) => r.date);
  const out = [];

  for (const rel of shipped) {
    const meta = [`        <h2 class="rel-ver">${escapeHtml(rel.version)}</h2>`];
    if (rel.date) {
      meta.push(
        `        <time class="rel-date" datetime="${rel.date}">${formatDate(rel.date)}</time>`,
      );
    }
    if (rel === latest) meta.push('        <span class="rel-latest">Latest</span>');

    const body = [];
    for (const block of rel.intro) {
      const cls = block.type === 'callout' ? 'rel-callout' : 'rel-intro';
      body.push(`        <p class="${cls}">${inline(block.text)}</p>`);
    }
    for (const group of rel.groups) {
      const cls = TAG_CLASS[group.name] ?? 't-changed';
      body.push('        <section class="rel-group">');
      body.push(`          <h3 class="rel-tag ${cls}">${escapeHtml(group.name)}</h3>`);
      body.push('          <ul>');
      for (const item of group.items) body.push(renderItem(item, 12));
      body.push('          </ul>');
      body.push('        </section>');
    }

    out.push(
      [
        '    <article class="rel">',
        '      <div class="rel-meta">',
        ...meta,
        '      </div>',
        '      <div class="rel-body">',
        ...body,
        '      </div>',
        '    </article>',
      ].join('\n'),
    );
  }
  return out.join('\n\n');
}

function build() {
  const releases = parseReleases(readFileSync(SOURCE, 'utf8'));
  if (!releases.length) throw new Error('No releases parsed from CHANGELOG.md');

  const page = readFileSync(PAGE, 'utf8');
  const from = page.indexOf(START);
  const to = page.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(`Missing ${START} / ${END} markers in site/changelog.html`);
  }

  const next =
    page.slice(0, from + START.length) +
    '\n' + renderReleases(releases) + '\n' +
    page.slice(to);
  return { page, next, count: releases.length };
}

function main() {
  const check = process.argv.includes('--check');
  const { page, next, count } = build();

  if (check) {
    if (page !== next) {
      console.error(
        'site/changelog.html is out of date with CHANGELOG.md.\n' +
        'Run: npm run changelog:site',
      );
      process.exit(1);
    }
    console.log(`site/changelog.html is up to date (${count} releases).`);
    return;
  }

  if (page === next) {
    console.log(`site/changelog.html already up to date (${count} releases).`);
  } else {
    writeFileSync(PAGE, next);
    console.log(`Wrote ${count} releases to site/changelog.html.`);
  }
}

// Importable for tests; only runs the CLI when invoked as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { build, formatDate, inline, parseReleases, renderReleases };

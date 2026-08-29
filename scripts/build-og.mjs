#!/usr/bin/env node
/**
 * Renders scripts/og-image.html to site/og.png at exactly 1200x630 — the size
 * Open Graph and X both want for a large summary card.
 *
 *   npm run og
 *
 * Uses the Chrome already on the machine rather than pulling a headless
 * browser into devDependencies; the card changes about once a year. If Chrome
 * is somewhere else, set CHROME.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'scripts', 'og-image.html');
const OUT = join(ROOT, 'site', 'og.png');

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome found. Set CHROME=/path/to/chrome, or install Google Chrome.',
    );
  }
  return found;
}

/** Width/height out of the PNG header, so the result is verified, not assumed. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  const isPng = head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (!isPng) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  // A throwaway profile: without one Chrome may reuse the running instance's
  // and refuse to run headless.
  const profile = mkdtempSync(join(tmpdir(), 'inflow-og-'));
  if (existsSync(OUT)) unlinkSync(OUT);

  // Chrome writes the screenshot and then, in both headless modes on this
  // platform, declines to exit. So rather than waiting on the process, wait
  // for the file to appear and settle, then stop it ourselves.
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--window-size=${OG_WIDTH},${OG_HEIGHT}`,
    `--screenshot=${OUT}`,
    // Let the local images decode before the shot is taken.
    '--virtual-time-budget=3000',
    // Local file, so the avatars and icon resolve by relative path.
    `file://${SOURCE}`,
  ], { stdio: 'ignore' });

  try {
    let stableFor = 0;
    let lastSize = -1;
    for (let waited = 0; waited < 45_000; waited += 250) {
      await sleep(250);
      if (!existsSync(OUT)) continue;
      const { size } = statSync(OUT);
      // Two consecutive equal sizes means the write finished.
      stableFor = size === lastSize ? stableFor + 250 : 0;
      lastSize = size;
      if (size > 0 && stableFor >= 500) break;
    }
  } finally {
    child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }

  if (!existsSync(OUT)) throw new Error('Chrome produced no screenshot');
  const dims = pngSize(OUT);
  if (!dims) throw new Error('Output is not a PNG');
  if (dims.width !== OG_WIDTH || dims.height !== OG_HEIGHT) {
    throw new Error(`Expected ${OG_WIDTH}x${OG_HEIGHT}, got ${dims.width}x${dims.height}`);
  }

  const { size } = statSync(OUT);
  console.log(`Wrote site/og.png - ${dims.width}x${dims.height}, ${(size / 1024).toFixed(0)}KB`);
}

await main();

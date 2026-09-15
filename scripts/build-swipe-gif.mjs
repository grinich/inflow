#!/usr/bin/env node
/**
 * Renders scripts/swipe-demo.html to site/img/<version>-swipe-actions.gif.
 *
 *   npm run gif:swipe                 # defaults to 0.9.0
 *   npm run gif:swipe -- 0.9.1        # another version's filename
 *
 * The demo page lays every frame out as one tiled sheet, so this takes a
 * single headless-Chrome screenshot and lets ffmpeg's `untile` filter cut it
 * back into frames. One Chrome launch instead of seventy.
 *
 * Like scripts/build-og.mjs, this uses the Chrome already on the machine
 * rather than pulling a headless browser into devDependencies; the asset
 * changes about as often as the gesture does. Set CHROME to override.
 * Requires ffmpeg on PATH (brew install ffmpeg).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const VERSION = process.argv[2] || '0.9.0';
const OUT = join(ROOT, 'site/img', `${VERSION}-swipe-actions.gif`);

// Frame geometry. The changelog renders .rel-shot at the full ~775px content
// column, so a 520px-wide GIF was being upscaled there and looked soft; the
// tile is sized to be downscaled into that column instead, never stretched.
const TILE_W = 1040;
const TILE_H = 520;
const ZOOM = 2.6;
const FPS = 16;
const FRAMES = 84; // the last 15 hold the finished state, so the loop reads

// At this tile size one sheet of every frame would be tens of megapixels,
// which headless Chrome clips, so the frames are shot in chunks. COLS*ROWS
// must divide FRAMES exactly or the final sheet carries blank tiles, and
// `untile` would emit those as dead frames at the end of the loop.
const COLS = 4;
const ROWS = 7;
const CHUNK = COLS * ROWS;
const SHEETS = FRAMES / CHUNK;

if (!Number.isInteger(SHEETS)) {
  console.error(`COLS*ROWS (${CHUNK}) must divide FRAMES (${FRAMES}) exactly.`);
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME to its path.');
  process.exit(1);
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))
    );
  });

const work = mkdtempSync(join(tmpdir(), 'inflow-swipe-'));
const sheets = [];

try {
  for (let i = 0; i < SHEETS; i++) {
    const out = join(work, `sheet${i}.png`);
    const url =
      `file://${join(ROOT, 'scripts/swipe-demo.html')}` +
      `?frames=${CHUNK}&from=${i * CHUNK}&cols=${COLS}` +
      `&w=${TILE_W}&h=${TILE_H}&zoom=${ZOOM}`;
    console.log(`Rendering frames ${i * CHUNK}-${(i + 1) * CHUNK - 1} (${COLS}x${ROWS} sheet)...`);
    await run(chrome, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      `--screenshot=${out}`,
      `--window-size=${COLS * TILE_W},${ROWS * TILE_H}`,
      // Give the avatars a beat to decode, or early tiles render with gaps.
      '--virtual-time-budget=4000',
      url,
    ]);
    if (!existsSync(out)) throw new Error(`Chrome produced no sheet for chunk ${i}.`);
    sheets.push(out);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  console.log('Cutting the sheet into frames and encoding the GIF...');
  // untile turns the single image into a frame sequence, but every frame
  // inherits the still's timestamp — an `fps` filter here would see every frame
  // at t=0 and dedupe them down to a handful. setpts=N/FPS/TB stamps them in
  // order first. palettegen with stats_mode=diff then spends its colours on
  // what actually moves, which for a mostly-static list keeps this small.
  const untiled = sheets.map((_, i) => `[${i}:v]untile=${COLS}x${ROWS}[u${i}]`).join(';');
  const joined = sheets.map((_, i) => `[u${i}]`).join('');
  await run('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    ...sheets.flatMap((s) => ['-i', s]),
    '-filter_complex',
    `${untiled};${joined}concat=n=${sheets.length}:v=1:a=0,setpts=N/${FPS}/TB,split[a][b];` +
      `[a]palettegen=stats_mode=diff:max_colors=128[p];` +
      `[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    '-r', String(FPS),
    '-loop', '0',
    OUT,
  ]);

  const kb = Math.round(statSync(OUT).size / 1024);
  console.log(`${OUT.replace(ROOT + '/', '')} — ${TILE_W}x${TILE_H}, ${FRAMES} frames @ ${FPS}fps, ${kb} KB`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * site/app.webmanifest makes inflow.im/app installable as a desktop app.
 * Guard the fields the installed experience depends on: install criteria
 * (name/icons/start_url/display), single-window launches, the dock-menu
 * Compose shortcut, and that every referenced icon actually ships.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
const manifest = JSON.parse(readFileSync(join(SITE, 'app.webmanifest'), 'utf8'));

describe('app.webmanifest', () => {
  it('meets Chrome desktop install criteria', () => {
    // The name is the installed window's title-bar prefix — keep it the bare
    // mark, not a tagline (the OS shows "<name> - <page title>").
    expect(manifest.name).toBe('inƒlow');
    expect(manifest.short_name).toBe('inƒlow');
    expect(manifest.id).toBe('/app');
    expect(manifest.start_url).toBe('/app');
    expect(manifest.scope).toBe('/app');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('draws into the title bar, falling back to standalone', () => {
    expect(manifest.display_override).toEqual(['window-controls-overlay']);
  });

  it('focuses the existing window on launch instead of spawning duplicates', () => {
    expect(manifest.launch_handler).toEqual({ client_mode: 'navigate-existing' });
  });

  it('offers the dock-menu Compose shortcut inside the app scope', () => {
    expect(manifest.shortcuts).toHaveLength(1);
    const shortcut = manifest.shortcuts[0];
    expect(shortcut.name).toBe('Compose new message');
    // Must stay within scope (/app) or the shortcut opens a plain browser tab.
    expect(shortcut.url).toMatch(/^\/app\?/);
    expect(shortcut.url).toContain('compose=1');
  });

  it('every referenced icon file ships with the site', () => {
    const refs = [
      ...manifest.icons.map((i: { src: string }) => i.src),
      ...manifest.shortcuts.flatMap((s: { icons?: Array<{ src: string }> }) =>
        (s.icons ?? []).map((i) => i.src)
      ),
    ];
    for (const src of refs) {
      expect(existsSync(join(SITE, src)), `missing ${src}`).toBe(true);
    }
  });
});

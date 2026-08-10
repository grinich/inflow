import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = createRequire(import.meta.url)('./package.json');

// Distinguish a dev build (`wxt` / `npm run dev`) from a production build
// (`wxt build` / `wxt zip`). Used to tag the extension name + version so the
// chrome://extensions card makes it obvious which build is loaded.
const IS_PROD_BUILD = process.argv.includes('build') || process.argv.includes('zip');
const IS_DEV = !IS_PROD_BUILD;

function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}
// Total commit count — a monotonic local build number that changes as the app
// evolves, with no dependency on CI/upstream releases.
function commitCount(): number {
  try {
    return (
      Number(
        execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim(),
      ) || 0
    );
  } catch {
    return 0;
  }
}

// The manifest carries a 4th "build" segment (Chrome allows up to 4 integer
// segments, each 0–65535) so every build — dev or prod — has a distinct,
// visible number. package.json / git tags / CHANGELOG stay clean 3-part semver
// (e.g. 0.5.1). The build number is CI's run number when present, otherwise the
// local git commit count; modulo keeps it within Chrome's per-segment cap.
const BUILD_NUMBER =
  (Number(process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || 0) || commitCount()) % 65536;
// Full four-part version, e.g. "0.5.0.212".
const APP_VERSION = `${pkg.version}.${BUILD_NUMBER}`;
// Dev keeps the sha too, so a card shows both the build number and the commit:
// e.g. "0.5.0.212-dev+8a1f2c3".
const DEV_VERSION_NAME = `${APP_VERSION}-dev+${shortSha()}`;

export default defineConfig({
  outDir: 'dist',
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  manifest: {
    // Both dev and prod carry the 4-part build-numbered version so the
    // chrome://extensions card always shows a distinct, changing number. Chrome
    // displays `version_name` when present; we make sure it INCLUDES the build
    // number (prod: the full "0.5.0.212"; dev: that plus "-dev+<sha>").
    name: IS_DEV
      ? 'inƒlow (dev) — Messaging client for LinkedIn'
      : 'inƒlow — Messaging client for LinkedIn',
    description: 'A keyboard-driven LinkedIn messaging client',
    version: APP_VERSION,
    version_name: IS_DEV ? DEV_VERSION_NAME : APP_VERSION,
    // Pin a stable extension ID (fngobhjkhkdnnijgegkcjoadmddkehgh) regardless of
    // install path, so updates preserve IndexedDB + chrome.storage.local data.
    // The matching private key (inflow-signing-key.pem) is gitignored and only
    // needed for .crx signing, which we don't do.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn7myScuTpNTjXLfNUhfybBtFgcOglAzdabOT1SOrqs97CksZUVdRWvbZK6MNRupVkqScEVbA+MgvP//G+F7MkUwIMOBI27q8nkxfufMOm/LSiPz86sJTh/2hzysYauZex+ylQbKTJFvB4gWodCXvjLzBDzrQWWxbuArMIzZ1vJZ3XmFGFJ1/w3RIYLasNOOPltnPyd/QHC8T7O3HTwlbTZkvoDIRJIzUKZH0YEEtUbbHiE3Tc6oA51nVJMQdhEtEOdfJNQdL2QBYq9gWOWbA1Iq/jpCxtCxjixkYuv9XVO4YUF+d3CNMB584q3HjXdbQyQgibcOoRmKNFWcRMRSA+wIDAQAB',
    // Human version comes from package.json (bump via `npm version`); the
    // manifest `version`/`version_name` above derive from it (see APP_VERSION).
    permissions: ['cookies', 'storage', 'alarms', 'tabs', 'declarativeNetRequest', 'notifications'],
    // media.licdn.com: lets the background worker fetch avatar images for
    // native notification icons (MV3 notifications can't use remote URLs).
    host_permissions: ['https://www.linkedin.com/*', 'https://media.licdn.com/*', 'https://generativelanguage.googleapis.com/*', 'https://api.anthropic.com/*', 'https://api.github.com/*'],
    action: {
      default_icon: {
        '16': 'icon-16.png',
        '48': 'icon-48.png',
        '128': 'icon-128.png',
      },
    },
    icons: {
      '16': 'icon-16.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@/': resolve(__dirname, 'src') + '/',
        '@': resolve(__dirname, 'src'),
      },
    },
  }),
});

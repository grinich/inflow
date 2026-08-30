import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// The Chrome Web Store signs packages itself and rejects any upload carrying a
// `key` field ("key field is not allowed in manifest"), so store builds must omit
// it. Set INFLOW_STORE_BUILD=1 (see `npm run zip:store`) to produce that package.
//
// Consequence: the store-installed extension gets an ID Google assigns, not the
// pinned fngobhjkhkdnnijgegkcjoadmddkehgh. A store install is therefore a
// separate origin from a sideloaded one and starts with an empty database — it
// cannot inherit a sideloaded user's conversations.
const isStoreBuild = process.env.INFLOW_STORE_BUILD === '1';

// The app is framed by the inflow.im/app shell, which Chrome only permits for
// origins listed below. Testing that shell locally (`npm run dev:shell`, then
// `npx vercel dev` in site/) means letting localhost frame the app too — an
// explicit opt-in, never a release, because shipping it would let any page on
// localhost embed the app and talk to the extension.
const localShell = process.env.INFLOW_LOCAL_SHELL === '1';
const SHELL_MATCHES = [
  'https://inflow.im/*',
  ...(localShell ? ['http://localhost/*', 'http://127.0.0.1/*'] : []),
];

// Pins the extension ID for unpacked installs so updates preserve IndexedDB +
// chrome.storage.local data regardless of install path. The matching private key
// (inflow-signing-key.pem) is gitignored and only needed for .crx signing.
const UNPACKED_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn7myScuTpNTjXLfNUhfybBtFgcOglAzdabOT1SOrqs97CksZUVdRWvbZK6MNRupVkqScEVbA+MgvP//G+F7MkUwIMOBI27q8nkxfufMOm/LSiPz86sJTh/2hzysYauZex+ylQbKTJFvB4gWodCXvjLzBDzrQWWxbuArMIzZ1vJZ3XmFGFJ1/w3RIYLasNOOPltnPyd/QHC8T7O3HTwlbTZkvoDIRJIzUKZH0YEEtUbbHiE3Tc6oA51nVJMQdhEtEOdfJNQdL2QBYq9gWOWbA1Iq/jpCxtCxjixkYuv9XVO4YUF+d3CNMB584q3HjXdbQyQgibcOoRmKNFWcRMRSA+wIDAQAB';

export default defineConfig({
  outDir: 'dist',
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  // Keeps the store package distinguishable from the GitHub release artifact,
  // whose filename the release workflow depends on.
  zip: {
    artifactTemplate: `{{name}}-{{version}}-{{browser}}${isStoreBuild ? '-store' : ''}.zip`,
  },
  manifest: {
    // Chrome Web Store review rejects names that imply an official affiliation,
    // so this reads as a third-party inbox rather than a LinkedIn product.
    name: 'inflow — a better inbox for LinkedIn',
    description: 'A keyboard-driven inbox for your LinkedIn messages. Local-first, not affiliated with LinkedIn.',
    ...(isStoreBuild ? {} : { key: UNPACKED_KEY }),
    // version is read from package.json by WXT — bump there (npm version) only.
    permissions: ['cookies', 'storage', 'alarms', 'tabs', 'declarativeNetRequest', 'notifications'],
    // media.licdn.com: lets the background worker fetch avatar images for
    // native notification icons (MV3 notifications can't use remote URLs).
    host_permissions: ['https://www.linkedin.com/*', 'https://media.licdn.com/*', 'https://generativelanguage.googleapis.com/*', 'https://api.github.com/*'],
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
    // The web shell at inflow.im/app embeds app.html in a full-viewport iframe
    // (extension-origin frames escape storage partitioning, so the embedded app
    // keeps the same IndexedDB and chrome.* access as a directly-opened tab).
    // Only the top-level document needs to be web-accessible — its subresources
    // are same-origin extension loads. Keep the matches pinned to inflow.im:
    // widening them lets other sites embed the app (UI redressing) or probe
    // for the extension. No `use_dynamic_url` — the shell needs a stable URL.
    web_accessible_resources: [
      { resources: ['app.html'], matches: SHELL_MATCHES },
    ],
    // Lets the shell discover the installed extension ID via a PING message
    // (see entrypoints/background/external-messages.ts — nothing else answers).
    externally_connectable: { matches: SHELL_MATCHES },
  },
  vite: () => ({
    // `dev:shell` runs `wxt build`, which is production mode — so
    // import.meta.env.DEV is false there and cannot gate the localhost shell
    // support. This flag tracks the same opt-in the manifest above uses, so
    // the manifest and the code that honours it can never disagree.
    define: {
      __INFLOW_LOCAL_SHELL__: JSON.stringify(localShell),
    },
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@/': resolve(__dirname, 'src') + '/',
        '@': resolve(__dirname, 'src'),
      },
    },
  }),
});

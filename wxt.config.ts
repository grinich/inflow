import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  outDir: 'dist',
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  manifest: {
    name: 'inƒlow — Messaging client for LinkedIn',
    description: 'A keyboard-driven LinkedIn messaging client',
    // Pin a stable extension ID (fngobhjkhkdnnijgegkcjoadmddkehgh) regardless of
    // install path, so updates preserve IndexedDB + chrome.storage.local data.
    // The matching private key (inflow-signing-key.pem) is gitignored and only
    // needed for .crx signing, which we don't do.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn7myScuTpNTjXLfNUhfybBtFgcOglAzdabOT1SOrqs97CksZUVdRWvbZK6MNRupVkqScEVbA+MgvP//G+F7MkUwIMOBI27q8nkxfufMOm/LSiPz86sJTh/2hzysYauZex+ylQbKTJFvB4gWodCXvjLzBDzrQWWxbuArMIzZ1vJZ3XmFGFJ1/w3RIYLasNOOPltnPyd/QHC8T7O3HTwlbTZkvoDIRJIzUKZH0YEEtUbbHiE3Tc6oA51nVJMQdhEtEOdfJNQdL2QBYq9gWOWbA1Iq/jpCxtCxjixkYuv9XVO4YUF+d3CNMB584q3HjXdbQyQgibcOoRmKNFWcRMRSA+wIDAQAB',
    // version is read from package.json by WXT — bump there (npm version) only.
    permissions: ['cookies', 'storage', 'alarms', 'tabs', 'declarativeNetRequest'],
    host_permissions: ['https://www.linkedin.com/*', 'https://generativelanguage.googleapis.com/*', 'https://api.github.com/*'],
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

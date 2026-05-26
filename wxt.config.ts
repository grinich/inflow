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
    name: 'inƒlow — LinkedIn Messaging',
    description: 'A keyboard-driven LinkedIn messaging client',
    version: '0.1.0',
    permissions: ['cookies', 'storage', 'alarms', 'tabs', 'notifications', 'declarativeNetRequest'],
    host_permissions: ['https://www.linkedin.com/*'],
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

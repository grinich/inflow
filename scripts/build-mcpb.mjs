#!/usr/bin/env node
/**
 * Build dist/Inflow.mcpb — the Claude Desktop bundle.
 *
 * Stamps mcpb/manifest.json + mcpb/package.json with the root package
 * version, copies the icon in, installs production deps, and packs with the
 * official CLI. The output is a plain zip Claude Desktop installs on
 * double-click.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpbDir = join(root, 'mcpb');
const outDir = join(root, 'dist');
const out = join(outDir, 'Inflow.mcpb');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const file of ['manifest.json', 'package.json']) {
  const path = join(mcpbDir, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}

// Keep the server's self-reported version honest too.
const serverPath = join(mcpbDir, 'server', 'index.mjs');
const server = readFileSync(serverPath, 'utf8');
writeFileSync(serverPath, server.replace(/^const VERSION = '.*';$/m, `const VERSION = '${version}';`));

copyFileSync(join(root, 'public', 'icon-128.png'), join(mcpbDir, 'icon.png'));

execSync('npm install --omit=dev --no-audit --no-fund', { cwd: mcpbDir, stdio: 'inherit' });

mkdirSync(outDir, { recursive: true });
execSync(`npx --yes @anthropic-ai/mcpb@2 pack "${mcpbDir}" "${out}"`, {
  cwd: root,
  stdio: 'inherit',
});
console.log(`\nBuilt ${out} (v${version})`);

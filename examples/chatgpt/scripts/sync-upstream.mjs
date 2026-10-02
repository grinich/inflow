// Keep this directory independently deployable without maintaining a second
// implementation of Inflow's bridge protocol or generated tool catalog.
import { readFile, writeFile } from 'node:fs/promises';
const files = ['bridge-core.mjs', 'tool-catalog.mjs'];
const check = process.argv.includes('--check');
for (const name of files) {
  const source = new URL(`../../../mcpb/server/${name}`, import.meta.url);
  const copy = new URL(`../vendor/${name}`, import.meta.url);
  const original = await readFile(source);
  if (check) {
    if (!original.equals(await readFile(copy))) {
      throw new Error(`${name} differs from mcpb/server; run npm run sync:upstream`);
    }
  } else {
    await writeFile(copy, original);
  }
}
console.log(check ? 'Upstream bridge and catalog match.' : 'Upstream bridge and catalog copied.');

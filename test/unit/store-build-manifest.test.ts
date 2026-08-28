import { describe, it, expect, vi } from 'vitest';

/**
 * The Chrome Web Store signs packages itself and rejects any upload whose
 * manifest carries a `key` field. Unpacked installs, meanwhile, need that key to
 * hold a stable extension ID so updates keep their IndexedDB data. INFLOW_STORE_BUILD
 * splits the two, and this guards that the split touches `key` and nothing else.
 */
async function loadConfig(storeBuild: boolean) {
  const prev = process.env.INFLOW_STORE_BUILD;
  if (storeBuild) {
    process.env.INFLOW_STORE_BUILD = '1';
  } else {
    delete process.env.INFLOW_STORE_BUILD;
  }
  vi.resetModules();
  try {
    return (await import('../../wxt.config')).default;
  } finally {
    if (prev === undefined) delete process.env.INFLOW_STORE_BUILD;
    else process.env.INFLOW_STORE_BUILD = prev;
  }
}

const manifestOf = (config: Awaited<ReturnType<typeof loadConfig>>) =>
  config.manifest as Record<string, unknown>;

describe('store build manifest', () => {
  it('omits the key field when INFLOW_STORE_BUILD=1', async () => {
    const manifest = manifestOf(await loadConfig(true));
    expect('key' in manifest).toBe(false);
  });

  it('keeps the pinned key for normal (unpacked) builds', async () => {
    const manifest = manifestOf(await loadConfig(false));
    expect(manifest.key).toEqual(expect.stringContaining('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A'));
  });

  it('changes nothing but the key between the two builds', async () => {
    const store = manifestOf(await loadConfig(true));
    const unpacked = manifestOf(await loadConfig(false));
    const { key: _omitted, ...unpackedWithoutKey } = unpacked;
    expect(store).toEqual(unpackedWithoutKey);
  });

  // The web shell at inflow.im/app embeds app.html and probes for the
  // extension over externally_connectable. Both keys are a security boundary:
  // widening the matches lets arbitrary sites embed the app (UI redressing)
  // or probe for the extension's presence. Keep them pinned to inflow.im.
  it('exposes app.html to inflow.im only, and external messaging to inflow.im only', async () => {
    for (const storeBuild of [false, true]) {
      const manifest = manifestOf(await loadConfig(storeBuild));
      expect(manifest.web_accessible_resources).toEqual([
        { resources: ['app.html'], matches: ['https://inflow.im/*'] },
      ]);
      expect(manifest.externally_connectable).toEqual({ matches: ['https://inflow.im/*'] });
    }
  });

  it('names the store artifact distinctly so it cannot be mistaken for the release zip', async () => {
    const store = await loadConfig(true);
    const normal = await loadConfig(false);
    expect(store.zip?.artifactTemplate).toBe('{{name}}-{{version}}-{{browser}}-store.zip');
    // The release workflow publishes this exact filename — don't drift it.
    expect(normal.zip?.artifactTemplate).toBe('{{name}}-{{version}}-{{browser}}.zip');
  });
});

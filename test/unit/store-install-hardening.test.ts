/**
 * Adversarial coverage for store-install detection. The load-bearing edge is
 * the Edge Add-ons placeholder: EDGE_STORE_EXTENSION_ID is '' until the first
 * Edge submission, and an empty string must never leak into the store-ID set
 * (chrome.runtime.id can never be '', but a caller passing '' must not be
 * told "store install"). Regression 100 only checks this branch when the
 * placeholder is still empty — these assertions hold unconditionally.
 */
import {
  isStoreInstall,
  storeUrlFor,
  STORE_EXTENSION_ID,
  STORE_URL,
} from '@/lib/store-install';

describe('empty-string ID (the Edge placeholder) can never read as a store install', () => {
  it('isStoreInstall("") is false', () => {
    expect(isStoreInstall('')).toBe(false);
  });

  it('storeUrlFor("") points at the Chrome Web Store, never a malformed Edge URL', () => {
    expect(storeUrlFor('')).toBe(STORE_URL);
    expect(storeUrlFor('')).not.toContain('microsoftedge');
  });
});

describe('default-argument path reads chrome.runtime.id', () => {
  it('detects a store install from the live runtime id', () => {
    (globalThis.chrome as any).runtime.id = STORE_EXTENSION_ID;
    expect(isStoreInstall()).toBe(true);
    expect(storeUrlFor()).toBe(STORE_URL);
  });

  it('treats the mock/dev id as a manual install', () => {
    expect(isStoreInstall()).toBe(false);
  });

  it('fails closed when chrome.runtime is missing (e.g. a plain web context)', () => {
    const saved = (globalThis as any).chrome;
    try {
      (globalThis as any).chrome = {};
      expect(isStoreInstall()).toBe(false);
      expect(storeUrlFor()).toBe(STORE_URL);
    } finally {
      (globalThis as any).chrome = saved;
    }
  });

  it('fails closed when the chrome global does not exist at all', () => {
    const saved = (globalThis as any).chrome;
    try {
      delete (globalThis as any).chrome;
      expect(isStoreInstall()).toBe(false);
      expect(storeUrlFor()).toBe(STORE_URL);
    } finally {
      (globalThis as any).chrome = saved;
    }
  });
});

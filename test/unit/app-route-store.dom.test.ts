// @vitest-environment jsdom
// The top-level view is routed by the URL hash: the store writes it, and
// back/forward (hashchange) reads it back. See src/lib/app-route.ts.
import { useUIStore } from '@/store/ui-store';

/** jsdom fires hashchange asynchronously after a location.hash assignment. */
function nextTick() {
  return new Promise((r) => setTimeout(r, 0));
}

async function setHashLikeBackButton(hash: string) {
  window.location.hash = hash;
  await nextTick();
}

describe('ui-store ↔ URL hash routing', () => {
  beforeEach(async () => {
    window.location.hash = '';
    await nextTick();
    useUIStore.setState({ appView: 'inbox', networkSelectedIndex: 0 });
  });

  it('setAppView("network") writes #/network to the URL', () => {
    useUIStore.getState().setAppView('network');
    expect(window.location.hash).toBe('#/network');
  });

  it('setAppView("inbox") writes #/inbox to the URL', () => {
    useUIStore.getState().setAppView('network');
    useUIStore.getState().setAppView('inbox');
    expect(window.location.hash).toBe('#/inbox');
  });

  it('a hash change (back/forward) updates the store', async () => {
    await setHashLikeBackButton('#/network');
    expect(useUIStore.getState().appView).toBe('network');

    await setHashLikeBackButton('#/inbox');
    expect(useUIStore.getState().appView).toBe('inbox');
  });

  it('a hash change resets the network selection like setAppView does', async () => {
    useUIStore.setState({ networkSelectedIndex: 4 });
    await setHashLikeBackButton('#/network');
    expect(useUIStore.getState().networkSelectedIndex).toBe(0);
  });

  it('an unrelated hash falls back to the inbox', async () => {
    useUIStore.getState().setAppView('network');
    await setHashLikeBackButton('#/whatever');
    expect(useUIStore.getState().appView).toBe('inbox');
  });

  it('does not push a duplicate entry when the hash already matches', async () => {
    const before = window.history.length;
    // Simulate the hash arriving first (back button), then the store echo.
    await setHashLikeBackButton('#/network');
    const afterHash = window.history.length;
    useUIStore.getState().setAppView('network'); // already network — no-op
    expect(window.location.hash).toBe('#/network');
    expect(window.history.length).toBe(afterHash);
    expect(afterHash).toBeGreaterThanOrEqual(before);
  });

  it('reads the initial view from the hash on load', async () => {
    window.location.hash = '#/network';
    vi.resetModules();
    const fresh = await import('@/store/ui-store');
    expect(fresh.useUIStore.getState().appView).toBe('network');
    // Restore the module registry for later tests in this file.
    window.location.hash = '';
    vi.resetModules();
  });
});

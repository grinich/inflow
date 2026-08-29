// @vitest-environment jsdom
// Feature: the top banner now moves sideloaded users to the Chrome Web Store
// instead of walking them through downloading a zip.
//
// The load-bearing case is the store install: it updates itself, so any
// "reinstall to get updates" nudge shown there would be telling a user to
// uninstall the copy they just installed. Chrome gives the store build its own
// extension ID, and that ID — not a permission-gated installType lookup — is
// what separates the two.
import '../dom-setup';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateBanner } from '@/components/common/UpdateBanner';
import {
  isStoreInstall,
  storeUrlFor,
  STORE_EXTENSION_ID,
  EDGE_STORE_EXTENSION_ID,
  STORE_URL,
} from '@/lib/store-install';
import { resetChromeMock } from '../mocks/chrome';

beforeEach(() => {
  resetChromeMock();
});

describe('store-install detection', () => {
  it('recognises the Chrome Web Store extension ID', () => {
    expect(isStoreInstall(STORE_EXTENSION_ID)).toBe(true);
  });

  it('treats every other ID as a manual install', () => {
    // The pinned unpacked key from wxt.config.ts, and the dev-server default.
    expect(isStoreInstall('fngobhjkhkdnnijgegkcjoadmddkehgh')).toBe(false);
    expect(isStoreInstall('test-extension-id')).toBe(false);
    expect(isStoreInstall(undefined)).toBe(false);
  });

  it('points at the real listing', () => {
    expect(STORE_URL).toContain(STORE_EXTENSION_ID);
  });

  it('recognises the Edge Add-ons extension ID once one exists', () => {
    if (!EDGE_STORE_EXTENSION_ID) {
      // Placeholder until the first Edge submission — the empty string must
      // never count as a store install (chrome.runtime.id can't be '').
      expect(isStoreInstall('')).toBe(false);
      return;
    }
    expect(isStoreInstall(EDGE_STORE_EXTENSION_ID)).toBe(true);
    expect(storeUrlFor(EDGE_STORE_EXTENSION_ID)).toContain('microsoftedge.microsoft.com');
  });

  it('resolves the listing URL per install, defaulting to the Chrome Web Store', () => {
    expect(storeUrlFor(STORE_EXTENSION_ID)).toBe(STORE_URL);
    expect(storeUrlFor('fngobhjkhkdnnijgegkcjoadmddkehgh')).toBe(STORE_URL);
    expect(storeUrlFor(undefined)).toBe(STORE_URL);
  });
});

describe('store migration banner', () => {
  it('renders nothing on a store install, which already auto-updates', async () => {
    (globalThis.chrome as any).runtime.id = STORE_EXTENSION_ID;

    const { container } = render(<UpdateBanner />);
    // Give the storage read a chance to resolve and re-render.
    await waitFor(() => expect(container).toBeTruthy());
    expect(screen.queryByText(/Chrome Web Store/i)).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('asks a sideloaded install to move to the store', async () => {
    (globalThis.chrome as any).runtime.id = 'fngobhjkhkdnnijgegkcjoadmddkehgh';

    render(<UpdateBanner />);

    const cta = await screen.findByRole('link', { name: /install from the store/i });
    expect(cta).toHaveAttribute('href', STORE_URL);
    expect(screen.getByText(/won't update itself/i)).toBeInTheDocument();
  });

  it('warns that the store copy starts with an empty database', async () => {
    (globalThis.chrome as any).runtime.id = 'fngobhjkhkdnnijgegkcjoadmddkehgh';

    render(<UpdateBanner />);
    await screen.findByRole('link', { name: /install from the store/i });

    await userEvent.click(screen.getByRole('button', { name: /what happens to my messages/i }));

    expect(screen.getByText(/empty local database/i)).toBeInTheDocument();
    expect(screen.getByText(/re-sync from LinkedIn/i)).toBeInTheDocument();
  });

  it('stays dismissed for the running version, and returns on the next build', async () => {
    (globalThis.chrome as any).runtime.id = 'fngobhjkhkdnnijgegkcjoadmddkehgh';

    const { unmount } = render(<UpdateBanner />);
    await screen.findByRole('link', { name: /install from the store/i });

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /install from the store/i })).toBeNull(),
    );
    // Persisted, so a reopen of the app stays quiet.
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      storeMigrationDismissedVersion: '0.4.0',
    });

    unmount();
    render(<UpdateBanner />);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /install from the store/i })).toBeNull(),
    );

    // A newer sideloaded build re-surfaces the nudge rather than silencing it forever.
    unmount();
    (globalThis.chrome as any).runtime.getManifest = () => ({ version: '0.5.0' });
    render(<UpdateBanner />);
    expect(await screen.findByRole('link', { name: /install from the store/i })).toBeInTheDocument();
  });
});

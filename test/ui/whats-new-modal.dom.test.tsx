// @vitest-environment jsdom
// The "What's new" modal auto-shows after an update, stays quiet on a fresh
// install or when already current, and marks the version seen on dismiss.
import '../dom-setup';

vi.mock('@/lib/changelog-data', () => ({
  CHANGELOG_TEXT: `# Changelog

## [0.5.0] - 2026-08-09

### Added
- Insights section.

## [0.4.0] - 2026-07-13

### Added
- Avatars in notifications.
`,
}));

import { render, screen, act, fireEvent } from '@testing-library/react';
import { WhatsNewModal } from '@/components/common/WhatsNewModal';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  localStorage.clear();
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    runtime: { getManifest: () => ({ version: '0.5.0' }) },
  };
  act(() => useUIStore.setState({ whatsNewOpen: false }));
});

it('auto-shows release notes when the seen version is older', () => {
  localStorage.setItem('inflow-last-seen-version', '0.4.0');
  render(<WhatsNewModal />);
  expect(screen.getByRole('dialog', { name: /what.?s new/i })).toBeInTheDocument();
  expect(screen.getByText('Insights section.')).toBeInTheDocument();
});

it('marks the version seen on dismiss', () => {
  localStorage.setItem('inflow-last-seen-version', '0.4.0');
  render(<WhatsNewModal />);
  fireEvent.click(screen.getByRole('button', { name: /got it/i }));
  expect(localStorage.getItem('inflow-last-seen-version')).toBe('0.5.0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('stays quiet on a fresh install and records the current version', () => {
  render(<WhatsNewModal />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(localStorage.getItem('inflow-last-seen-version')).toBe('0.5.0');
});

it('stays quiet when already on the seen version', () => {
  localStorage.setItem('inflow-last-seen-version', '0.5.0');
  render(<WhatsNewModal />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('handles a 4-part production build version (0.5.0.457) via its core', () => {
  (globalThis as any).chrome.runtime.getManifest = () => ({ version: '0.5.0.457' });
  localStorage.setItem('inflow-last-seen-version', '0.4.0');
  render(<WhatsNewModal />);
  expect(screen.getByText('Insights section.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /got it/i }));
  // Stores the clean 3-part core, not the build version.
  expect(localStorage.getItem('inflow-last-seen-version')).toBe('0.5.0');
});

it('opens manually via the store even when already seen', () => {
  localStorage.setItem('inflow-last-seen-version', '0.5.0');
  render(<WhatsNewModal />);
  act(() => useUIStore.getState().setWhatsNewOpen(true));
  expect(screen.getByRole('dialog', { name: /what.?s new/i })).toBeInTheDocument();
  expect(screen.getByText('Insights section.')).toBeInTheDocument();
});

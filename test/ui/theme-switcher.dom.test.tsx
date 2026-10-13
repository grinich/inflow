// @vitest-environment jsdom
/**
 * Theme switching from the nav rail, above Settings.
 *
 * A flyout rather than a strip inside the rail: the rail collapses to ~48px,
 * too narrow for four labelled swatches, and an in-rail strip would push the
 * items below it as it opened. Floating keeps one layout for both states and
 * leaves the rail still.
 */
import '../dom-setup';

import { render, screen, fireEvent } from '@testing-library/react';
import { useUIStore } from '@/store/ui-store';
import { ThemeSwitcher } from '@/components/nav/ThemeSwitcher';

beforeEach(() => {
  useUIStore.setState({ theme: 'dark' });
  document.documentElement.className = '';
});

const trigger = () => screen.getByRole('button', { name: /^Theme:/ });

it('is closed until asked, then lists every theme', () => {
  render(<ThemeSwitcher />);
  expect(screen.queryByRole('menu')).toBeNull();

  fireEvent.click(trigger());

  const menu = screen.getByRole('menu', { name: 'Theme' });
  for (const name of ['Light', 'Dark', 'System', 'Purple']) {
    expect(screen.getByRole('menuitemradio', { name: new RegExp(name) })).toBeTruthy();
  }
  expect(menu).toBeTruthy();
});

it('applies a theme on the spot, with no second confirmation', () => {
  // The Settings panel drafts and saves; a switcher that needed that too
  // would not be worth reaching for.
  render(<ThemeSwitcher />);
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Purple/ }));

  expect(useUIStore.getState().theme).toBe('purple');
  // Purple layers on the dark base, so both classes apply (see applyTheme).
  expect(document.documentElement.classList.contains('theme-purple')).toBe(true);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  // And it closes behind itself.
  expect(screen.queryByRole('menu')).toBeNull();
});

it('marks which theme is on, so the swatches do not have to be decoded', () => {
  useUIStore.setState({ theme: 'system' });
  render(<ThemeSwitcher />);
  fireEvent.click(trigger());

  expect(screen.getByRole('menuitemradio', { name: /System/ }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('menuitemradio', { name: /Light/ }).getAttribute('aria-checked')).toBe('false');
});

it('names the current theme on the trigger, which is all there is when collapsed', () => {
  useUIStore.setState({ theme: 'purple' });
  render(<ThemeSwitcher collapsed />);
  // Collapsed the label is gone, so the accessible name carries it.
  expect(screen.getByRole('button', { name: 'Theme: Purple' })).toBeTruthy();
  expect(screen.queryByText('Theme')).toBeNull();
});

it('closes on Escape and on a click outside, not only on a choice', () => {
  render(<ThemeSwitcher />);

  fireEvent.click(trigger());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(useUIStore.getState().theme).toBe('dark'); // nothing changed

  fireEvent.click(trigger());
  fireEvent.click(document.querySelector('.fixed.inset-0')!);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(useUIStore.getState().theme).toBe('dark');
});

it('outlines the swatch against itself, not against the panel', () => {
  // --edge is near-white in light mode, so a white Light swatch on a light
  // panel had no visible border and the control read as an empty checkbox in
  // every light-mode screenshot.
  useUIStore.setState({ theme: 'light' });
  render(<ThemeSwitcher />);

  const swatch = trigger().querySelector('span[aria-hidden]')!;
  expect(swatch.className).not.toMatch(/ring-edge/);
  // Dark ring while light is applied, light ring once dark is.
  expect(swatch.className).toMatch(/ring-black\//);
  expect(swatch.className).toMatch(/dark:ring-white\//);
});

it('outlines the swatches in the menu the same way', () => {
  render(<ThemeSwitcher />);
  fireEvent.click(trigger());

  for (const name of ['Light', 'Dark', 'System', 'Purple']) {
    const row = screen.getByRole('menuitemradio', { name: new RegExp(name) });
    const swatch = row.querySelector('span[aria-hidden]')!;
    expect(swatch.className, name).not.toMatch(/ring-edge/);
    expect(swatch.className, name).toMatch(/ring-black\//);
  }
});

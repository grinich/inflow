// @vitest-environment jsdom
/**
 * Regression: the shortcut sheet promised keys the handler never implemented.
 *
 * It listed "G C → Go to Connections", but the chord only resolved "g i". The
 * sections added since — Invitations, Insights, MCP connector, AI Chat — had
 * no key at all, which on a keyboard-first app means they were unreachable
 * without the mouse.
 *
 * The chord resolves in two places (inbox context and everywhere else), which
 * is how they drifted apart, so both are covered here.
 */
import '../dom-setup';

import { renderHook, act } from '@testing-library/react';
import { useUIStore } from '@/store/ui-store';
import { shortcutDefinitions } from '@/lib/keyboard/shortcuts';

vi.mock('@/hooks/useConversations', () => ({ useConversations: () => ({ conversations: [] }) }));
vi.mock('@/hooks/useOptimisticAction', () => ({ useOptimisticAction: () => ({}) }));

import { useKeyboard } from '@/hooks/useKeyboard';

const press = (key: string) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

beforeEach(() => {
  useUIStore.setState({ activeSection: 'inbox', selectedConversationId: null });
});

const JUMPS: [string, string][] = [
  ['i', 'inbox'],
  ['c', 'connections'],
  ['v', 'invitations'],
  ['t', 'insights'],
  ['m', 'outbox'],
  ['a', 'chat'],
];

it.each(JUMPS)('g then %s reaches %s from the inbox', (key, section) => {
  renderHook(() => useKeyboard());
  useUIStore.setState({ activeSection: 'inbox' });

  press('g');
  press(key);

  expect(useUIStore.getState().activeSection).toBe(section);
});

it.each(JUMPS)('g then %s reaches %s from another section', (key, section) => {
  renderHook(() => useKeyboard());
  // Start somewhere that is not the inbox: the chord resolves in a different
  // branch of the hook there, and that branch only knew about "g i".
  useUIStore.setState({ activeSection: 'insights' });

  press('g');
  press(key);

  expect(useUIStore.getState().activeSection).toBe(section);
});

it('still filters rather than navigating for the inbox-only chords', () => {
  renderHook(() => useKeyboard());
  useUIStore.setState({ activeSection: 'inbox' });

  press('g');
  press('s');

  // g s is "go to starred", a search filter, not a section jump.
  expect(useUIStore.getState().activeSection).toBe('inbox');
  expect(useUIStore.getState().searchQuery).toMatch(/is:starred/);
});

it('documents every jump it implements, and implements every one it documents', () => {
  // The sheet is the only place a user learns these exist, so a key listed
  // there and missing from the handler is worse than no key at all.
  const documented = shortcutDefinitions.filter((s) => /^G [A-Z]$/.test(s.display))
    .map((s) => s.display.split(' ')[1].toLowerCase())
    .filter((k) => !['s', 'u'].includes(k)) // inbox filters, not section jumps
    .sort();
  expect(documented).toEqual(JUMPS.map(([k]) => k).sort());
});

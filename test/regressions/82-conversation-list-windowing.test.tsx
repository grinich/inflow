// @vitest-environment jsdom
/**
 * Regression: switching inbox folders was sluggish.
 *
 * Every folder switch mounted a ConversationRow for EVERY conversation in the
 * folder (no windowing), and each row fired three IndexedDB lookups on mount
 * (draft, failed-message, company profile) — ~900 queries and hundreds of
 * component mounts for a large Archive/Other folder, repeated on every
 * live-query churn during background sync.
 *
 * Fix: the list renders only the rows near the viewport (computeWindow), the
 * per-row lookups are batched into three list-level queries, rows are
 * memoized, and useConversations returns the tab's previous results
 * synchronously while the fresh query runs.
 */
import '../dom-setup';

if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof (globalThis as any).IntersectionObserver === 'undefined') {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { computeWindow } from '@/lib/list-window';
import { makeConversation, resetFactories } from '../fixtures/factories';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...args: any[]) => sendBridgeMessage(...args),
}));

import { render, act } from '@testing-library/react';
import { renderHook, waitFor } from '@testing-library/react';
import { ConversationList } from '@/components/conversations/ConversationList';
import { useConversations } from '@/hooks/useConversations';
import { useUIStore } from '@/store/ui-store';

beforeEach(async () => {
  resetFactories();
  testDb = new Dexie(`TestDB_82_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  useUIStore.setState({ inboxTab: 'focused', searchQuery: '', selectedConversationId: null });
});

afterEach(() => {
  testDb.close();
});

describe('computeWindow (pure)', () => {
  it('renders only the viewport slice plus overscan', () => {
    const w = computeWindow(6400, 600, 64, 500, 8);
    // scrollTop 6400/64 = row 100; viewport shows ~10 rows.
    expect(w.start).toBe(92); // 100 - overscan
    expect(w.end).toBe(118); // ceil((6400+600)/64)=110 + overscan
    expect(w.topPad).toBe(92 * 64);
    expect(w.bottomPad).toBe((500 - 118) * 64);
  });

  it('clamps at the top and bottom of the list', () => {
    const top = computeWindow(0, 600, 64, 500, 8);
    expect(top.start).toBe(0);
    expect(top.topPad).toBe(0);

    const bottom = computeWindow(500 * 64, 600, 64, 500, 8);
    expect(bottom.end).toBe(500);
    expect(bottom.bottomPad).toBe(0);
  });

  it('handles empty lists and degenerate row heights', () => {
    expect(computeWindow(0, 600, 64, 0)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
    expect(computeWindow(0, 600, 0, 100)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
  });

  it('total height is invariant: pads + rendered rows span the full list', () => {
    for (const scrollTop of [0, 999, 12_345, 31_999]) {
      const w = computeWindow(scrollTop, 600, 64, 500, 8);
      expect(w.topPad + (w.end - w.start) * 64 + w.bottomPad).toBe(500 * 64);
    }
  });
});

describe('ConversationList windowed rendering', () => {
  it('mounts only a small slice of a large folder', async () => {
    const conversations = Array.from({ length: 300 }, (_, i) =>
      makeConversation({ id: `2-conv-${i}`, lastActivityAt: 1_000_000 - i })
    );

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ConversationList conversations={conversations} category="PRIMARY_INBOX" />
      ));
    });

    const rendered = container.querySelectorAll('[data-conversation-id]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60); // viewport slice + overscan, not 300
  });
});

describe('useConversations per-tab result memory', () => {
  it('returns the previous results for a tab synchronously while re-querying', async () => {
    await testDb.conversations.bulkPut(
      Array.from({ length: 5 }, (_, i) =>
        makeConversation({ id: `2-focused-${i}`, category: 'PRIMARY_INBOX', archived: 0 })
      )
    );
    await testDb.conversations.put(
      makeConversation({ id: '2-other-1', category: 'SECONDARY_INBOX', archived: 0 })
    );

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.conversations).toHaveLength(5));

    // Switch to Other, let it load, then switch back to Focused.
    act(() => useUIStore.getState().setInboxTab('other'));
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    act(() => useUIStore.getState().setInboxTab('focused'));
    // Immediately after the switch — before the live query resolves — the
    // cached Focused results must already be shown (no blank flash).
    expect(result.current.conversations).toHaveLength(5);
  });
});

// @vitest-environment jsdom
/**
 * Regression: ThreadView's focus-triggered auto-read timer survived unmount.
 *
 * The main auto-read effect registers its cleanup only when it actually sets
 * a timer — mounting while the tab is hidden returns early with NO cleanup.
 * The visibilitychange handler then sets the 2s timer, but its own effect
 * cleanup only removes the LISTENER. Close the thread within those 2s and the
 * timer still fires: markRead writes read=1 for a conversation the user
 * already bailed out of (a DB write from an unmounted component).
 */
import '../dom-setup';

if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import Dexie from 'dexie';
import { act, render } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;
const { mockMarkRead } = vi.hoisted(() => ({ mockMarkRead: vi.fn() }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/hooks/useThread', () => ({ useThread: () => [] }));

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({ sendMessage: vi.fn(), markRead: mockMarkRead }),
}));

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (_fn: any, _deps: any, def: any) => def,
}));

vi.mock('@/components/thread/ThreadHeader', () => ({ ThreadHeader: () => null }));
vi.mock('@/components/thread/ComposeBox', () => ({ ComposeBox: () => null }));

import { createRef } from 'react';
import { ThreadView } from '@/components/thread/ThreadView';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_125_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockMarkRead.mockReset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  vi.useRealTimers();
  setVisibility('visible');
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('does not mark read after the thread was closed within the focus dwell window', async () => {
  const conversation = makeConversation({ id: '2-unmount', read: 0 });

  // Mount while the tab is hidden — the main auto-read effect bails without
  // registering a cleanup.
  setVisibility('hidden');
  const { unmount } = render(
    <ThreadView conversation={conversation as any} composeRef={createRef<HTMLTextAreaElement>()} />
  );

  // Tab regains focus → visibility handler arms the 2s dwell timer.
  await act(async () => {
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // User closes the thread before the dwell elapses.
  unmount();

  await act(async () => {
    vi.advanceTimersByTime(2500);
  });

  expect(mockMarkRead).not.toHaveBeenCalled();
});

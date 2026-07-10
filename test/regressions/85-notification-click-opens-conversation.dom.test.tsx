// @vitest-environment jsdom
// Bug: clicking a native macOS notification for a new message opened (or focused)
// the app tab but did NOT jump to that conversation — it landed on whatever was
// already selected. The notification click discarded the notification ID (which
// IS the conversation ID) and just called openAppTab() with no target.
//
// Fix: the click records the target conversation in chrome.storage.session and
// opens the tab. The app's PendingNavigation handler consumes it on load (the
// tab was just created) and reacts to live writes (the tab already existed),
// then navigates to the conversation — switching to its inbox tab first.
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { render, waitFor } from '@testing-library/react';
import { PendingNavigation } from '@/components/common/PendingNavigation';
import { openAppTab } from '../../entrypoints/background/open-app-tab';
import { PENDING_NAVIGATION_KEY, setPendingNavigation } from '@/lib/pending-navigation';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import { setSessionStore } from '../mocks/chrome';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_notif_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  // A conversation that lives in the "Other" (SECONDARY_INBOX) tab.
  await testDb.conversations.put(
    makeConversation({ id: 'c-other', category: 'SECONDARY_INBOX', archived: 0 }),
  );
  useUIStore.setState({ inboxTab: 'focused', selectedConversationId: null, viewMode: 'list', _pendingRestore: null });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('native notification click → open conversation', () => {
  it('openAppTab records the target conversation for the app to pick up', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.create).mockResolvedValue({ id: 1 } as any);

    await openAppTab({ conversationId: 'c-other' });

    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [PENDING_NAVIGATION_KEY]: expect.objectContaining({ conversationId: 'c-other' }),
      }),
    );
    // Still opened the tab.
    expect(chrome.tabs.create).toHaveBeenCalled();
  });

  it('a plain openAppTab() (toolbar click) records no navigation target', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.create).mockResolvedValue({ id: 1 } as any);

    await openAppTab();

    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('consumes the target on mount (tab freshly created) and jumps to the conversation', async () => {
    setSessionStore(PENDING_NAVIGATION_KEY, { conversationId: 'c-other', ts: 1 });

    render(<PendingNavigation />);

    await waitFor(() => expect(useUIStore.getState().selectedConversationId).toBe('c-other'));
    // The conversation lives in the "Other" tab, so we must switch there.
    expect(useUIStore.getState().inboxTab).toBe('other');
    // Consumed so a reload can't replay it.
    const stored = await chrome.storage.session.get(PENDING_NAVIGATION_KEY);
    expect(stored[PENDING_NAVIGATION_KEY]).toBeNull();
  });

  it('reacts to a live target write (tab already open) and jumps to the conversation', async () => {
    render(<PendingNavigation />);
    // Nothing pending at mount.
    await waitFor(() =>
      expect(vi.mocked(chrome.storage.onChanged.addListener)).toHaveBeenCalled(),
    );
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];

    // Simulate the background recording a target while the tab is open.
    await setPendingNavigation('c-other', 42);
    listener(
      { [PENDING_NAVIGATION_KEY]: { newValue: { conversationId: 'c-other', ts: 42 } } as any },
      'session',
    );

    await waitFor(() => expect(useUIStore.getState().selectedConversationId).toBe('c-other'));
    expect(useUIStore.getState().inboxTab).toBe('other');
  });

  it('ignores changes in other storage areas and the clearing (null) write', async () => {
    render(<PendingNavigation />);
    await waitFor(() =>
      expect(vi.mocked(chrome.storage.onChanged.addListener)).toHaveBeenCalled(),
    );
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];

    // Wrong area — must not navigate.
    listener(
      { [PENDING_NAVIGATION_KEY]: { newValue: { conversationId: 'c-other', ts: 1 } } as any },
      'local',
    );
    // The consume/clear write (newValue null) — must not navigate.
    listener({ [PENDING_NAVIGATION_KEY]: { newValue: null } as any }, 'session');

    // Give any erroneous async navigation a chance to run.
    await Promise.resolve();
    expect(useUIStore.getState().selectedConversationId).toBeNull();
  });
});

// @vitest-environment jsdom
// Bug (High): IncomingMessageToast click opens a conversation that isn't in the
// active tab's filtered list, so the App auto-select effect lands on the wrong
// thread. The toast must switch to the conversation's tab first.
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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IncomingMessageToast } from '@/components/common/IncomingMessageToast';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_toast_${Date.now()}_${Math.random()}`);
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

it('switches to the conversation\'s tab when its toast is clicked from another tab', async () => {
  render(<IncomingMessageToast />);
  window.dispatchEvent(
    new CustomEvent('inflow:demo-incoming', {
      detail: { id: 'm1', senderName: 'Alice', senderPicture: '', body: 'hi', conversationId: 'c-other' },
    }),
  );
  const toastText = await screen.findByText('Alice');
  fireEvent.click(toastText);

  await waitFor(() => expect(useUIStore.getState().selectedConversationId).toBe('c-other'));
  // The conversation lives in the "Other" tab, so the toast must switch there.
  expect(useUIStore.getState().inboxTab).toBe('other');
});

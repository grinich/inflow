// @vitest-environment jsdom
/**
 * Regression: changing recipients in the new-message composer silently
 * destroyed the draft's typed text and attachments.
 *
 * The draft body/files live in draftAttachments keyed by the draft
 * conversation id, and the id is derived from the recipient set. Adding or
 * removing a recipient called cleanupDraft(oldId) — deleting the
 * draftAttachments row (the typed message!) — and created a fresh empty
 * draft under the new id. No warning, no undo.
 *
 * Fix: the draft row is MIGRATED to the new id; changing recipients is not
 * "discard".
 *
 * Also: ArrowDown on an empty result list drove selectedIdx to -1, and the
 * async typeahead merge never reset it — Enter became a permanent no-op for
 * that query.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeProfile } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { NewMessageComposer } from '@/components/composer/NewMessageComposer';
import { useUIStore } from '@/store/ui-store';

// jsdom doesn't implement scrollIntoView; TypeaheadRow calls it in an effect,
// and an effect throw unmounts the whole tree.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(async () => {
  testDb = new Dexie(`Composer_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.profiles.bulkPut([
    makeProfile({ urn: 'urn:li:fsd_profile:SARAH', fullName: 'Sarah Chen', firstName: 'Sarah', lastName: 'Chen' }),
    makeProfile({ urn: 'urn:li:fsd_profile:MARCUS', fullName: 'Marcus Webb', firstName: 'Marcus', lastName: 'Webb' }),
  ]);
  useUIStore.setState({ inboxTab: 'focused', composeNewActive: true });
  mockSendBridgeMessage.mockReset().mockImplementation(async (msg: any) => {
    if (msg.type === 'CHECK_AUTH') return { success: true, data: { memberUrn: 'urn:li:fsd_profile:SELF' } };
    if (msg.type === 'TYPEAHEAD_SEARCH') return { success: true, data: [] };
    return { success: true };
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function pickRecipient(input: HTMLElement, query: string, name: string) {
  await userEvent.clear(input);
  await userEvent.type(input, query);
  const row = await screen.findByText(name, {}, { timeout: 3000 });
  await userEvent.click(row);
}

it('adding a recipient migrates the typed draft to the new draft id', async () => {
  render(<NewMessageComposer />);
  const input = screen.getByPlaceholderText('Search for a person...');

  await pickRecipient(input, 'sarah', 'Sarah Chen');
  await waitFor(async () => expect(await testDb.conversations.get('draft-SARAH')).toBeTruthy());

  // The user tabs to the thread, types a message (ComposeBox persists it), then
  // comes back and adds a second recipient.
  await testDb.draftAttachments.put({
    conversationId: 'draft-SARAH',
    text: 'precious half-written message',
    files: [],
    names: [],
    types: [],
  });

  await pickRecipient(screen.getByPlaceholderText('Add another or press Tab to compose...'), 'marcus', 'Marcus Webb');

  await waitFor(async () => {
    expect(await testDb.conversations.get('draft-MARCUS+SARAH')).toBeTruthy();
  });
  const migrated = await testDb.draftAttachments.get('draft-MARCUS+SARAH');
  expect(migrated?.text).toBe('precious half-written message');
  // Old rows are gone.
  expect(await testDb.conversations.get('draft-SARAH')).toBeUndefined();
  expect(await testDb.draftAttachments.get('draft-SARAH')).toBeUndefined();
});

it('removing a recipient migrates the typed draft back to the smaller set', async () => {
  render(<NewMessageComposer />);
  const input = screen.getByPlaceholderText('Search for a person...');

  await pickRecipient(input, 'sarah', 'Sarah Chen');
  const addInput = screen.getByPlaceholderText('Add another or press Tab to compose...');
  await pickRecipient(addInput, 'marcus', 'Marcus Webb');
  await waitFor(async () => expect(await testDb.conversations.get('draft-MARCUS+SARAH')).toBeTruthy());

  await testDb.draftAttachments.put({
    conversationId: 'draft-MARCUS+SARAH',
    text: 'group draft text',
    files: [],
    names: [],
    types: [],
  });

  // Backspace on the empty input removes the last recipient chip (Marcus).
  await userEvent.type(addInput, '{Backspace}');

  await waitFor(async () => {
    expect((await testDb.draftAttachments.get('draft-SARAH'))?.text).toBe('group draft text');
  });
  // The handler re-keys the row and THEN cleans the old one up, so the wait
  // above is satisfied while the delete is still in flight — asserting it
  // straight after passed only when the machine was fast enough.
  await waitFor(async () => {
    expect(await testDb.draftAttachments.get('draft-MARCUS+SARAH')).toBeUndefined();
  });
});

it('ArrowDown on an empty result list does not brick Enter for late-arriving results', async () => {
  let resolveTypeahead!: (v: any) => void;
  mockSendBridgeMessage.mockImplementation(async (msg: any) => {
    if (msg.type === 'CHECK_AUTH') return { success: true, data: { memberUrn: 'urn:li:fsd_profile:SELF' } };
    if (msg.type === 'TYPEAHEAD_SEARCH') return new Promise((r) => { resolveTypeahead = r; });
    return { success: true };
  });

  render(<NewMessageComposer />);
  const input = screen.getByPlaceholderText('Search for a person...');

  // No local match; remote results are still pending.
  await userEvent.type(input, 'webbster');
  await waitFor(() => expect(resolveTypeahead).toBeDefined(), { timeout: 3000 });

  // User presses ArrowDown while the list is still empty.
  await userEvent.keyboard('{ArrowDown}');

  // Remote results land.
  await act(async () => {
    resolveTypeahead({
      success: true,
      data: [{ name: 'Webbster Jones', headline: '', pictureUrl: '', profileUrn: 'urn:li:fsd_profile:WEBBSTER' }],
    });
  });
  await screen.findByText('Webbster Jones');

  // Enter must select the highlighted result, not silently no-op.
  await userEvent.keyboard('{Enter}');
  await waitFor(async () => {
    expect(await testDb.conversations.get('draft-WEBBSTER')).toBeTruthy();
  });
});

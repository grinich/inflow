// @vitest-environment jsdom
/**
 * Regression: the recipient picker loaded the ENTIRE profiles and
 * conversations tables from IndexedDB on every debounced keystroke.
 *
 * doSearch ran `Promise.all([db.profiles.toArray(), db.conversations
 * .toArray()])` per 300ms typing pause — on a mature inbox that's thousands
 * of rows materialized again and again while typing one name.
 *
 * Fix: the two tables are snapshotted once and reused for a few seconds;
 * staleness of seconds is invisible while typing a recipient name.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(async () => {
  testDb = new Dexie(`Composer135_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.profiles.bulkPut([
    makeProfile({ urn: 'urn:li:fsd_profile:SARAH', fullName: 'Sarah Chen', firstName: 'Sarah', lastName: 'Chen' }),
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

it('reuses one table snapshot across successive typing pauses', async () => {
  render(<NewMessageComposer />);
  const input = screen.getByPlaceholderText('Search for a person...');

  const profilesScan = vi.spyOn(testDb.profiles, 'toArray');
  const convsScan = vi.spyOn(testDb.conversations, 'toArray');

  // Two separate typing pauses → two debounced doSearch invocations. Sync on
  // the remote typeahead call each doSearch fires, so both local searches
  // have definitely run before asserting.
  await userEvent.type(input, 'sa');
  await waitFor(() =>
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TYPEAHEAD_SEARCH', query: 'sa' })),
  );
  await userEvent.type(input, 'ra');
  await waitFor(() =>
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TYPEAHEAD_SEARCH', query: 'sara' })),
  );

  expect(profilesScan.mock.calls.length).toBeLessThanOrEqual(1);
  expect(convsScan.mock.calls.length).toBeLessThanOrEqual(1);
});

/**
 * Defaults for the settings that govern outbound messages. Each default is a
 * decision about what happens when the user has expressed no preference, so
 * each is worth pinning.
 */
import {
  getAutoSendScheduled,
  getConfirmRecipient,
  getConfirmDelete,
} from '@/lib/send-settings';

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  (globalThis as any).chrome = {
    storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async () => {} } },
  };
});

it('sends scheduled messages automatically unless told otherwise', async () => {
  // Scheduling a message and then still having to click at its time defeats
  // the point of scheduling, so only an explicit false turns this off.
  expect(await getAutoSendScheduled()).toBe(true);
  store.autoSendScheduled = false;
  expect(await getAutoSendScheduled()).toBe(false);
  store.autoSendScheduled = true;
  expect(await getAutoSendScheduled()).toBe(true);
});

it('asks for a recipient confirmation unless told otherwise', async () => {
  // Claude resolves a name to a URN out of sight, and one real prospect's name
  // returned two different people.
  expect(await getConfirmRecipient()).toBe(true);
  store.confirmRecipient = false;
  expect(await getConfirmRecipient()).toBe(false);
});

it('asks before discarding a draft unless told otherwise', async () => {
  expect(await getConfirmDelete()).toBe(true);
  store.confirmDeleteDraft = false;
  expect(await getConfirmDelete()).toBe(false);
});

it('falls back to the defaults when storage cannot be read at all', async () => {
  (globalThis as any).chrome = {
    storage: { local: { get: async () => { throw new Error('no storage'); } } },
  };
  expect(await getAutoSendScheduled()).toBe(true);
  expect(await getConfirmRecipient()).toBe(true);
  expect(await getConfirmDelete()).toBe(true);
});

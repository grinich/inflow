// @vitest-environment jsdom
// Bug (High): DebugPanel calls chrome.runtime.sendMessage directly, bypassing
// sendBridgeMessage — so in demo mode RESET_DB hits the real background/IndexedDB
// instead of the demo handler. It must route through sendBridgeMessage.
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

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));
vi.mock('@/hooks/useBackgroundMessage', () => ({ useBackgroundMessage: () => {} }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DebugPanel } from '@/components/common/DebugPanel';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_debug_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockImplementation((msg: any) => {
    if (msg?.type === 'GET_SYNC_PROGRESS') return Promise.resolve({ success: true, data: null });
    if (msg?.type === 'GET_DEBUG_LOGS') return Promise.resolve({ success: true, data: [] });
    return Promise.resolve({ success: true });
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('routes Reset DB through sendBridgeMessage (so demo mode can intercept it)', async () => {
  render(<DebugPanel open={true} onClose={() => {}} />);
  const btn = await screen.findByText(/Reset DB/i);
  fireEvent.click(btn);
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'RESET_DB' }),
  );
});

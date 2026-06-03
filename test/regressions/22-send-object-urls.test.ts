import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerSendObjectUrls,
  revokeSendObjectUrls,
  reapOrphanSendObjectUrls,
  _registeredSendUrlCount,
} from '@/lib/send-object-urls';

const revoke = vi.fn();

beforeEach(() => {
  // jsdom/node don't implement revokeObjectURL — stub it.
  (globalThis as any).URL.revokeObjectURL = revoke;
  // Clear any leftover registry state from a previous test, THEN reset the spy so
  // each test starts with a clean call count.
  reapOrphanSendObjectUrls(new Set());
  revoke.mockReset();
});

describe('send-object-urls registry', () => {
  it('registers and revokes a temp id\'s URLs explicitly', () => {
    registerSendObjectUrls('temp-1', ['blob:a', 'blob:b']);
    expect(_registeredSendUrlCount()).toBe(1);
    revokeSendObjectUrls('temp-1');
    expect(revoke).toHaveBeenCalledWith('blob:a');
    expect(revoke).toHaveBeenCalledWith('blob:b');
    expect(_registeredSendUrlCount()).toBe(0);
  });

  it('is a no-op for an empty URL list', () => {
    registerSendObjectUrls('temp-1', []);
    expect(_registeredSendUrlCount()).toBe(0);
  });

  it('revoking an unregistered id does nothing', () => {
    revokeSendObjectUrls('temp-missing');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('reaps only temp ids that have left the live set (the offline-queue leak fix)', () => {
    registerSendObjectUrls('temp-live', ['blob:keep']);
    registerSendObjectUrls('temp-gone', ['blob:drop1', 'blob:drop2']);

    reapOrphanSendObjectUrls(new Set(['temp-live']));

    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:drop1');
    expect(revoke).toHaveBeenCalledWith('blob:drop2');
    expect(revoke).not.toHaveBeenCalledWith('blob:keep');
    expect(_registeredSendUrlCount()).toBe(1); // temp-live still held
  });

  it('keeps URLs alive while their temp message is still present', () => {
    registerSendObjectUrls('temp-1', ['blob:a']);
    reapOrphanSendObjectUrls(new Set(['temp-1']));
    expect(revoke).not.toHaveBeenCalled();
    expect(_registeredSendUrlCount()).toBe(1);
  });
});

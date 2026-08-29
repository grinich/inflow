// @vitest-environment jsdom
/**
 * Adversarial coverage for the shell → app-frame message listener. The origin
 * gate is covered by shell-messages.dom.test.ts; this file attacks payload
 * typing (the handler must only ever see a non-empty string) and the
 * subscription lifecycle (multiple subscribers, repeated unsubscribes).
 */
import { onShellOpenConversation } from '@/lib/shell-messages';

const SHELL = 'https://inflow.im';

function post(origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

describe('payload typing', () => {
  it('rejects every non-string conversationId', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 42 });
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: { toString: () => 'c1' } });
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: ['c1'] });
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: true });
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: null });
    // A String OBJECT is typeof 'object' — also rejected. The handler feeds
    // IndexedDB keys and store state; only primitive strings may pass.
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: new String('c1') });

    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('ignores primitive and undefined event data', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post(SHELL, undefined);
    post(SHELL, 'OPEN_CONVERSATION');
    post(SHELL, 0);

    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('tolerates extra unknown fields on a well-formed message (forward compat)', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c1', futureField: { x: 1 } });

    expect(handler).toHaveBeenCalledWith('c1');
    off();
  });
});

describe('subscription lifecycle', () => {
  it('delivers to every subscriber independently', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onShellOpenConversation(first);
    const offSecond = onShellOpenConversation(second);

    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c1' });
    expect(first).toHaveBeenCalledWith('c1');
    expect(second).toHaveBeenCalledWith('c1');

    offFirst();
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c2' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    offSecond();
    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c3' });
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('unsubscribing twice is harmless and does not detach other subscribers', () => {
    const survivor = vi.fn();
    const gone = vi.fn();
    const offSurvivor = onShellOpenConversation(survivor);
    const offGone = onShellOpenConversation(gone);

    offGone();
    expect(() => offGone()).not.toThrow();

    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c1' });
    expect(gone).not.toHaveBeenCalled();
    expect(survivor).toHaveBeenCalledWith('c1');
    offSurvivor();
  });

  it('subscribing the same handler twice delivers twice (each subscription is its own listener)', () => {
    const handler = vi.fn();
    const off1 = onShellOpenConversation(handler);
    const off2 = onShellOpenConversation(handler);

    post(SHELL, { type: 'OPEN_CONVERSATION', conversationId: 'c1' });
    expect(handler).toHaveBeenCalledTimes(2);

    off1();
    off2();
  });
});

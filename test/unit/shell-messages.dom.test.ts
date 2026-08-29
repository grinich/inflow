// @vitest-environment jsdom
/**
 * The inflow.im/app shell posts OPEN_CONVERSATION into the app frame when
 * one of its notifications is clicked. The origin check is the security
 * boundary: only the shell's origin may drive navigation.
 */
import { onShellOpenConversation } from '@/lib/shell-messages';

function post(origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

describe('onShellOpenConversation', () => {
  it('invokes the handler for a well-formed message from the shell origin', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post('https://inflow.im', { type: 'OPEN_CONVERSATION', conversationId: 'conv-1' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('conv-1');
    off();
  });

  it('ignores every other origin', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post('https://evil.example', { type: 'OPEN_CONVERSATION', conversationId: 'conv-1' });
    post('https://inflow.im.evil.example', { type: 'OPEN_CONVERSATION', conversationId: 'conv-1' });

    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('ignores malformed payloads', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);

    post('https://inflow.im', { type: 'OPEN_CONVERSATION' });
    post('https://inflow.im', { type: 'OPEN_CONVERSATION', conversationId: '' });
    post('https://inflow.im', { type: 'SOMETHING_ELSE', conversationId: 'conv-1' });
    post('https://inflow.im', null);

    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('stops after unsubscribe', () => {
    const handler = vi.fn();
    const off = onShellOpenConversation(handler);
    off();

    post('https://inflow.im', { type: 'OPEN_CONVERSATION', conversationId: 'conv-1' });

    expect(handler).not.toHaveBeenCalled();
  });
});

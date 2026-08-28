/**
 * The web shell at inflow.im probes for the installed extension with a PING
 * over externally_connectable messaging. That surface must stay tiny: only
 * PING is answered, only for https://inflow.im, and only synchronously — the
 * internal RPC bridge (messages.ts) must never be reachable from a web page.
 */
import { setupExternalMessageRouter } from '../../entrypoints/background/external-messages';

type ExternalListener = (
  message: any,
  sender: { origin?: string },
  sendResponse: (response?: any) => void
) => boolean | undefined | void;

function installedListener(): ExternalListener {
  setupExternalMessageRouter();
  const calls = vi.mocked(chrome.runtime.onMessageExternal.addListener).mock.calls;
  expect(calls.length).toBe(1);
  return calls[0][0] as ExternalListener;
}

describe('setupExternalMessageRouter', () => {
  it('registers on onMessageExternal only — never on the internal onMessage', () => {
    setupExternalMessageRouter();
    expect(chrome.runtime.onMessageExternal.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('answers PING from inflow.im with the extension id and version', () => {
    const listener = installedListener();
    const sendResponse = vi.fn();

    listener({ type: 'PING' }, { origin: 'https://inflow.im' }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      id: 'test-extension-id',
      version: '0.4.0',
    });
  });

  it('ignores messages from any other origin', () => {
    const listener = installedListener();
    const sendResponse = vi.fn();

    listener({ type: 'PING' }, { origin: 'https://evil.example' }, sendResponse);
    listener({ type: 'PING' }, { origin: 'https://inflow.im.evil.example' }, sendResponse);
    listener({ type: 'PING' }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('answers nothing but PING — the internal bridge is not exposed', () => {
    const listener = installedListener();
    const sendResponse = vi.fn();

    listener({ type: 'CHECK_AUTH' }, { origin: 'https://inflow.im' }, sendResponse);
    listener({ type: 'SEND_MESSAGE' }, { origin: 'https://inflow.im' }, sendResponse);
    listener(null, { origin: 'https://inflow.im' }, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('never holds the channel open (returns falsy)', () => {
    const listener = installedListener();
    const result = listener({ type: 'PING' }, { origin: 'https://inflow.im' }, vi.fn());
    expect(result).toBeFalsy();
  });
});

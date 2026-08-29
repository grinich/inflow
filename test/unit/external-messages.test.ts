/**
 * The web shell at inflow.im probes for the installed extension with a PING
 * over externally_connectable messaging. That surface must stay tiny: only
 * PING is answered, only for https://inflow.im, and only synchronously — the
 * internal RPC bridge (messages.ts) must never be reachable from a web page.
 */
import {
  setupExternalMessageRouter,
  setupExternalPortRouter,
  broadcastUnreadCount,
  notifyViaShell,
} from '../../entrypoints/background/external-messages';

vi.mock('@/lib/inbox-filters', () => ({ countUnreadFocused: vi.fn().mockResolvedValue(3) }));
vi.mock('@/db/database', () => ({ db: {} }));

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

function makePort(origin: string | undefined, name = 'unread-count') {
  const disconnectListeners: Array<() => void> = [];
  const messageListeners: Array<(msg: any) => void> = [];
  return {
    name,
    sender: origin ? { origin } : {},
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: {
      addListener: vi.fn((fn: () => void) => disconnectListeners.push(fn)),
    },
    onMessage: {
      addListener: vi.fn((fn: (msg: any) => void) => messageListeners.push(fn)),
    },
    fireDisconnect: () => disconnectListeners.forEach((fn) => fn()),
    fireMessage: (msg: any) => messageListeners.forEach((fn) => fn(msg)),
  };
}

function installedConnectListener(): (port: any) => void {
  setupExternalPortRouter();
  const calls = vi.mocked(chrome.runtime.onConnectExternal.addListener).mock.calls;
  expect(calls.length).toBe(1);
  return calls[0][0] as (port: any) => void;
}

describe('setupExternalPortRouter (unread-count port for the web shell)', () => {
  it('accepts the unread-count port from inflow.im and pushes the current count', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');

    onConnect(port);
    await new Promise((r) => setTimeout(r, 0));

    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'UNREAD_COUNT', count: 3 });
  });

  it('disconnects ports from any other origin', () => {
    const onConnect = installedConnectListener();
    const evil = makePort('https://evil.example');
    const noOrigin = makePort(undefined);

    onConnect(evil);
    onConnect(noOrigin);

    expect(evil.disconnect).toHaveBeenCalled();
    expect(noOrigin.disconnect).toHaveBeenCalled();
    broadcastUnreadCount(7);
    expect(evil.postMessage).not.toHaveBeenCalled();
    expect(noOrigin.postMessage).not.toHaveBeenCalled();
  });

  it('disconnects ports with any other name', () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im', 'some-other-port');

    onConnect(port);

    expect(port.disconnect).toHaveBeenCalled();
    broadcastUnreadCount(7);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('broadcasts count updates to connected ports, and stops after disconnect', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await new Promise((r) => setTimeout(r, 0));
    port.postMessage.mockClear();

    broadcastUnreadCount(5);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'UNREAD_COUNT', count: 5 });

    port.fireDisconnect();
    port.postMessage.mockClear();
    broadcastUnreadCount(9);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('routes notifications only to shells that reported Notification permission', async () => {
    const onConnect = installedConnectListener();
    const granted = makePort('https://inflow.im');
    const silent = makePort('https://inflow.im');
    onConnect(granted);
    onConnect(silent);
    await new Promise((r) => setTimeout(r, 0));
    granted.postMessage.mockClear();
    silent.postMessage.mockClear();

    // No shell has permission yet → the caller must fall back.
    expect(notifyViaShell({ conversationId: 'c1', title: 'T', body: 'B', icon: '' })).toBe(false);

    granted.fireMessage({ type: 'HELLO', canNotify: true });
    silent.fireMessage({ type: 'HELLO', canNotify: false });

    expect(notifyViaShell({ conversationId: 'c1', title: 'T', body: 'B', icon: 'i' })).toBe(true);
    expect(granted.postMessage).toHaveBeenCalledWith({
      type: 'SHOW_NOTIFICATION',
      conversationId: 'c1',
      title: 'T',
      body: 'B',
      icon: 'i',
    });
    expect(silent.postMessage).not.toHaveBeenCalled();

    // Permission can be revoked mid-session (CAN_NOTIFY), and disconnects drop it.
    granted.fireMessage({ type: 'CAN_NOTIFY', canNotify: false });
    expect(notifyViaShell({ conversationId: 'c2', title: 'T', body: 'B', icon: '' })).toBe(false);

    granted.fireDisconnect();
    silent.fireDisconnect();
  });

  it('drops a port whose postMessage throws instead of crashing the broadcast', async () => {
    const onConnect = installedConnectListener();
    const dead = makePort('https://inflow.im');
    const alive = makePort('https://inflow.im');
    onConnect(dead);
    onConnect(alive);
    await new Promise((r) => setTimeout(r, 0));
    dead.postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object');
    });
    alive.postMessage.mockClear();

    expect(() => broadcastUnreadCount(2)).not.toThrow();
    expect(alive.postMessage).toHaveBeenCalledWith({ type: 'UNREAD_COUNT', count: 2 });
  });
});

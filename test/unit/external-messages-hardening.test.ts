/**
 * Adversarial coverage for the external messaging surface (web shell ⇄
 * extension). The port registry is module-level state shared by every
 * connected shell, so these tests attack its lifecycle edges: messages after
 * disconnect, malformed permission payloads, hostile origins, and ports that
 * die mid-broadcast. Every test that connects a port disconnects it before
 * finishing — the registry outlives individual tests within this file.
 */
import {
  setupExternalMessageRouter,
  setupExternalPortRouter,
  broadcastUnreadCount,
  notifyViaShell,
} from '../../entrypoints/background/external-messages';
import { countUnreadFocused } from '@/lib/inbox-filters';

vi.mock('@/lib/inbox-filters', () => ({ countUnreadFocused: vi.fn() }));
vi.mock('@/db/database', () => ({ db: {} }));

beforeEach(() => {
  vi.mocked(countUnreadFocused).mockResolvedValue(3);
});

const NOTIFICATION = { conversationId: 'c1', title: 'T', body: 'B', icon: 'i' };

type ExternalListener = (
  message: any,
  sender: { origin?: string },
  sendResponse: (response?: any) => void
) => boolean | undefined | void;

function installedMessageListener(): ExternalListener {
  setupExternalMessageRouter();
  const calls = vi.mocked(chrome.runtime.onMessageExternal.addListener).mock.calls;
  return calls[calls.length - 1][0] as ExternalListener;
}

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
  return calls[calls.length - 1][0] as (port: any) => void;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('port registry lifecycle attacks', () => {
  it('a HELLO arriving after disconnect cannot resurrect the port', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();

    port.fireMessage({ type: 'HELLO', canNotify: true });
    expect(notifyViaShell(NOTIFICATION)).toBe(true);

    port.fireDisconnect();
    port.postMessage.mockClear();

    // A message delivered after the disconnect (queued dispatch, or a buggy
    // shell) must not re-register the port or re-grant permission.
    port.fireMessage({ type: 'HELLO', canNotify: true });
    expect(notifyViaShell(NOTIFICATION)).toBe(false);
    broadcastUnreadCount(9);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('a HELLO after being pruned for a failed post cannot resurrect the port either', async () => {
    // Same guarantee as the disconnect path, via the OTHER deletion route:
    // postToShell deletes a port whose postMessage throws (died without
    // firing onDisconnect). Its still-attached message listener must find
    // no registry entry afterwards.
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();
    port.fireMessage({ type: 'HELLO', canNotify: true });

    port.postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object');
    });
    expect(notifyViaShell(NOTIFICATION)).toBe(false); // pruned here

    port.postMessage.mockReset(); // port "works" again — must not matter
    port.fireMessage({ type: 'HELLO', canNotify: true });
    expect(notifyViaShell(NOTIFICATION)).toBe(false);
    broadcastUnreadCount(9);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('firing disconnect twice is harmless', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();

    port.fireDisconnect();
    expect(() => port.fireDisconnect()).not.toThrow();
    expect(notifyViaShell(NOTIFICATION)).toBe(false);
  });

  it('many connects and disconnects leave no ghost subscribers', async () => {
    const onConnect = installedConnectListener();
    const ports = Array.from({ length: 30 }, () => makePort('https://inflow.im'));
    for (const port of ports) onConnect(port);
    await flush();
    for (const port of ports) port.fireMessage({ type: 'HELLO', canNotify: true });
    expect(notifyViaShell(NOTIFICATION)).toBe(true);

    for (const port of ports) {
      port.fireDisconnect();
      port.postMessage.mockClear();
    }

    expect(notifyViaShell(NOTIFICATION)).toBe(false);
    broadcastUnreadCount(1);
    for (const port of ports) expect(port.postMessage).not.toHaveBeenCalled();
  });
});

describe('malformed permission payloads', () => {
  it('only a literal boolean true grants notification permission', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();

    // Truthy-but-not-true values must all read as "no permission".
    for (const canNotify of ['yes', 'true', 1, {}, [], () => true, undefined, null]) {
      port.fireMessage({ type: 'HELLO', canNotify });
      expect(notifyViaShell(NOTIFICATION)).toBe(false);
      port.fireMessage({ type: 'CAN_NOTIFY', canNotify });
      expect(notifyViaShell(NOTIFICATION)).toBe(false);
    }

    // The real grant still works after the garbage.
    port.fireMessage({ type: 'CAN_NOTIFY', canNotify: true });
    expect(notifyViaShell(NOTIFICATION)).toBe(true);

    // A later HELLO with a missing field revokes — permission is always
    // re-derived from the latest message, never sticky.
    port.fireMessage({ type: 'HELLO' });
    expect(notifyViaShell(NOTIFICATION)).toBe(false);

    port.fireDisconnect();
  });

  it('unknown message types leave the permission state untouched', async () => {
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();

    port.fireMessage({ type: 'HELLO', canNotify: true });
    port.fireMessage({ type: 'GOODBYE', canNotify: false });
    port.fireMessage(null);
    port.fireMessage('HELLO');
    port.fireMessage(42);

    expect(notifyViaShell(NOTIFICATION)).toBe(true);
    port.fireDisconnect();
  });
});

describe('hostile origins fail closed', () => {
  // chrome always serializes sender.origin lowercase with no trailing slash;
  // any other spelling is not the shell and must be rejected.
  const impostors = [
    'https://inflow.im/', // trailing slash
    'HTTPS://INFLOW.IM', // uppercase
    'https://inflow.im.', // trailing-dot host (a distinct origin)
    'https://inflow.im:8443', // explicit non-default port
    'http://inflow.im', // wrong scheme
    'https://xn--inflow-9db.im', // IDN homograph, punycode-serialized
    'null', // sandboxed frame
  ];

  it('PING answers none of the near-miss origins', () => {
    const listener = installedMessageListener();
    const sendResponse = vi.fn();
    for (const origin of impostors) {
      listener({ type: 'PING' }, { origin }, sendResponse);
    }
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('ports from near-miss origins are disconnected without ever being listened to', () => {
    const onConnect = installedConnectListener();
    for (const origin of impostors) {
      const port = makePort(origin);
      onConnect(port);
      expect(port.disconnect).toHaveBeenCalled();
      // No listeners were attached: a rejected page cannot even attempt HELLO.
      expect(port.onMessage.addListener).not.toHaveBeenCalled();
      expect(port.onDisconnect.addListener).not.toHaveBeenCalled();
      port.fireMessage({ type: 'HELLO', canNotify: true });
      expect(notifyViaShell(NOTIFICATION)).toBe(false);
    }
  });
});

describe('sendResponse that throws', () => {
  it('propagates to the dispatcher without corrupting the router', () => {
    // Chrome catches exceptions thrown by runtime listeners, so a throwing
    // sendResponse (channel torn down mid-dispatch) is survivable — this pins
    // that the listener holds no state that a throw could corrupt.
    const listener = installedMessageListener();
    const throwing = vi.fn(() => {
      throw new Error('The message port closed before a response was received.');
    });
    expect(() =>
      listener({ type: 'PING' }, { origin: 'https://inflow.im' }, throwing)
    ).toThrow();

    const sendResponse = vi.fn();
    listener({ type: 'PING' }, { origin: 'https://inflow.im' }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      id: 'test-extension-id',
      version: '0.4.0',
    });
  });
});

describe('notifyViaShell with a dying port', () => {
  it('still delivers to the healthy shell and reports true when the first port throws', async () => {
    const onConnect = installedConnectListener();
    // Insertion order matters: the dying port is iterated first.
    const dying = makePort('https://inflow.im');
    const healthy = makePort('https://inflow.im');
    onConnect(dying);
    onConnect(healthy);
    await flush(); // let the initial UNREAD_COUNT pushes land while both are alive

    dying.fireMessage({ type: 'HELLO', canNotify: true });
    healthy.fireMessage({ type: 'HELLO', canNotify: true });

    dying.postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object');
    });
    healthy.postMessage.mockClear();

    expect(notifyViaShell(NOTIFICATION)).toBe(true);
    expect(healthy.postMessage).toHaveBeenCalledWith({
      type: 'SHOW_NOTIFICATION',
      ...NOTIFICATION,
    });

    // The dead port was pruned during the failed post: it is not retried.
    dying.postMessage.mockClear();
    healthy.postMessage.mockClear();
    expect(notifyViaShell(NOTIFICATION)).toBe(true);
    expect(dying.postMessage).not.toHaveBeenCalled();
    expect(healthy.postMessage).toHaveBeenCalledTimes(1);

    healthy.fireDisconnect();
  });

  it('returns false when every permitted port throws', async () => {
    const onConnect = installedConnectListener();
    const a = makePort('https://inflow.im');
    const b = makePort('https://inflow.im');
    onConnect(a);
    onConnect(b);
    await flush();
    a.fireMessage({ type: 'HELLO', canNotify: true });
    b.fireMessage({ type: 'HELLO', canNotify: true });
    a.postMessage.mockImplementation(() => { throw new Error('dead'); });
    b.postMessage.mockImplementation(() => { throw new Error('dead'); });

    // Both dead → the caller must fall back to chrome.notifications.
    expect(notifyViaShell(NOTIFICATION)).toBe(false);
  });
});

describe('initial unread-count push failure', () => {
  it('keeps the port registered when the first DB read rejects', async () => {
    vi.mocked(countUnreadFocused).mockRejectedValueOnce(new Error('DB not open yet'));
    const onConnect = installedConnectListener();
    const port = makePort('https://inflow.im');
    onConnect(port);
    await flush();

    expect(port.postMessage).not.toHaveBeenCalled(); // initial push failed quietly

    // The next broadcast catches the shell up — the port must still be live.
    broadcastUnreadCount(6);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'UNREAD_COUNT', count: 6 });

    port.fireDisconnect();
  });
});

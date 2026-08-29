// @vitest-environment jsdom
/**
 * Regression 139 — a clicked notification never reached the installed app,
 * and the notification wore Chrome's identity rather than inƒlow's.
 *
 * site/app.html showed its notifications with a page-level `new Notification`
 * and handled the click with `window.focus()`. Three consequences on macOS:
 *
 *  - A page notification is attributed to the BROWSER. The app icon on the
 *    notification stayed Chrome's, which is the whole thing routing alerts
 *    through the shell was meant to fix.
 *  - `window.focus()` from a page is ignored while the window is in the
 *    background — precisely the state a notification is clicked from — so the
 *    installed app never came forward.
 *  - The notification died with its page, so a click after the app window was
 *    closed did nothing at all.
 *
 * The fix moves both halves into the service worker: it shows the
 * notification (registration.showNotification) and handles the click, where
 * `client.focus()` may raise a window and `clients.openWindow()` may launch
 * one. These tests execute the real shipped files — site/app.html's script
 * and site/app-sw.js — not copies of their logic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
const APP_HTML = readFileSync(join(SITE, 'app.html'), 'utf8');
const APP_SW = readFileSync(join(SITE, 'app-sw.js'), 'utf8');

const BODY = /<body>([\s\S]*?)<script>/.exec(APP_HTML)![1];
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)![1];

const EXT_ID = 'ndehgbgifkapdigmefglpgacpagoclge';

// ---------------------------------------------------------------------------
// The shell page
// ---------------------------------------------------------------------------

interface ShellHarness {
  /** Push a SHOW_NOTIFICATION down the extension port, as the background does. */
  notify: (msg: Record<string, unknown>) => Promise<void>;
  /** Deliver a worker message (a click the worker relayed to this window). */
  fromWorker: (data: unknown) => Promise<void>;
  swNotifications: Array<{ title: string; options: any }>;
  pageNotifications: Array<{ title: string; options: any }>;
  frameSrc: () => string | null;
}

/** Boot the shell in jsdom with the extension "installed" and a live worker. */
async function bootShell(
  opts: { search?: string; activeWorker?: boolean; embed?: boolean } = {}
): Promise<ShellHarness> {
  const swNotifications: Array<{ title: string; options: any }> = [];
  const pageNotifications: Array<{ title: string; options: any }> = [];
  let portListener: ((msg: unknown) => void) | null = null;
  let workerListener: ((event: { data: unknown }) => void) | null = null;

  window.history.replaceState(null, '', '/app' + (opts.search ?? ''));
  document.body.innerHTML = BODY;

  const NotificationStub = function (this: any, title: string, options: any) {
    pageNotifications.push({ title, options });
  } as unknown as typeof Notification;
  Object.defineProperty(NotificationStub, 'permission', { get: () => 'granted' });
  (NotificationStub as any).requestPermission = () => Promise.resolve('granted');
  vi.stubGlobal('Notification', NotificationStub);

  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });

  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('display-mode'),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));

  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) =>
        setTimeout(() => cb(opts.embed === false ? undefined : { ok: true, id: EXT_ID }), 0),
      connect: () => ({
        postMessage() {},
        disconnect() {},
        onMessage: { addListener: (fn: (msg: unknown) => void) => { portListener = fn; } },
        onDisconnect: { addListener() {} },
      }),
    },
  });

  // Not under test: the frame-reattach watcher, whose callbacks would
  // otherwise keep firing against a torn-down document between cases.
  vi.stubGlobal('MutationObserver', class {
    observe() {} disconnect() {} takeRecords() { return []; }
  });

  (navigator as any).setAppBadge = () => Promise.resolve();
  (navigator as any).clearAppBadge = () => Promise.resolve();
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.reject(new Error('n/a')) },
  });

  const registration = {
    showNotification: (title: string, options: any) => {
      swNotifications.push({ title, options });
      return Promise.resolve();
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: () => Promise.resolve(registration),
      // A worker that never activates (opts.activeWorker === false) is the
      // fallback case: `ready` simply never resolves.
      ready: opts.activeWorker === false ? new Promise(() => {}) : Promise.resolve(registration),
      addEventListener: (type: string, fn: (event: { data: unknown }) => void) => {
        if (type === 'message') workerListener = fn;
      },
    },
  });

  // eslint-disable-next-line no-new-func — running the shipped shell verbatim.
  new Function(SCRIPT)();
  // Let the probe's setTimeout(0), its promise chain, and serviceWorker.ready
  // settle so embed() has run and the registration is captured.
  await new Promise((r) => setTimeout(r, 5));

  return {
    notify: async (msg) => {
      portListener?.({ type: 'SHOW_NOTIFICATION', ...msg });
      await new Promise((r) => setTimeout(r, 0));
    },
    fromWorker: async (data) => {
      workerListener?.({ data });
      await new Promise((r) => setTimeout(r, 0));
    },
    swNotifications,
    pageNotifications,
    frameSrc: () => document.querySelector('iframe#app')?.getAttribute('src') ?? null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('regression 139 — the shell shows notifications from its worker', () => {
  it('shows them through the service worker, not the page', async () => {
    const shell = await bootShell();
    await shell.notify({ conversationId: 'conv-1', title: 'Ada', body: 'Hello', icon: 'https://cdn/a.jpg' });

    expect(shell.swNotifications).toHaveLength(1);
    const { title, options } = shell.swNotifications[0];
    expect(title).toBe('Ada');
    expect(options.body).toBe('Hello');
    expect(options.icon).toBe('https://cdn/a.jpg');
    expect(options.tag).toBe('conv-1'); // replaces per-conversation

    // A page notification is attributed to Chrome and its click can't raise
    // the app — showing one when the worker is available is the bug.
    expect(shell.pageNotifications).toHaveLength(0);
  });

  it('carries the conversation in data, which is all the click handler gets', async () => {
    const shell = await bootShell();
    await shell.notify({ conversationId: 'conv-7', title: 'Ada', body: 'Hi', icon: '' });

    expect(shell.swNotifications[0].options.data).toEqual({ conversationId: 'conv-7' });
    // A blank sender avatar falls back to the app icon rather than no icon.
    expect(shell.swNotifications[0].options.icon).toBe('/icons/app-icon-192.png');
  });

  it('falls back to a page notification only when no worker is active', async () => {
    const shell = await bootShell({ activeWorker: false });
    await shell.notify({ conversationId: 'conv-1', title: 'Ada', body: 'Hi', icon: '' });

    expect(shell.swNotifications).toHaveLength(0);
    expect(shell.pageNotifications).toHaveLength(1);
    expect(shell.pageNotifications[0].title).toBe('Ada');
  });
});

describe('regression 139 — the shell routes a clicked notification into the app', () => {
  it('forwards ?c= from a launch into the app frame', async () => {
    const shell = await bootShell({ search: '?c=conv-9' });

    expect(shell.frameSrc()).toBe(`chrome-extension://${EXT_ID}/app.html?c=conv-9`);
    // One-shot: a manual reload must not re-navigate to the conversation.
    expect(window.location.search).toBe('');
  });

  it('hands a click that beat the extension probe to the frame as a launch param', async () => {
    // The worker relays the click the moment it focuses the window, which can
    // be before the probe has embedded anything to postMessage into.
    const shell = await bootShell({ embed: false });
    await shell.fromWorker({ type: 'OPEN_CONVERSATION', conversationId: 'conv-3' });
    expect(shell.frameSrc()).toBeNull();

    // The probe eventually finds the extension (the shell retries on focus).
    (chrome.runtime.sendMessage as any) = (_id: string, _msg: unknown, cb: (r: unknown) => void) =>
      setTimeout(() => cb({ ok: true, id: EXT_ID }), 0);
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 5));

    expect(shell.frameSrc()).toBe(`chrome-extension://${EXT_ID}/app.html?c=conv-3`);
  });

  it('posts into the live frame, targeted at the extension origin', async () => {
    const shell = await bootShell();
    const frame = document.querySelector('iframe#app') as HTMLIFrameElement;
    const posted: Array<[unknown, string]> = [];
    Object.defineProperty(frame.contentWindow, 'postMessage', {
      configurable: true,
      value: (message: unknown, targetOrigin: string) => posted.push([message, targetOrigin]),
    });

    await shell.fromWorker({ type: 'OPEN_CONVERSATION', conversationId: 'conv-4' });

    expect(posted).toEqual([
      [{ type: 'OPEN_CONVERSATION', conversationId: 'conv-4' }, `chrome-extension://${EXT_ID}`],
    ]);
  });

  it('ignores malformed worker messages', async () => {
    const shell = await bootShell();
    const frame = document.querySelector('iframe#app') as HTMLIFrameElement;
    const posted: unknown[] = [];
    Object.defineProperty(frame.contentWindow, 'postMessage', {
      configurable: true,
      value: (message: unknown) => posted.push(message),
    });

    await shell.fromWorker(null);
    await shell.fromWorker({ type: 'OPEN_CONVERSATION' });
    await shell.fromWorker({ type: 'SOMETHING_ELSE', conversationId: 'conv-5' });
    await shell.fromWorker({ type: 'OPEN_CONVERSATION', conversationId: 42 });

    expect(posted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The service worker
// ---------------------------------------------------------------------------

interface WorkerHarness {
  click: (data: unknown) => Promise<void>;
  closed: () => number;
  openWindow: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
}

function loadWorker(clients: Array<{ url: string; focus?: () => Promise<void> }>): {
  worker: WorkerHarness;
  focused: string[];
  posted: Array<{ url: string; message: any }>;
} {
  const listeners: Record<string, (event: any) => void> = {};
  const focused: string[] = [];
  const posted: Array<{ url: string; message: any }> = [];
  const openWindow = vi.fn().mockResolvedValue(null);
  const matchAll = vi.fn();
  let closes = 0;

  const windowClients = clients.map((client) => ({
    url: client.url,
    focus: client.focus ?? (() => { focused.push(client.url); return Promise.resolve(); }),
    postMessage: (message: unknown) => posted.push({ url: client.url, message }),
  }));

  const workerSelf: any = {
    addEventListener: (type: string, fn: (event: any) => void) => { listeners[type] = fn; },
    clients: { matchAll: matchAll.mockResolvedValue(windowClients), openWindow },
    location: { origin: 'https://inflow.im' },
    skipWaiting: () => Promise.resolve(),
  };

  // eslint-disable-next-line no-new-func — running the shipped worker verbatim.
  new Function('self', APP_SW)(workerSelf);
  expect(listeners.notificationclick, 'the worker must handle clicks').toBeTypeOf('function');

  return {
    worker: {
      click: async (data) => {
        let held: Promise<unknown> = Promise.resolve();
        listeners.notificationclick({
          notification: { data, close: () => { closes += 1; } },
          waitUntil: (p: Promise<unknown>) => { held = p; },
        });
        await held;
      },
      closed: () => closes,
      openWindow,
      matchAll,
    },
    focused,
    posted,
  };
}

describe('regression 139 — the worker raises the app on a notification click', () => {
  it('focuses an open shell and hands it the conversation', async () => {
    const { worker, focused, posted } = loadWorker([{ url: 'https://inflow.im/app' }]);

    await worker.click({ conversationId: 'conv-1' });

    // focus() is the part a page notification could never do.
    expect(focused).toEqual(['https://inflow.im/app']);
    expect(posted).toEqual([
      { url: 'https://inflow.im/app', message: { type: 'OPEN_CONVERSATION', conversationId: 'conv-1' } },
    ]);
    expect(worker.openWindow).not.toHaveBeenCalled();
    expect(worker.closed()).toBe(1); // the notification is dismissed, not left behind
  });

  it('opens the app at the conversation when nothing is open to focus', async () => {
    const { worker, posted } = loadWorker([]);

    await worker.click({ conversationId: '2-abc==' });

    expect(worker.openWindow).toHaveBeenCalledWith('/app?c=2-abc%3D%3D');
    expect(posted).toEqual([]);
  });

  it('opens the plain app when the notification carries no conversation', async () => {
    const withData = loadWorker([]);
    await withData.worker.click({});
    expect(withData.worker.openWindow).toHaveBeenCalledWith('/app');

    const withoutData = loadWorker([]);
    await withoutData.worker.click(undefined);
    expect(withoutData.worker.openWindow).toHaveBeenCalledWith('/app');
  });

  it('only ever focuses the shell — never a marketing tab or a bad URL', async () => {
    const { worker, focused, posted } = loadWorker([
      { url: 'not a url' },
      { url: 'https://inflow.im/home' },
      { url: 'https://inflow.im/app?demo' },
    ]);

    await worker.click({ conversationId: 'conv-2' });

    expect(focused).toEqual(['https://inflow.im/app?demo']);
    expect(posted.map((p) => p.url)).toEqual(['https://inflow.im/app?demo']);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it('still delivers the conversation when focus() is refused', async () => {
    // Chrome rejects focus() if the click's user activation is already spent.
    // Losing the raise is survivable; losing the navigation as well is not.
    const { worker, posted } = loadWorker([
      { url: 'https://inflow.im/app', focus: () => Promise.reject(new Error('not allowed')) },
    ]);

    await worker.click({ conversationId: 'conv-6' });

    expect(posted).toEqual([
      { url: 'https://inflow.im/app', message: { type: 'OPEN_CONVERSATION', conversationId: 'conv-6' } },
    ]);
  });

  it('looks at uncontrolled windows too — a shell open since before this worker', async () => {
    // A window loaded before this worker activated is still a perfectly good
    // one to raise; matching only controlled clients would open a duplicate.
    const { worker } = loadWorker([{ url: 'https://inflow.im/app' }]);
    await worker.click({ conversationId: 'conv-1' });

    expect(worker.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });
});

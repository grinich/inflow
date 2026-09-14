// @vitest-environment jsdom
// The nav-state-in-the-URL work (#144) only held when the app was opened
// directly as chrome-extension://<id>/app.html. Through the inflow.im/app
// shell the app is a cross-origin iframe: the hash it writes is on a URL the
// user never sees, the address bar shows only /app, and reloading rebuilds the
// frame from `frameSrc()` — which carried the query string but no fragment.
// So ⌘R on inflow.im/app still landed on Focused.
//
// The app now posts its route up, the shell mirrors it into its own URL, and
// the next load hands it back through the frame's src.
import '../dom-setup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { publishRouteToShell, SHELL_ORIGINS } from '@/lib/shell-messages';

describe('regression #145: the shell mirrors the app route', () => {
  const posted: Array<{ message: any; targetOrigin: string }> = [];
  let originalParent: Window;

  beforeEach(() => {
    posted.length = 0;
    originalParent = window.parent;
    // Stand in for the shell: a parent that is not this window.
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: {
        postMessage: (message: any, targetOrigin: string) => {
          posted.push({ message, targetOrigin });
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', { configurable: true, value: originalParent });
  });

  it('posts the route to the shell origin', () => {
    publishRouteToShell('#/inbox/archived');

    expect(posted.length).toBeGreaterThan(0);
    expect(posted[0].message).toEqual({ type: 'ROUTE_CHANGED', hash: '#/inbox/archived' });
    expect(posted.map((p) => p.targetOrigin)).toContain('https://inflow.im');
  });

  it('never posts to a wildcard origin', () => {
    // '*' would hand the route to any page that managed to frame the app.
    publishRouteToShell('#/inbox/other?unread');

    expect(posted.map((p) => p.targetOrigin)).not.toContain('*');
    for (const { targetOrigin } of posted) {
      expect(SHELL_ORIGINS).toContain(targetOrigin);
    }
  });

  it('stays silent when the app is not framed', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window });

    publishRouteToShell('#/inbox/spam');

    // Opened directly, the app already owns its address bar.
    expect(posted).toHaveLength(0);
  });
});

// Run the shipped shell in its own window: closing it releases the listeners,
// observers, and retry timers that otherwise leak between boot scenarios.
describe('regression #145: the shell half', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'site', 'app.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  const extensionId = 'ndehgbgifkapdigmefglpgacpagoclge';
  const extensionOrigin = `chrome-extension://${extensionId}`;
  let shell: JSDOM;

  async function boot(hash = '') {
    shell = new JSDOM(html, {
      url: `https://inflow.im/app?ext=${extensionId}${hash}`,
      runScripts: 'outside-only',
    });
    const win = shell.window;
    win.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    win.chrome = {
      runtime: {
        sendMessage: (_id: string, _message: unknown, callback: (reply: unknown) => void) => {
          callback({ ok: true, id: extensionId });
        },
        connect: () => ({
          postMessage() {},
          onMessage: { addListener() {} },
          onDisconnect: { addListener() {} },
        }),
      },
    };
    win.eval(script);
    await vi.waitFor(() => expect(win.document.querySelector('iframe#app')).not.toBeNull());
    return win;
  }

  function publish(hash: unknown, origin = extensionOrigin, type = 'ROUTE_CHANGED') {
    const win = shell.window;
    win.dispatchEvent(new win.MessageEvent('message', {
      origin,
      source: win.document.querySelector<HTMLIFrameElement>('iframe#app')!.contentWindow,
      data: { type, hash },
    }));
  }

  afterEach(() => shell?.window.close());

  it.each(['#/inbox/archived', '#/inbox/other?unread', '#/network'])(
    'forwards %s into the newly embedded frame', async (hash) => {
      const win = await boot(hash);
      expect(win.document.querySelector('iframe#app')!.getAttribute('src'))
        .toBe(`${extensionOrigin}/app.html${hash}`);
    },
  );

  it('does not forward a malformed launch fragment', async () => {
    const win = await boot('#javascript:alert(1)');
    expect(win.document.querySelector('iframe#app')!.getAttribute('src'))
      .toBe(`${extensionOrigin}/app.html`);
  });

  it('ignores routes from unrelated web pages and other extensions', async () => {
    const win = await boot('#/inbox/focused');
    for (const origin of ['https://example.com', 'https://inflow.im', 'chrome-extension://other']) {
      publish('#/inbox/archived', origin);
      expect(win.location.hash).toBe('#/inbox/focused');
    }
    publish('#/inbox/archived');
    expect(win.location.hash).toBe('#/inbox/archived');
  });

  it('rejects malformed route messages from the extension', async () => {
    const win = await boot('#/inbox/focused');
    for (const hash of ['', '#javascript:alert(1)', '#/inbox/<script>', null, 42]) {
      publish(hash);
      expect(win.location.hash).toBe('#/inbox/focused');
    }
    publish('#/network', extensionOrigin, 'UNRELATED');
    expect(win.location.hash).toBe('#/inbox/focused');
  });

  it('mirrors routes without adding history entries or losing query parameters', async () => {
    const win = await boot('#/inbox/focused');
    const initialHistoryLength = win.history.length;
    publish('#/inbox/other?unread');
    expect(win.location.hash).toBe('#/inbox/other?unread');
    expect(win.location.search).toBe(`?ext=${extensionId}`);
    expect(win.history.length).toBe(initialHistoryLength);
  });
});

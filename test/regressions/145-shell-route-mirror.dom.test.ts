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

// The shell half is plain inline script in site/app.html rather than a module,
// so exercise the two rules it enforces against the file itself.
describe('regression #145: the shell half', () => {
  const shell = require('node:fs').readFileSync('site/app.html', 'utf8');

  it('forwards its fragment into the frame src', () => {
    expect(shell).toMatch(/routeHash\(\)/);
    expect(shell).toMatch(/'chrome-extension:\/\/' \+ id \+ '\/app\.html'/);
  });

  it('accepts a route only from the extension frame it embedded', () => {
    // An origin check is the whole security boundary: any page can postMessage
    // to this window, and the value lands in the frame's src.
    expect(shell).toMatch(/event\.origin !== 'chrome-extension:\/\/' \+ extensionId/);
  });

  it('validates the shape of the hash it is handed', () => {
    const match = shell.match(/var ROUTE_HASH = (\/.*\/);/);
    expect(match).toBeTruthy();
    // eslint-disable-next-line no-eval
    const re: RegExp = eval(match![1]);

    expect(re.test('#/inbox/archived')).toBe(true);
    expect(re.test('#/inbox/other?unread')).toBe(true);
    expect(re.test('#/network')).toBe(true);
    expect(re.test('#javascript:alert(1)')).toBe(false);
    expect(re.test('')).toBe(false);
  });

  it('replaces rather than pushes, so history is not doubled', () => {
    // The frame's own hash changes already add joint-session-history entries.
    expect(shell).toMatch(/history\.replaceState\(null, '', location\.pathname/);
  });
});

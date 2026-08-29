// @vitest-environment jsdom
/**
 * Regression 141 — the "Turn on inƒlow notifications" chip sat in a window
 * that already had permission, and clicking it did nothing at all.
 *
 * site/app.html watched for permission changes through
 * `navigator.permissions.query({name:'notifications'})`, but kept no
 * reference to the PermissionStatus it got back — the onchange closure
 * doesn't capture it either. Nothing held the object alive, so the browser
 * was free to collect it, and a collected PermissionStatus stops firing.
 * A window open while permission was granted in ANOTHER window (or from site
 * settings) therefore never found out, with two consequences:
 *
 *  - the chip stayed on screen, and clicking it hit askForNotifications(),
 *    which correctly refuses when permission isn't 'default' — and then did
 *    nothing else, so the button read as broken; and
 *  - reportCanNotify() never re-ran, so the extension kept believing this
 *    shell couldn't show notifications and kept falling back to its own.
 *
 * The fix parks the PermissionStatus in a variable, re-reads permission when
 * the window is focused or made visible, and makes a stale chip clear itself
 * when clicked. These tests run the real shell script from site/app.html.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_HTML = readFileSync(join(__dirname, '..', '..', 'site', 'app.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<script>/.exec(APP_HTML)![1];
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)![1];

const EXT_ID = 'ndehgbgifkapdigmefglpgacpagoclge';

interface Harness {
  chip: () => HTMLElement | null;
  clickChip: () => void;
  /** Change permission WITHOUT firing onchange — a collected watcher. */
  setPermissionSilently: (p: NotificationPermission) => void;
  /** The window comes back to the foreground. */
  focus: () => Promise<void>;
  becomeVisible: () => Promise<void>;
  posted: unknown[];
  prompts: () => number;
}

async function boot(permission: NotificationPermission): Promise<Harness> {
  const posted: unknown[] = [];
  const store: Record<string, string> = {};
  let current = permission;
  let prompts = 0;
  let hidden = false;

  document.body.innerHTML = BODY;

  const NotificationStub = function () {} as unknown as typeof Notification;
  Object.defineProperty(NotificationStub, 'permission', { get: () => current });
  (NotificationStub as any).requestPermission = () => {
    prompts += 1;
    return Promise.resolve(current);
  };
  vi.stubGlobal('Notification', NotificationStub);

  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });
  // A browser tab, not an installed-app window: the auto-ask on first launch
  // is a separate path (regression 138) and would prompt on its own, hiding
  // what the chip itself does.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  vi.stubGlobal('MutationObserver', class {
    observe() {} disconnect() {} takeRecords() { return []; }
  });

  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      sendMessage: (_id: string, _m: unknown, cb: (r: unknown) => void) =>
        setTimeout(() => cb({ ok: true, id: EXT_ID }), 0),
      connect: () => ({
        postMessage: (m: unknown) => posted.push(m),
        disconnect() {},
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
      }),
    },
  });

  (navigator as any).setAppBadge = () => Promise.resolve();
  (navigator as any).clearAppBadge = () => Promise.resolve();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: () => Promise.reject(new Error('n/a')) },
  });
  // The watcher resolves, then the PermissionStatus is never fired again —
  // exactly what a collected one looks like from the page's side.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: current, onchange: null }) },
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });

  // eslint-disable-next-line no-new-func — running the shipped shell verbatim.
  new Function(SCRIPT)();
  await new Promise((r) => setTimeout(r, 5));

  const chip = () => document.querySelector<HTMLElement>('.notify-chip');
  return {
    chip,
    clickChip: () =>
      chip()!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    setPermissionSilently: (p) => { current = p; },
    focus: async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 5));
    },
    becomeVisible: async () => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 5));
    },
    posted,
    prompts: () => prompts,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('regression 141 — a stale notification chip corrects itself', () => {
  it('clears on click instead of doing nothing when permission is already granted', async () => {
    const shell = await boot('default');
    expect(shell.chip(), 'the chip is offered while undecided').not.toBeNull();

    // Granted in another window; this one's watcher never fired.
    shell.setPermissionSilently('granted');
    expect(shell.chip(), 'the window is still showing the stale chip').not.toBeNull();

    shell.clickChip();

    expect(shell.chip(), 'clicking must do something visible').toBeNull();
    expect(shell.prompts(), 'and must not re-prompt for a settled permission').toBe(0);
  });

  it('tells the extension it can notify after a change it never saw', async () => {
    const shell = await boot('default');
    shell.setPermissionSilently('granted');

    shell.clickChip();

    const reports = shell.posted.filter(
      (m: any) => m?.type === 'CAN_NOTIFY' || m?.type === 'HELLO',
    );
    expect(reports.at(-1)).toEqual({ type: 'CAN_NOTIFY', canNotify: true });
  });

  it('re-reads permission when the window is focused', async () => {
    const shell = await boot('default');
    shell.setPermissionSilently('granted');

    await shell.focus();

    expect(shell.chip(), 'coming back to the window must refresh it').toBeNull();
    const reports = shell.posted.filter((m: any) => m?.type === 'CAN_NOTIFY');
    expect(reports.at(-1)).toEqual({ type: 'CAN_NOTIFY', canNotify: true });
  });

  it('re-reads permission when the window becomes visible', async () => {
    const shell = await boot('default');
    shell.setPermissionSilently('granted');

    await shell.becomeVisible();

    expect(shell.chip()).toBeNull();
  });

  it('re-offers the chip if permission is revoked while the window sits open', async () => {
    const shell = await boot('granted');
    expect(shell.chip(), 'nothing to offer while granted').toBeNull();

    shell.setPermissionSilently('default');
    await shell.focus();

    expect(shell.chip(), 'a revoked permission is askable again').not.toBeNull();
    const reports = shell.posted.filter((m: any) => m?.type === 'CAN_NOTIFY');
    expect(reports.at(-1)).toEqual({ type: 'CAN_NOTIFY', canNotify: false });
  });

  it('still prompts normally when permission is genuinely undecided', async () => {
    const shell = await boot('default');

    shell.clickChip();

    expect(shell.prompts(), 'the chip must still do its actual job').toBe(1);
  });
});

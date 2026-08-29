// @vitest-environment jsdom
/**
 * Regression 138 — the installed app fell back to Chrome-attributed
 * notifications forever once the permission prompt had been *shown*.
 *
 * site/app.html wrote the `inflow-notif-asked` latch BEFORE
 * Notification.requestPermission() resolved. Dismissing the prompt (Esc, or
 * the X) leaves permission at 'default', so the latch stuck with nothing
 * granted: canNotify() stayed false, HELLO reported canNotify:false,
 * notifyViaShell() found no eligible shell, and every alert fell back to
 * chrome.notifications — attributed to Chrome, not to inƒlow. Nothing inside
 * the app could ask again.
 *
 * These tests execute the real shell script from site/app.html, so they fail
 * against the shipped file rather than a copy of its logic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_HTML = readFileSync(
  join(__dirname, '..', '..', 'site', 'app.html'),
  'utf8',
);

const BODY = /<body>([\s\S]*?)<script>/.exec(APP_HTML)![1];
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)![1];

const EXT_ID = 'ndehgbgifkapdigmefglpgacpagoclge';

interface Harness {
  permission: () => NotificationPermission;
  /** Resolve the pending requestPermission() call with this outcome. */
  settlePrompt: (outcome: NotificationPermission) => Promise<void>;
  prompts: () => number;
  store: Record<string, string>;
  posted: unknown[];
  chip: () => HTMLElement | null;
}

/**
 * Boot the shell in jsdom with the extension "installed" and an app window,
 * then wait for the probe to settle so the app frame exists.
 */
async function boot(opts: {
  permission?: NotificationPermission;
  appWindow?: boolean;
  store?: Record<string, string>;
}): Promise<Harness> {
  const store: Record<string, string> = { ...(opts.store ?? {}) };
  const posted: unknown[] = [];
  let permission: NotificationPermission = opts.permission ?? 'default';
  let prompts = 0;
  let resolvePrompt: ((o: NotificationPermission) => void) | null = null;

  document.body.innerHTML = BODY;
  document.title = 'inƒlow — a better inbox for LinkedIn';

  const NotificationStub = function () {} as unknown as typeof Notification;
  Object.defineProperty(NotificationStub, 'permission', { get: () => permission });
  (NotificationStub as any).requestPermission = () => {
    prompts += 1;
    return new Promise<NotificationPermission>((res) => {
      resolvePrompt = (outcome) => {
        permission = outcome;
        res(outcome);
      };
    });
  };
  vi.stubGlobal('Notification', NotificationStub);

  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });

  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (opts.appWindow ?? true) && q.includes('display-mode'),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));

  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) =>
        setTimeout(() => cb({ ok: true, id: EXT_ID, version: '0.6.0' }), 0),
      connect: () => ({
        postMessage: (m: unknown) => posted.push(m),
        disconnect() {},
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
      }),
    },
  });

  // Not under test: the frame-reattach watcher, whose callbacks would
  // otherwise keep firing against a torn-down document between cases.
  vi.stubGlobal('MutationObserver', class {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  });

  // Not under test: the badge, the SW, and the permission observer.
  (navigator as any).setAppBadge = () => Promise.resolve();
  (navigator as any).clearAppBadge = () => Promise.resolve();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: () => Promise.reject(new Error('n/a')) },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.reject(new Error('n/a')) },
  });

  // eslint-disable-next-line no-new-func — running the shipped shell verbatim.
  new Function(SCRIPT)();
  // Let the probe's setTimeout(0) and its promise chain settle so embed() runs.
  await new Promise((r) => setTimeout(r, 5));

  return {
    permission: () => permission,
    settlePrompt: async (outcome) => {
      resolvePrompt?.(outcome);
      await new Promise((r) => setTimeout(r, 5));
    },
    prompts: () => prompts,
    store,
    posted,
    chip: () => document.querySelector<HTMLElement>('.notify-chip'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('regression 138 — notification permission is never latched undecided', () => {
  it('does not latch when the prompt is dismissed without a decision', async () => {
    const h = await boot({ permission: 'default' });
    expect(h.prompts()).toBe(1);

    // The user dismisses the prompt: permission stays 'default'.
    await h.settlePrompt('default');

    expect(h.store['inflow-notif-asked']).toBeUndefined();
  });

  it('latches once the user actually decides', async () => {
    const granted = await boot({ permission: 'default' });
    await granted.settlePrompt('granted');
    expect(granted.store['inflow-notif-asked']).toBe('1');

    document.body.innerHTML = '';
    vi.unstubAllGlobals();

    const denied = await boot({ permission: 'default' });
    await denied.settlePrompt('denied');
    expect(denied.store['inflow-notif-asked']).toBe('1');
  });

  it('offers an in-app way back when the latch is already set', async () => {
    // The state a user carries over from a build that latched pre-emptively.
    const h = await boot({
      permission: 'default',
      store: { 'inflow-notif-asked': '1' },
    });

    expect(h.prompts()).toBe(0); // the auto-ask correctly stays quiet
    const chip = h.chip();
    expect(chip, 'a latched install must still be able to ask').not.toBeNull();

    chip!.querySelector('button')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(h.prompts()).toBe(1);

    await h.settlePrompt('granted');
    expect(h.chip()).toBeNull(); // resolved — the nudge goes away
  });

  it('offers the chip in a browser tab, which never auto-prompts', async () => {
    const h = await boot({ permission: 'default', appWindow: false });

    expect(h.prompts()).toBe(0);
    expect(h.chip(), 'a tab has no other route to permission').not.toBeNull();
  });

  it('shows no chip once permission is decided', async () => {
    const granted = await boot({ permission: 'granted' });
    expect(granted.chip()).toBeNull();
    expect(granted.prompts()).toBe(0);

    document.body.innerHTML = '';
    vi.unstubAllGlobals();

    const denied = await boot({ permission: 'denied' });
    expect(denied.chip()).toBeNull();
    expect(denied.prompts()).toBe(0);
  });

  it('respects a dismissed nudge', async () => {
    const h = await boot({
      permission: 'default',
      store: { 'inflow-notif-asked': '1' },
    });
    h.chip()!.querySelector<HTMLElement>('.chip-x')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(h.chip()).toBeNull();
    expect(h.store['inflow-notify-nudge-dismissed']).toBe('1');
  });

  it('tells the extension it can notify once permission is granted', async () => {
    const h = await boot({ permission: 'default' });
    await h.settlePrompt('granted');

    // HELLO on connect reported the pre-grant state; CAN_NOTIFY corrects it.
    const canNotify = h.posted.filter(
      (m: any) => m?.type === 'CAN_NOTIFY' || m?.type === 'HELLO',
    );
    expect(canNotify.at(-1)).toEqual({ type: 'CAN_NOTIFY', canNotify: true });
  });
});

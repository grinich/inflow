// @vitest-environment jsdom
/**
 * The agent tool bridge in site/app.html, running the real shipped shell
 * script: window.inflowAgent's request/response correlation over postMessage,
 * origin checking, timeouts (an old extension's silence becomes an actionable
 * error), and the WebMCP proxy re-registering on INFLOW_AGENT_TOOLS_CHANGED.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRegisteredTools,
  installModelContextMock,
  invokeTool,
  uninstallModelContextMock,
} from '../mocks/model-context';

const APP_HTML = readFileSync(join(__dirname, '..', '..', 'site', 'app.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<script>/.exec(APP_HTML)![1];
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)![1];

interface Harness {
  /** Messages the shell posted into the app frame, with their targetOrigin. */
  framePosted: { msg: any; origin: string }[];
  /** The extension origin the shell believes it embedded. */
  extOrigin: () => string;
  /** Deliver a message to the shell as if the frame (or anyone) sent it. */
  deliver: (data: unknown, origin?: string) => void;
  agent: () => any;
}

async function boot(opts: { respondToProbe?: boolean } = {}): Promise<Harness> {
  const framePosted: { msg: any; origin: string }[] = [];
  const store: Record<string, string> = {};

  document.body.innerHTML = BODY;

  const NotificationStub = function () {} as unknown as typeof Notification;
  Object.defineProperty(NotificationStub, 'permission', { get: () => 'denied' });
  (NotificationStub as any).requestPermission = () => Promise.resolve('denied');
  vi.stubGlobal('Notification', NotificationStub);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });
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
      sendMessage: (id: string, _m: unknown, cb: (r: unknown) => void) => {
        if (opts.respondToProbe !== false) setTimeout(() => cb({ ok: true, id }), 0);
      },
      connect: () => ({
        postMessage() {},
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
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: 'denied', onchange: null }) },
  });

  // eslint-disable-next-line no-new-func — running the shipped shell verbatim.
  new Function(SCRIPT)();
  await new Promise((r) => setTimeout(r, 10));

  const frame = document.querySelector<HTMLIFrameElement>('iframe#app');
  let extId = '';
  if (frame) {
    extId = /^chrome-extension:\/\/([a-p]+)\//.exec(frame.src)?.[1] ?? '';
    // jsdom's iframe never loads a chrome-extension:// URL — substitute a
    // recorder for the frame's window so we can see what the shell posts.
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: (msg: any, origin: string) => framePosted.push({ msg, origin }),
      },
    });
  }

  return {
    framePosted,
    extOrigin: () => `chrome-extension://${extId}`,
    deliver: (data, origin) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: origin ?? `chrome-extension://${extId}`,
          source: window,
        })
      );
    },
    agent: () => (window as any).inflowAgent,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  uninstallModelContextMock();
  document.body.innerHTML = '';
});

it('rejects cleanly before the frame is embedded', async () => {
  const shell = await boot({ respondToProbe: false });
  expect(shell.agent()).toBeDefined();
  expect(shell.agent().status().frameLoaded).toBe(false);
  await expect(shell.agent().callTool('list_conversations', {})).rejects.toThrow(
    'inflow app frame not loaded'
  );
});

it('posts requestId-stamped requests to the frame with the extension targetOrigin', async () => {
  const shell = await boot();
  expect(shell.agent().status().frameLoaded).toBe(true);

  void shell.agent().listTools().catch(() => {});
  void shell.agent().callTool('read_thread', { conversationId: 'c1' }).catch(() => {});

  expect(shell.framePosted).toHaveLength(2);
  const [list, call] = shell.framePosted;
  expect(list.origin).toBe(shell.extOrigin());
  expect(list.msg.type).toBe('INFLOW_AGENT_LIST_TOOLS');
  expect(typeof list.msg.requestId).toBe('string');
  expect(call.msg).toMatchObject({
    type: 'INFLOW_AGENT_CALL_TOOL',
    tool: 'read_thread',
    input: { conversationId: 'c1' },
  });
  expect(call.msg.requestId).not.toBe(list.msg.requestId);
});

it('resolves the matching pending call on INFLOW_AGENT_RESULT — and only from the extension origin', async () => {
  const shell = await boot();
  const first = shell.agent().callTool('get_unread_count', {});
  const second = shell.agent().callTool('get_unread_count', {});
  const [req1, req2] = shell.framePosted.map((p) => p.msg.requestId);

  // A result from the wrong origin must be ignored outright.
  shell.deliver(
    { type: 'INFLOW_AGENT_RESULT', requestId: req1, result: 'forged' },
    'https://evil.example'
  );
  // Answer the SECOND request first — correlation is by id, not order.
  shell.deliver({ type: 'INFLOW_AGENT_RESULT', requestId: req2, result: { n: 2 } });
  await expect(second).resolves.toEqual({ n: 2 });

  shell.deliver({ type: 'INFLOW_AGENT_RESULT', requestId: req1, result: { n: 1 } });
  await expect(first).resolves.toEqual({ n: 1 });

  // An unknown requestId (already settled) must not throw.
  shell.deliver({ type: 'INFLOW_AGENT_RESULT', requestId: req1, result: { n: 9 } });
});

it("times out into 'may need an update' when the extension never answers", async () => {
  const shell = await boot();
  vi.useFakeTimers();
  const pending = shell.agent().callTool('send_message', { conversationId: 'c', body: 'x' });
  const guarded = pending.catch((e: Error) => e.message);
  vi.advanceTimersByTime(30001);
  vi.useRealTimers();
  expect(await guarded).toContain('did not respond');
});

it('re-registers the WebMCP proxy on INFLOW_AGENT_TOOLS_CHANGED and forwards execute', async () => {
  const shell = await boot();
  installModelContextMock();

  shell.deliver({ type: 'INFLOW_AGENT_TOOLS_CHANGED' });
  // The refresh asks the frame for the tool list; answer it.
  const listReq = shell.framePosted.find((p) => p.msg.type === 'INFLOW_AGENT_LIST_TOOLS');
  expect(listReq).toBeDefined();
  shell.deliver({
    type: 'INFLOW_AGENT_RESULT',
    requestId: listReq!.msg.requestId,
    result: {
      tools: [{ name: 'list_conversations', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      readsEnabled: true,
      writesEnabled: false,
    },
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(getRegisteredTools()).toEqual(['list_conversations']);

  // Executing the registered tool forwards through callTool to the frame.
  const exec = invokeTool('list_conversations', { tab: 'focused' });
  const callReq = shell.framePosted.find((p) => p.msg.type === 'INFLOW_AGENT_CALL_TOOL');
  expect(callReq!.msg.tool).toBe('list_conversations');
  shell.deliver({
    type: 'INFLOW_AGENT_RESULT',
    requestId: callReq!.msg.requestId,
    result: { content: [{ type: 'text', text: '{}' }] },
  });
  await expect(exec).resolves.toEqual({ content: [{ type: 'text', text: '{}' }] });
});

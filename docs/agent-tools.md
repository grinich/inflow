# Agent tools

inflow can expose its inbox to AI agents as structured tools — `list_conversations`,
`read_thread`, `send_message`, and friends — so an agent works through inflow's synced
data and action layer instead of screen-scraping LinkedIn.

Everything here is **off by default**. Nothing about your inbox is visible to any agent
until you opt in.

## The security model

- **Two independent opt-ins**, in the command palette (`⌘K`) → **Configure agent access**:
  - *Let agents read my inbox* — list, read, search, see pending invitations.
  - *Let agents act* — send messages, archive, mark read/unread. Requires read access;
    turning reads off turns writes off too.
- **Send cap** — agent-initiated sends are limited to 15/hour (sliding window).
- **Visible actions** — every agent write shows a toast in the app ("Agent sent a
  message to Jane Doe").
- **One gate for every transport** — tool calls from any surface funnel through one
  executor that re-checks the toggles per call. A tool registration that outlives a
  toggle-off still refuses to act.
- **Prompt injection caveat** — message bodies and participant names are content written
  by other people. The tool results say so, but if you point an agent at your inbox,
  remember that what it reads there is untrusted input to *it*. Prefer read-only mode
  when you don't need actions.

Tool calls answer structured errors rather than hanging: with agent access disabled,
every call (from any transport) returns *"Agent access is disabled…"* with the
instructions to enable it.

## Claude Desktop — Inflow.mcpb (the consumer path)

`Inflow.mcpb` is a [Claude Desktop Extension](https://www.anthropic.com/engineering/desktop-extensions):
a bundled MCP server that installs with a double-click (no terminal, no config
files — Claude Desktop ships its own Node). It bridges Claude Desktop to the
inflow extension over `ws://127.0.0.1:48632`; the extension dials out to it and
serves the same gated executor as every other transport. Works with **no inflow
tab open** — Chrome just has to be running.

Setup:

1. Install inflow (v0.8.0+) in Chrome and `Inflow.mcpb` in Claude Desktop
   (Settings → Extensions → drag it in). Build it from source with `npm run mcpb:build`.
2. Ask Claude Desktop: *"what's my inflow pairing code?"* (the `get_pairing_code` tool).
3. In inflow: `⌘K` → **Configure agent access** → enable read (and optionally act),
   paste the code under *Claude Desktop*, **Save**. The status line flips to
   *Connected* within ~30 seconds.
4. Ask Claude Desktop to work your inbox. If tools are missing, the
   `inflow_status` tool explains exactly which step is incomplete.

Security model: the pairing is mutual — the server proves it knows the code
before the extension will talk to it (a local port-squatter gets nothing), and
the extension proves the user pasted it (a random local process can't drive
your inbox). Only `chrome-extension://` origins may even connect. All
authorization still lives in the extension's toggles; the bridge only relays,
and write actions surface as Chrome notifications when no inflow page is open.

Sources of truth: `mcpb/` (server + manifest), `entrypoints/background/agent-bridge.ts`
(extension side), protocol in `mcpb/server/bridge-core.mjs`.

## Connecting Claude today — external messaging (the path that works)

Claude in Chrome **cannot** use the embedded app at inflow.im/app: its automation
sweeps cross-extension iframes off the page (the shell's frame-lost notice is exactly
this), and its debugger refuses any tab containing one. What it *can* do is message
the extension's background directly from any **plain** inflow.im page:

```js
// On any inflow.im page EXCEPT /app — e.g. https://inflow.im/changelog
// (the home page redirects to /app when the extension is installed).
const CANDIDATES = [
  'ndehgbgifkapdigmefglpgacpagoclge', // Chrome Web Store build
  'fngobhjkhkdnnijgegkcjoadmddkehgh', // unpacked dev build
];
let EXT;
for (const id of CANDIDATES) {
  const pong = await chrome.runtime.sendMessage(id, { type: 'PING' }).catch(() => null);
  if (pong?.ok) { EXT = id; break; }
}

await chrome.runtime.sendMessage(EXT, { type: 'AGENT_LIST_TOOLS' });
// → { tools: [...with input schemas], readsEnabled, writesEnabled }

const result = await chrome.runtime.sendMessage(EXT, {
  type: 'AGENT_CALL_TOOL',
  tool: 'list_conversations',
  input: { tab: 'focused', query: 'is:unread', limit: 10 },
});
JSON.parse(result.content[0].text);
// (MCP CallToolResult; errors set isError: true with an actionable message.)
```

The executor runs in the extension's service worker, so this works **even with no
inflow tab open**. Write actions surface as Chrome notifications when no inflow page
is showing (a toast when one is).

The recipe for Claude:

1. Install inflow; enable access in the app: `⌘K` → **Configure agent access** →
   toggle read (and optionally act) → **Save**.
2. Point Claude at any inflow.im page except `/app` (say, `/changelog`).
3. Tell it: *"Use `chrome.runtime.sendMessage(extensionId, { type: 'AGENT_LIST_TOOLS' })`
   and `{ type: 'AGENT_CALL_TOOL', tool, input }` on this page to work with my
   LinkedIn inbox."*

The v1 tools: `list_conversations`, `read_thread`, `search_conversations`,
`get_unread_count`, `list_invitations` (reads); `send_message`, `archive_conversation`,
`mark_read`, `mark_unread` (writes).

**Try it risk-free with demo mode**: `⌘K` → *Enter demo mode* runs the app — agent
tools included — against generated fake data. (Demo mode intercepts the in-page
transports; the external channel above always talks to the real background.)

## The in-page bridge — window.inflowAgent

https://inflow.im/app also exposes the same tools to scripts running *on that page*:

```js
await window.inflowAgent.status();     // { frameLoaded, extensionId }
await window.inflowAgent.listTools();
await window.inflowAgent.callTool('read_thread', { conversationId: '…' });
```

Same executor, same gates, same result shape. This is the surface for your own
DevTools console, userscripts, and agents that can coexist with the embedded
iframe — just not Claude in Chrome today, per above.

## The WebMCP story

The same tools register on [WebMCP](https://developer.chrome.com/docs/ai/webmcp)
(`document.modelContext.registerTool()`) wherever the browser provides it — on the
extension page itself and, proxied, on inflow.im/app. That's the standards-track way
for agents to discover page tools; as of mid-2026 Chrome ships it as an origin trial
(Chrome 149–156) and mainstream agents don't call it yet, so the `window.inflowAgent`
bridge above is the path that works today.

To see the WebMCP surface now: enable `chrome://flags/#enable-webmcp-testing` and
inspect a page with Google's Model Context Tool Inspector extension. When the origin
trial token for inflow.im is enrolled it goes into `site/app.html`'s `<head>` (there's
a placeholder comment).

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `Error: Agent access is disabled…` | The opt-in toggles are off — enable via `⌘K` → Configure agent access. |
| `Error: Agent write actions are disabled…` | Read access is on but the second toggle is off. |
| `inflow app frame not loaded` | The extension isn't installed/detected on inflow.im/app yet. |
| `inflow extension did not respond — it may need an update` | The installed extension predates agent tools (or its page hung). Update inflow. |
| `agent send limit reached (15/hour)` | The send cap; the error says how long to wait. |
| Tools work in the extension tab but not on inflow.im | Local dev: a plain `npm run build` strips localhost from the shell allowlist (see CLAUDE.md), and `site/app-sw.js` serves a stale shell — hard-reload twice. `?ext=dev` pins the unpacked build's ID. |

## For developers

- Executor + catalog: `src/lib/agent-tools/` (`executor.ts` is the single entry; every
  transport calls it). Settings: `src/lib/agent-settings.ts`.
- Transports: `src/hooks/useAgentTools.ts` (WebMCP registration + shell RPC listener in
  `src/lib/shell-messages.ts`), and the shell side in `site/app.html` (`window.inflowAgent`).
- Tests: `test/unit/agent-tools/`, `test/integration/agent-*`, with mocks in
  `test/mocks/model-context.ts`.
- Adding a tool = one entry in `src/lib/agent-tools/catalog.ts` (schema + handler that
  reads `db` at call time) plus executor-test coverage. Registration surfaces pick it
  up automatically.

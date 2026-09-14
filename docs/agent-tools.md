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

## Desktop MCP — Inflow.mcpb

`Inflow.mcpb` contains a standard MCP server. Claude Desktop installs the bundle
with a double-click; Codex can run the same server after the bundle is unpacked.
It bridges the MCP client to the inflow extension over `ws://127.0.0.1:48632`;
the extension dials out to it and serves the same gated executor as every other
transport. It works with **no inflow tab open** — Chrome just has to be running.

Setup:

1. Install inflow (v0.8.0+) in Chrome and `Inflow.mcpb` in Claude Desktop —
   the **Download Inflow.mcpb** button lives in `⌘K` → Configure agent access
   (or build from source: `npm run mcpb:build`).
2. Ask Claude Desktop to connect to inflow. It answers with a **pairing link**
   (`inflow.im/app?pair=INF-XXXXXX`) — click it: inflow opens with the code
   prefilled in Agent Access; review and press **Save**. (Manual fallback:
   `get_pairing_code` also prints the raw code to type in.)
3. In the same modal, enable read (and optionally act) if you haven't. The
   status line flips to *Connected* within ~30 seconds.
4. Ask Claude Desktop to work your inbox. If tools are missing, the
   `inflow_status` tool explains exactly which step is incomplete.

### Codex setup

Download `Inflow.mcpb`, unpack it, and register its included server:

```sh
mkdir -p "$HOME/inflow-mcp"
unzip "$HOME/Downloads/Inflow.mcpb" -d "$HOME/inflow-mcp"
codex mcp add inflow -- node "$HOME/inflow-mcp/server/index.mjs"
```

Restart the local Codex task, call `get_pairing_code`, and approve the pairing
link in inflow. The pairing screen may mention Claude because `.mcpb` is Claude's
bundle format; the local server itself is standard MCP. Only one MCP client can
own port 48632 at a time, so fully quit Claude Desktop before using Codex (or vice
versa).

The prefill is deliberately not auto-saved: a crafted `?pair=` link can put a
code in the box, but only your Save applies it — and pairing alone grants
nothing; the read/write toggles are separate consents.

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

**Reads**: `list_conversations`, `read_thread`, `search_conversations`,
`get_unread_count`, `list_invitations`, `list_sent_invitations`, `list_connections`,
`list_drafts`, `search_recipients`, `get_send_quota`.

**Writes**: `send_message`, `start_conversation` (message someone new),
`save_draft` / `send_draft`, `archive_conversation` / `unarchive_conversation`,
`mark_read` / `mark_unread`, `move_to_focused` / `move_to_other` / `move_to_spam`,
`star_conversation` / `unstar_conversation`, `delete_conversation`,
`react_to_message`, `edit_message`, `delete_message`, `accept_invitation`,
`ignore_invitation`, `withdraw_invitation`.

Each direction of a toggle is its own tool (`unarchive_conversation`, not
`archive_conversation(unarchive: true)`) — a tool list is a menu, and an agent
scanning it should see every action it can take without reading schemas.

The local lists (`list_conversations`, `list_invitations`,
`list_sent_invitations`, `list_connections`) take `offset` and return
`nextOffset` — null when there is no more, so paging terminates without probing
for an empty page.

`send_message` and `start_conversation` count against the hourly cap;
`get_send_quota` reports what's left so bulk work can pace itself. Message-level
tools require canonical `urn:li:msg_message:` ids from `read_thread` — the
SSE-delivered copies are deduped away and acting on one races that cleanup.

**Not available** (would need new LinkedIn endpoints in the extension, not just
tool definitions): profile lookup and people search, InMail, notifications and
profile views, the feed, mute/block, and reporting an invitation.

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

## ChatGPT and Codex — current WebMCP limitation

inflow implements the JavaScript side of
[WebMCP](https://learn.chatgpt.com/docs/webmcp) with
`document.modelContext.registerTool()`, including the required top-level proxy:
tools registered inside the embedded extension iframe are invisible to ChatGPT,
so `inflow.im/app` mirrors them onto its own document.

That proxy is not enough for direct ChatGPT/Codex support today. OpenAI's site
tools currently run in the ChatGPT desktop app's **built-in browser**, while
inflow's data and executor live in the extension installed in the user's regular
Chrome profile. The built-in browser cannot discover that extension through
`chrome.runtime`, so it shows inflow's install fallback and has no tool executor
to register. OpenAI's external browser extension provides browser control, but
the current documentation does not list it as a WebMCP site-tools surface.

Use the local MCP bridge above with Codex today. Direct WebMCP requires either a
cross-browser relay between `inflow.im/app` and the Chrome extension, or future
WebMCP support in the external Chrome surface. The existing top-level registration
and late-API detection remain useful groundwork for either path.

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

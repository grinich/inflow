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

## Connecting Claude today

Claude in Chrome (and Claude Code driving it) can't attach to `chrome-extension://`
pages, but it can drive **https://inflow.im/app** — the page that embeds the extension.
That page exposes the bridge:

```js
// In the browser console or an agent's JS tool, on https://inflow.im/app
await window.inflowAgent.status();     // { frameLoaded: true, extensionId: "…" }
await window.inflowAgent.listTools();  // { tools: [...], readsEnabled, writesEnabled }

const result = await window.inflowAgent.callTool('list_conversations', {
  tab: 'focused',           // focused | other | archived | spam
  query: 'is:unread',       // optional — inflow's search grammar
  limit: 10,
});
// result = { content: [{ type: 'text', text: '{ "conversations": [...] }' }] }
// (MCP CallToolResult; parse result.content[0].text as JSON. Errors set isError: true.)
```

So the recipe for Claude is:

1. Install inflow and open https://inflow.im/app in Chrome.
2. In inflow: `⌘K` → **Configure agent access** → enable read (and optionally write) access.
3. Tell Claude (with browser access to that tab):
   *"On the inflow tab, use `window.inflowAgent.listTools()` / `callTool(name, input)`
   to work with my LinkedIn inbox."*

The v1 tools: `list_conversations`, `read_thread`, `search_conversations`,
`get_unread_count`, `list_invitations` (reads); `send_message`, `archive_conversation`,
`mark_read`, `mark_unread` (writes). `listTools()` returns the full input schemas.

**Try it risk-free with demo mode**: `⌘K` → *Enter demo mode* runs the whole app —
agent tools included — against generated fake data. Nothing touches your LinkedIn
account.

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

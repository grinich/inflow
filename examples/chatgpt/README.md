# Inflow MCP App for ChatGPT (experimental)

An optional MCP server and inbox widget for Inflow. Uses **mcp-use v2** for
standard MCP transport, tools, OAuth integration, and the React View;
**@openai/mcp-extensions** supplies OpenAI-specific display and entrypoint metadata.
The widget adapts Inflow's original conversation rows, message bubbles, and styles.

## Architecture and hosting

```text
ChatGPT ── OAuth / HTTPS ──> MCP server <── outbound HTTPS ── local bridge
                                                               │
                                                   Inflow Chrome extension
                                                               │
                                                    existing LinkedIn session
```

**Manufact is optional.** The server runs with Node.js or the included Dockerfile
on a host of your choice. `INFLOW_PUBLIC_URL` is its canonical origin. ChatGPT
needs a reachable HTTPS endpoint; local MCP clients can use localhost. A local
server can also be exposed through an HTTPS tunnel for development.

The local bridge and Chrome must stay running even when the MCP server is in the
cloud. LinkedIn cookies, sync, and the database remain in Chrome. Requested
message data passes through the server to the client; this application does not
persist it on the server. Disable request/response payload logging on your host.

This example supports **one owner and one server instance**. Every authorized
connection accesses that owner's inbox. Relay requests and OAuth grant state are
in memory. A restart cancels pending requests and refresh grants; existing access
tokens last up to one hour, after which sign-in is required again. Refresh grants
also expire seven days after sign-in and cannot be extended by rotation.
Do not use this configuration as a shared multi-user service. Rotate the signing
key to revoke all access. Inflow's [upstream disclaimer](../../README.md#disclaimer)
also applies.

## Run locally

Requires Node.js 24+, Inflow installed in Chrome, and an active LinkedIn session.
From the repository root:

```sh
cd examples/chatgpt
npm ci
cp .env.example .env
```

Set three **different** random secrets of at least 32 characters in `.env`:
`INFLOW_SIGNING_KEY` signs OAuth tokens, `INFLOW_LOGIN_KEY` is entered on the
connection page, and `INFLOW_BRIDGE_KEY` authenticates the local bridge.
Generate each value separately, for example with `openssl rand -hex 32`.
Set `INFLOW_PUBLIC_URL` to `http://localhost:3000` for local clients, or your HTTPS
origin for ChatGPT. Keep secrets out of Git, screenshots, and plugin files.

```sh
npm run build
npm start
```

In a second terminal, create `.env.bridge` containing only `INFLOW_PUBLIC_URL`
and `INFLOW_BRIDGE_KEY`, then run `npm run bridge`. Open its printed pairing
link and enable agent access in Inflow. Writes still require Inflow's write
permission and obey its send cap. The bridge uses `127.0.0.1:48632`; stop any
other Inflow bridge using that port. Pairing state is stored in `.inflow-local/`
(or `INFLOW_STATE_DIR`).

## Deploy and connect

Build and run on any Docker host from this directory:

```sh
docker build -t inflow-chatgpt .
docker run --env-file .env -p 3000:3000 inflow-chatgpt
```

Set `INFLOW_PUBLIC_URL` to the external HTTPS origin and configure TLS at your
host or reverse proxy. Use one instance; scale-to-zero interrupts bridge polling.
The MCP endpoint is `/mcp`. Configure the same origin and bridge key locally.

If using Manufact, deploy with
`npx mcp-use deploy --no-github --org YOUR_ORG_SLUG` and set the environment
variables there. No Manufact SDK, account, or deployment is needed at runtime.
Keep private files named `.env*` or outside the upload directory; do not assume
managed uploads honor `.gitignore`.

Register your `/mcp` endpoint in the host with OAuth and complete sign-in using
`INFLOW_LOGIN_KEY`. The `plugin/` template can be used with clients supporting
Agent Plugins: replace the nonfunctional URL in `plugin/mcp.json` with your own
endpoint before packaging or installing. The local marketplace is under
`.agents/plugins/marketplace.json`. Never distribute your connection key.

## UI and limitations

- One rendering tool, `open_inbox`, selects `inbox`, `thread`, or `connection`
  (`visualize` is an inbox alias). Reuse the returned `widgetSessionId` to update
  the same panel. Other tools operate without creating widgets.
- Focused, Other, Archived, and Spam folders; search and pagination; thread reading,
  replies, stars, archive and read status. All 30 upstream agent tools are exposed.
- Drafts survive view switches in the current widget, but not iframe teardown.
  Attachment uploads/downloads and Chrome-only features remain in the original app.
- The server advertises fullscreen and global/thread entrypoints. Actual panel
  placement and pinning depend on the host and remain unverified.
- A subscription-based `@mcp-use/client` 2.4.0 connection stalled subsequent cloud
  resource reads in earlier testing. Direct modern requests and the installed
  plugin worked; that subscription path remains unverified.

## Review and verification

See [REVIEW.md](REVIEW.md) for the code map, compatibility adapters, test commands,
and provenance. Existing extension runtime and release behavior are unchanged.

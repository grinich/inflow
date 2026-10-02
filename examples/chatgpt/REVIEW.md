# Reviewing this example

Start with these files; dependencies and copied UI account for much of the diff.

| File                                                   | Responsibility                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `index.ts`                                             | Server setup, one View-bound opener, typed tools and upstream catalog registration  |
| `src/auth.ts`                                          | Single-owner OAuth with PKCE, audience binding and refresh-token rotation           |
| `src/relay.ts`                                         | In-memory RPC queue; authenticated bridge polling; at most one delivery per command |
| `bridge/index.mjs`                                     | Local WebSocket connection to Chrome and outbound server polling                    |
| `src/contracts.ts`                                     | Validated inbox/thread payloads and widget input                                    |
| `views/inbox/view.tsx`                                 | Inbox state, navigation, polling and actions                                        |
| `src/openai-ui.ts`, `views/inbox/use-inbox-updates.ts` | Two framework compatibility adapters described below                                |

## What is copied versus new

`vendor/bridge-core.mjs` and `vendor/tool-catalog.mjs` are exact copies of
`mcpb/server/`. They keep this directory deployable on its own. Run
`npm run sync:upstream` after upstream changes; CI runs `npm run check:upstream`
to reject drift. Do not edit those copies directly.

`views/inbox/upstream/` contains the original UI port, with relative imports and
adapters replacing Chrome storage/actions. Its [README](views/inbox/upstream/README.md)
identifies the changed parts. `vendor/UPSTREAM.json` records the source revision;
`vendor/INFLOW-LICENSE` preserves the MIT notice. These files remain visible in the
diff so changes to copied components can be inspected.

The root package, extension runtime, and release version are untouched. The new
CI job installs and verifies only this example; its dependencies are independent
of the extension's dependency tree.

## Compatibility adapters

mcp-use 2.7.2 owns the transport and generated View resource. It does not expose
OpenAI metadata for generated resources through a resource configuration hook,
so `src/openai-ui.ts` adds schema-validated fullscreen metadata to that resource's
JSON or SSE response. Tests cover preserving unrelated metadata and delivering
an SSE event before its connection closes. Remove the adapter when the framework
supports this directly.

The version's `useToolContext` retains the initial result. `use-inbox-updates.ts`
observes subsequent notifications from the parent host for the same widget
session. It does not establish a second transport. Widget IDs only correlate
presentation state; they do not grant authorization.

OpenAI MCP Extensions 0.1.0 has an optional peer on MCP Apps 1.7.5. The explicit
peer coexists with mcp-use's nested MCP Apps 2.x runtime. No peer checks are disabled.

## Automated checks

Run from `examples/chatgpt`:

```sh
npm ci
npm run check:upstream
npm run format:check
npm test
npm run typecheck
npm run build
```

Security tests exercise OAuth sign-in, PKCE, redirect/resource restrictions,
refresh-token rotation, missing configuration, body-size limits, bridge
credentials and command delivery. UI tests cover metadata and input validation;
focused state regression tests cover background refresh behavior. These do not
prove the host's actual placement or pinning behavior.

With a local server running and `.env` configured:

```sh
node --env-file=.env scripts/verify-mcp.mjs
node --env-file=.env scripts/verify-modern.mjs
```

These verify the built resource and tool protocol using short-lived local test
tokens. The first also checks one rendering tool, distinct/new widget IDs,
repeated session reuse and invalid-input rejection. A disconnected bridge is
sufficient; no live write is sent.

For manual UI checks, `scripts/preview-host.mjs` serves the real View bundle at
`http://localhost:3100` with synthetic conversations. Stop the real local bridge
first so fixture polling cannot compete with it. The preview is local only;
secrets stay on its server. `scripts/capture-preview.mjs` captures the synthetic
View with the mcp-use screenshot command. Neither replaces a test in ChatGPT.

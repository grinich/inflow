# CLAUDE.md

## Project overview

inflow is a Chrome extension (MV3) that provides a keyboard-driven messaging client for LinkedIn. Built with WXT + React + TypeScript + Tailwind CSS + Dexie (IndexedDB).

## Common commands

- `npm run dev` — start WXT dev server (hot reload)
- `npm run build` — production build to `dist/`
- `npm run zip` — build + package as `.zip` for distribution
- `npm test` — run all tests (`vitest run`)
- `npm run test:watch` — run tests in watch mode
- `npm run test:coverage` — run tests with V8 coverage

## Architecture

- `entrypoints/background/` — MV3 service worker (SSE realtime, API calls, sync)
- `entrypoints/app/` — main UI (React SPA opened as a tab)
- `src/` — shared code (hooks, components, DB, lib utilities, types)
- `test/` — all tests (unit, integration, regression, UI smoke)

## Testing requirements

**Every new feature and bug fix must include tests.** This is non-negotiable.

- Tests live in `test/` — organized as `unit/`, `integration/`, `regressions/`, and `ui/`
- Test runner: Vitest with globals enabled (`describe`, `it`, `expect` are global)
- Default environment is `node`; component/hook tests use `// @vitest-environment jsdom` at the top of the file
- Chrome APIs are mocked globally via `test/mocks/chrome.ts` — add new API mocks there when needed
- Fetch is mocked via `test/mocks/fetch.ts`
- IndexedDB is provided by `fake-indexeddb`
- Regression tests are numbered sequentially (e.g., `56-azerty-keyboard-shortcuts.dom.test.tsx`)
- Run `npm test` before committing to verify nothing is broken

## Release process

1. Update `CHANGELOG.md` with the new version section, then run
   `npm run changelog:site` to regenerate the page on inflow.im
   (`npm test` fails if you forget)
2. `npm version <patch|minor|major>` — bumps `package.json` + creates `vX.Y.Z` tag
   - **Beta releases**: `npm version 0.X.0-beta.N` — the hyphenated tag makes CI
     mark the GitHub Release as a prerelease and SKIP both store publishes
     (Chrome manifest gets the base version; the full string lands in
     `version_name`). Ship the same content to stores later by tagging the
     bare version.
3. `git push --follow-tags` — triggers the GitHub Actions release workflow
4. CI runs tests, builds both zips, creates a GitHub Release, and uploads +
   publishes the store build to the Chrome Web Store automatically
   (see `docs/chrome-web-store-release.md` for the required secrets)

   **Never run `npm run zip:store` locally without rebuilding after.** It
   writes `dist/chrome-mv3/` in place with the manifest `key` omitted (the
   store rejects uploads carrying one), so Chrome gives the unpacked build a
   path-derived ID instead of the pinned one — the app shell stops recognising
   it and it loads against an empty database. `npm run build` puts the key
   back. CI is unaffected: it builds each zip in a fresh checkout.
5. The site (inflow.im) deploys automatically on push — the Vercel project is
   connected to this GitHub repo (since 0.5.1; before that, deploys were
   manual and the live changelog went stale). Manual fallback: run from the
   **repo root** (the project's root-directory setting is `site`, so running
   inside `site/` fails looking for `site/site`):
   `VERCEL_ORG_ID=team_KLSLe39H0laAoEpSRLqEoH6W VERCEL_PROJECT_ID=prj_4MRzBhL20cBHjxWnTn4NF1j6us37 npx vercel --prod --yes`

## Testing the app shell locally

`inflow.im/app` embeds the extension in a cross-origin iframe, which Chrome
only allows for the origins in `web_accessible_resources` /
`externally_connectable`, and which the background's own origin gate checks
again. `INFLOW_LOCAL_SHELL=1` adds localhost to all three:

```
npm run dev:shell     # build with localhost allowed — then RELOAD the
                      # unpacked extension, or the old manifest sticks
npm run site:dev      # vercel dev on :8765
open http://localhost:8765/app?ext=dev
```

`?ext=dev` pins the probe to the unpacked build's ID. A plain `npm run build`
strips localhost again, so a later rebuild silently breaks the local shell —
that is the first thing to check when the frame stops loading.

**The service worker will serve you a stale shell.** `site/app-sw.js` caches
`/app` stale-while-revalidate, so the load after any edit to `site/app.html`
runs the *previous* copy and only the one after that picks up the change.
Debugging the shell against a mix of old and new is deeply confusing; hard-
reload twice, or unregister the worker in DevTools › Application, before
concluding anything about shell behaviour.

## Marketing site

`site/` is a static site deployed to https://inflow.im on Vercel (personal
scope, project `inflow`, **root directory `site`** — the repo root would build
the extension instead). `site/changelog.html` is generated from `CHANGELOG.md`
by `scripts/build-changelog.mjs`; edit the markdown, never the release list
between the `CHANGELOG:START` / `CHANGELOG:END` markers. Run `npx vercel dev --listen 8765` from `site/` to serve
it locally with production's clean-URL routing; a plain static server 404s on
`/changelog` and `/privacy`.

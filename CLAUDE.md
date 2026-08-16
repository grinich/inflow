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
3. `git push --follow-tags` — triggers the GitHub Actions release workflow
4. CI runs tests, builds both zips, creates a GitHub Release, and uploads +
   publishes the store build to the Chrome Web Store automatically
   (see `docs/chrome-web-store-release.md` for the required secrets)

## Marketing site

`site/` is a static site deployed to https://inflow.im on Vercel (personal
scope, project `inflow`, **root directory `site`** — the repo root would build
the extension instead). `site/changelog.html` is generated from `CHANGELOG.md`
by `scripts/build-changelog.mjs`; edit the markdown, never the release list
between the `CHANGELOG:START` / `CHANGELOG:END` markers. Run `npx vercel dev --listen 8765` from `site/` to serve
it locally with production's clean-URL routing; a plain static server 404s on
`/changelog` and `/privacy`.

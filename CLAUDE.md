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

Ship small and often — normally bump the **patch** each release (`0.5.1`, `0.5.2`, …); reserve minor/major for larger milestones.

1. Update `CHANGELOG.md` with the new `## [x.y.z] - DATE` section (the What's-new modal reads these — see `src/lib/changelog.ts`)
2. `npm version <patch|minor|major>` — bumps `package.json` + creates `vX.Y.Z` tag (keep this 3-part semver)
3. `git push --follow-tags` — triggers the GitHub Actions release workflow
4. CI runs tests, builds the zip, and creates a GitHub Release with release notes from the changelog

### Versioning note

`package.json`, git tags, and the changelog stay clean 3-part semver (`0.5.1`). The **manifest** `version` gets a 4th auto build segment on **every** build (dev and prod) so the chrome://extensions card always shows a changing number — `0.5.1.<build>` (e.g. `0.5.1.461`). The build number is `GITHUB_RUN_NUMBER` in CI, otherwise the local **git commit count** (`APP_VERSION`/`commitCount()` in `wxt.config.ts`). Dev also appends `-dev+<sha>` in `version_name`. App code that reasons about versions (What's-new, update check) normalizes with `coreVersion()` from `src/lib/update.ts`. Chrome segment rules: 1–4 integers, each `0–65535`, no leading zeros.

<p align="center">
  <img src="assets/screenshot-light.png" alt="inflow — light theme conversation view" width="100%">
</p>

# inflow

An experimental Chrome extension that reimagines LinkedIn messaging with a keyboard-driven, local-first UI. Built as a personal project to explore browser extension development with React, IndexedDB, and real-time streaming.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ndehgbgifkapdigmefglpgacpagoclge">
    <img src="assets/add-to-chrome.svg" alt="Add inflow to Chrome" height="58">
  </a>
</p>

## Install

You need Google Chrome or any Chromium-based browser (Edge, Arc, Brave, etc.).

### Option A — Chrome Web Store (recommended)

**[Add inflow to Chrome](https://chromewebstore.google.com/detail/ndehgbgifkapdigmefglpgacpagoclge)** —
one click, and Chrome keeps it up to date on its own.

The two manual paths below still work, and are what you want if you're hacking
on inflow. Note that Chrome gives a manually loaded build a different extension
ID than the store one, so the two are separate installs with separate local
databases; running both means syncing twice.

### Option B — Download a release (no build tools needed)

1. Go to the [latest release](https://github.com/grinich/inflow/releases/latest)
   and download `inflow-<version>-chrome.zip`.
2. Unzip it somewhere you'll keep it (the folder is the extension — don't delete it).
3. Open `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.

### Option C — Build from source

Requires [Node.js](https://nodejs.org/) 18+ and npm.

```sh
git clone https://github.com/grinich/inflow.git
cd inflow
npm install
npm run build
```

Then **Load unpacked** the `dist/chrome-mv3` folder at `chrome://extensions`
(with Developer mode on).

### After loading (either option)

1. Sign into LinkedIn in any tab.
2. Open [inflow.im/app](https://inflow.im/app), or click the inflow icon in
   the toolbar (pin it for easy access). From inflow.im/app you can also
   install inflow as a standalone desktop app (Chrome menu → *Install inflow*).

inflow notifies you in-app when a new release is out — see [Updating](#updating).

## Features

<table>
  <tr>
    <td><img src="assets/screenshot-dark.png" alt="Dark theme conversation view" width="100%"></td>
    <td><img src="assets/screenshot-shortcuts.png" alt="Keyboard shortcuts overlay" width="100%"></td>
  </tr>
</table>

### Messaging
- Send, receive, edit, and unsend messages with file attachments
- Optimistic sending with instant UI updates; offline actions queue and replay when back online
- Emoji reactions, read receipts, shared-post previews, and draft auto-save
- Reply to a specific message, with reply-to indicators and edited-message timestamps
- Emoji shortcode autocomplete (`:smile`) and paste-to-attach for images
- New conversation composer with typeahead recipient search

### AI assist (optional, Gemini)
- Reply suggestions for incoming messages
- Inline autocomplete while composing
- Bring your own Gemini API key (set it in the app); off until configured
- **Privacy note:** when enabled, message text and participant names from the active conversation are sent to Google's Gemini API to generate suggestions. See [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms). AI features are off until you add a key.

### Inbox
- Four tabs: Focused, Other, Archived, Spam
- Star, archive, move to Other, mark read/unread, mark as spam, delete
- One-click unread quick-filter toggle
- Undo for destructive actions
- Per-account IndexedDB (supports multiple LinkedIn accounts)

### Search
- Real-time local filtering across names, messages, and metadata
- Server-side LinkedIn search with pagination
- Filter autocomplete with Tab/Enter completion

| Filter | Description |
|--------|-------------|
| `is:unread` | Unread conversations |
| `is:read` | Read conversations |
| `is:starred` | Starred conversations |
| `is:group` | Group conversations |
| `has:attachment` | Has attachments |
| `has:draft` | Has an unsent draft |
| `from:name` | Filter by sender |
| `after:YYYY-MM-DD` | Active after date |
| `before:YYYY-MM-DD` | Active before date |
| `newer:Nd` | Active within the last N days |
| `older:Nd` | Inactive for at least N days |

### Network
- View incoming connection requests with their notes; accept or ignore without leaving the keyboard
- Browse recent connections sorted by recency or name, with instant filtering
- One-keystroke "message this connection" that drops into the composer
- `G N` to open, `1` / `2` / `Tab` to switch Invitations / Connections, `Enter` to accept/message, `D` / `X` / `⌫` to ignore, `P` to open a profile, `Esc` back to the inbox
- Routed by the URL hash — `app.html#/network` deep-links straight in, and Chrome's back button returns to the inbox

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `J` / `K` | Navigate conversations |
| `Enter` | Open conversation |
| `1` / `2` / `3` / `4` | Jump to Focused / Other / Archived / Spam |
| `G S` / `G U` | Go to starred / unread |
| `G N` | Go to Network (invitations & connections) |
| `R` | Reply (focus compose) |
| `Enter` | Send message (in compose) |
| `⌘+Enter` | Send + archive |
| `Shift+Enter` | New line |
| `Escape` | Back to list |
| `E` | Archive (un-archive / move to Focused in Archived tab) |
| `O` | Move to Other |
| `S` | Star / unstar |
| `U` | Toggle read / unread |
| `Shift+U` | Mark unread & go back (in thread) |
| `!` | Mark as spam |
| `P` | Open sender's LinkedIn profile |
| `D` | Delete conversation |
| `C` | Compose new message |
| `/` | Focus search |
| `Cmd+K` | Command palette |
| `Z` | Undo last action |
| `?` | Show all shortcuts |

### Sync engine
- 30-second background polling with SSE real-time updates
- Multi-category discovery (Focused, Other, Archived, Spam)
- Priority-based message backfill with configurable depth
- Scroll-triggered burst discovery and idle prefetch
- Pause / resume controls

### Thread view
- Grouped message bubbles with time separators
- Emoji reactions and read-receipt indicators
- Image lightbox, file downloads, audio/video attachments
- Light / dark / system theme

### Debug panel
- Real-time sync progress and error logs
- Diagnostic API report
- Database stats and reset controls
- Configurable backfill window

> **This project is not affiliated with, endorsed by, or associated with LinkedIn or Microsoft.**

## Disclaimer

This extension uses LinkedIn's undocumented internal APIs to read and send messages through your existing browser session. **This may violate LinkedIn's [User Agreement](https://www.linkedin.com/legal/user-agreement)** and could result in account restrictions.

This software is provided as-is for **personal and educational use only**. The author assumes no responsibility for any consequences of using it, including account suspension or data loss. Use at your own risk.

## Updating

**Installed from the Chrome Web Store?** Chrome updates inflow on its own —
there is nothing to do.

A manually loaded copy never updates itself. inflow shows a banner pointing at
the store listing; moving there is the one-time fix. Because Chrome treats the
store build as a separate extension, it starts with an empty local database and
re-syncs your conversations from LinkedIn — unsent drafts and your Gemini API
key do not carry over.

To stay on a manual install:

**A. Download the latest build** — grab `inflow-<version>-chrome.zip` from the
[latest release](https://github.com/grinich/inflow/releases/latest), unzip it,
and load the unzipped folder (or replace your existing one) at `chrome://extensions`.

**B. Rebuild from source** (if you cloned the repo):

```sh
git pull
npm install
npm run build
```

Then go to `chrome://extensions` and click the reload button (↻) on the inflow
card. Your data is stored locally and is preserved across updates — the
extension uses a fixed ID, so reinstalling or moving the folder keeps your
conversations and settings.

## Development

```sh
npm run dev
```

Starts a dev server with hot reload. The extension auto-reloads in Chrome on save.

## Releasing (maintainers)

The version lives in `package.json` (WXT reads it for the manifest). To cut a release:

```sh
npm version minor   # or patch / major — bumps package.json and creates a vX.Y.Z tag
git push --follow-tags
```

Pushing the tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which runs the tests, builds the extension, publishes a GitHub Release with
auto-generated notes and the `inflow-<version>-chrome.zip` attached, and then
uploads and publishes the store build to the Chrome Web Store. Store users get
it automatically once review clears. See
[docs/chrome-web-store-release.md](docs/chrome-web-store-release.md) for the
one-time OAuth setup.

> The extension ID is pinned by a public `key` in the manifest. The matching
> private key (`inflow-signing-key.pem`) is gitignored and only needed for `.crx`
> signing — keep a copy somewhere safe if you ever want it.

### Chrome Web Store builds

The Chrome Web Store signs packages itself and rejects any upload whose manifest
carries a `key` field, so store packages are built separately:

```sh
npm run zip:store   # → dist/inflow-<version>-chrome-store.zip, no `key`
```

Because the store assigns its own extension ID, a store install is a different
origin than a sideloaded one: it starts with an empty database and cannot inherit
conversations from an unpacked install. Upload only the `-store.zip`; the plain
`inflow-<version>-chrome.zip` is the GitHub release artifact for `Load unpacked`.

## Architecture

Chrome extension (Manifest V3) built with:

- **WXT** — extension framework
- **React 19** — UI
- **Dexie / IndexedDB** — per-account local storage with live queries
- **Zustand** — state management
- **Tailwind CSS v4** — styling
- **SSE** — real-time message streaming

## License

MIT

# inflow

An experimental Chrome extension that reimagines LinkedIn messaging with a keyboard-driven, local-first UI. Built as a personal project to explore browser extension development with React, IndexedDB, and real-time streaming.

> **This project is not affiliated with, endorsed by, or associated with LinkedIn or Microsoft.**

## Disclaimer

This extension uses LinkedIn's undocumented internal APIs to read and send messages through your existing browser session. **This may violate LinkedIn's [User Agreement](https://www.linkedin.com/legal/user-agreement)** and could result in account restrictions.

This software is provided as-is for **personal and educational use only**. The author assumes no responsibility for any consequences of using it, including account suspension or data loss. Use at your own risk.

## Building from source

Requires Node.js 18+.

```sh
git clone https://github.com/mgrinich/inflow.git
cd inflow
npm install
npm run build
```

This produces an unpacked extension in `dist/chrome-mv3/`.

## Installing in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select the `dist/chrome-mv3` folder
4. Sign into LinkedIn in any tab
5. Click the inflow icon in the toolbar

## Development

```sh
npm run dev
```

Starts a dev server with hot reload. The extension auto-reloads in Chrome on save.

## Features

### Messaging
- Send, receive, and edit messages with file attachments
- Optimistic sending with instant UI updates
- Read receipts, shared post previews, and draft auto-save
- Paste-to-attach for images
- New conversation composer with typeahead search

### Inbox
- Four tabs: Focused, Other, Archived, Spam
- Star, archive, move, mark read/unread, delete
- Undo for destructive actions
- Per-account IndexedDB (supports multiple LinkedIn accounts)

### Search
- Real-time local filtering across names, messages, and metadata
- Server-side LinkedIn search with pagination
- Filter autocomplete with Tab/Enter completion

| Filter | Description |
|--------|-------------|
| `is:unread` | Unread conversations |
| `is:starred` | Starred conversations |
| `is:group` | Group conversations |
| `has:attachment` | Has attachments |
| `from:name` | Filter by sender |
| `company:name` | Filter by company |
| `after:YYYY-MM-DD` | Active after date |
| `newer:Nd` | Active within N days |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `J` / `K` | Navigate conversations |
| `Enter` | Open thread |
| `R` | Reply |
| `Escape` | Back to list |
| `E` | Archive |
| `S` | Star / unstar |
| `U` | Toggle read / unread |
| `C` | Compose new message |
| `/` | Focus search |
| `Cmd+K` | Command palette |
| `Z` | Undo |
| `?` | Show all shortcuts |

### Sync engine
- 30-second background polling with SSE real-time updates
- Multi-category discovery (Focused, Other, Archived, Spam)
- Priority-based message backfill with configurable depth
- Scroll-triggered burst discovery and idle prefetch
- Pause / resume controls

### Thread view
- Grouped message bubbles with time separators
- Image lightbox, file downloads, audio/video attachments
- Profile enrichment: company, title, logo badge, location
- Reply-to indicators and edited message timestamps

### Debug panel
- Real-time sync progress and error logs
- Diagnostic API report
- Database stats and reset controls
- Configurable backfill window

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

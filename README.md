# Inflow — LinkedIn Messaging Client

A keyboard-driven Chrome extension for LinkedIn messaging. Fast, local-first, and designed for power users.

## Features

### Messaging
- **Send & receive messages** with text and file attachments (images, PDFs, videos, audio)
- **Edit sent messages** with edit timestamp indicator
- **Optimistic sending** — messages appear instantly, sync in the background
- **Read receipts** — double checkmarks when messages are seen
- **Shared LinkedIn posts** — inline preview cards with author, text, and images
- **Draft auto-save** — text drafts persist in localStorage, file drafts in IndexedDB
- **Paste-to-attach** — paste images directly into the composer
- **New conversation composer** — start conversations with typeahead recipient search

### Inbox Management
- **Four inbox tabs** — Focused, Other, Archived, Spam (keys `1`–`4`)
- **Star conversations** — mark important threads
- **Archive / move / mark read/unread / delete** — all from keyboard or context menu
- **Undo actions** — toast notification with undo for destructive actions
- **Optimistic updates** — UI updates instantly, rolls back on API failure

### Search & Filtering
- **Local search** — real-time filtering across participant names and last message
- **Remote search** — server-side LinkedIn search with pagination
- **Autocomplete dropdown** — filter suggestions with Tab/Enter completion and arrow key navigation
- **Conversation count** — search placeholder shows total conversations in section

| Filter | Description |
|--------|-------------|
| `is:unread` | Unread conversations |
| `is:read` | Read conversations |
| `is:starred` | Starred conversations |
| `is:group` | Group conversations (2+ participants) |
| `has:attachment` | Conversations with attachments |
| `from:name` | Filter by participant name |
| `company:name` | Filter by current company |
| `after:YYYY-MM-DD` | Active after date |
| `before:YYYY-MM-DD` | Active before date |
| `newer:Nd` | Active within N days (e.g. `newer:7d`) |
| `older:Nd` | Inactive for N days (e.g. `older:30d`) |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `J` / `↓` | Move selection down |
| `K` / `↑` | Move selection up |
| `Enter` | Open conversation |
| `R` | Reply (focus composer) |
| `Escape` | Go back to list |
| `E` | Archive |
| `O` | Move to Other |
| `S` | Star / unstar |
| `U` | Toggle read / unread |
| `D` | Delete (with confirmation) |
| `!` | Mark as spam |
| `C` | Compose new message |
| `/` | Focus search |
| `Cmd+K` | Command palette |
| `Z` | Undo last action |
| `?` | Show shortcuts overlay |
| `1`–`4` | Switch inbox tabs |
| `Tab` / `Shift+Tab` | Cycle tabs |
| `Shift+U` | Mark unread & go back |

### Command Palette
- `Cmd+K` to open — searchable list of all actions
- Quick access to archive, move, reply, compose, sync, theme, and navigation commands
- Fuzzy matching across command names and descriptions

### Sync Engine
- **Continuous background sync** — 30-second polling with alarm-driven coordination
- **Multi-category discovery** — async discovery for Focused, Other, Archived, Spam
- **Message backfill** — automatic paginated fetch with configurable age window (7d–180d)
- **Priority queue** — newest conversations synced first
- **Burst discovery** — rapid on-demand discovery triggered by scrolling to the bottom
- **Scroll-idle prefetch** — when scrolling stops, visible conversations without cached messages are prefetched in parallel
- **Shared post prefetch** — background fetch of LinkedIn post data for inline previews
- **Rate limiting** — delays between API calls to avoid throttling
- **Failure recovery** — automatic retry with backoff for failed sync items
- **Pause / resume** — pause sync during debugging

### Thread View
- **Message bubbles** — blue for sent, neutral for received
- **Grouped messages** — consecutive messages from same sender collapsed
- **Time separators** — visual breaks for 30+ minute gaps
- **Image lightbox** — click images to view full-size
- **File attachments** — name, size, and download link
- **Auto-scroll** — scroll to latest message, preserve position on image load
- **Profile header** — participant name, occupation, location with LinkedIn link
- **Company & title** — current position fetched via Voyager API, shown below name
- **Company logo badge** — overlaid on profile avatar in both conversation list and thread header

### Profile Enrichment
- **Current company & job title** — fetched from LinkedIn's Voyager profile positions API
- **Company logo** — extracted from company entity, displayed as avatar badge
- **Location** — scraped from profile page HTML, US addresses shortened to city/state
- **On-demand enrichment** — triggered when opening a thread or receiving an inbound message
- **Persistent storage** — enriched fields preserved across sync cycles via merge-on-write

### Themes
- **Dark / Light / System** — three theme modes
- **Cycle with UI button** or keyboard
- **Persisted** in localStorage

### Media & Caching
- **Image cache** — in-memory + IndexedDB with ref-counting and TTL
- **Lazy loading** — images fetched on-demand when visible (IntersectionObserver)
- **Concurrent limit** — max 6 simultaneous image loads
- **Profile photo preloading** — batch preload for visible conversation rows
- **Post data cache** — shared LinkedIn post content cached with 7-day TTL

### Debug & Diagnostics
- **Debug panel** — sync progress, error logs, database stats
- **Diagnostic sync report** — detailed API and schema inspection
- **Log filtering** — filter by level (all / errors only)
- **Database reset** — clear all tables and re-sync
- **Backfill window control** — configure sync depth (7d, 30d, 90d, 180d)

### Data & Storage
- **IndexedDB** via Dexie — 10-version schema with indexed conversations, messages, profiles
- **Sync queue** — per-conversation sync status tracking
- **Draft attachments** — file blobs persisted across sessions
- **Pending actions** — track in-flight operations for rollback

## Architecture

Chrome extension (Manifest V3) built with:
- **WXT** — extension framework
- **React** — UI components
- **Dexie** — IndexedDB wrapper with live queries
- **Zustand** — state management
- **Tailwind CSS** — styling
- **LinkedIn Voyager API** — GraphQL messaging API via session cookies

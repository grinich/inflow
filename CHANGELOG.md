# Changelog

All notable changes to inflow are documented here. This project follows
[semantic versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/).

## [0.4.0] - 2026-07-13

### Added
- **Sender avatars in notifications** — native Chrome notifications now show
  the sender's profile picture (circle-cropped) instead of the generic app
  icon, with the app icon as fallback when the avatar can't be loaded.
  Requires a new `media.licdn.com` host permission.
- **Avatar rail on narrow windows** — below 700px window width the
  conversation list collapses to a compact avatar-only rail (unread dot and
  star badges, name + preview on hover) so the thread keeps usable width.
  Keyboard navigation works unchanged.
- **Demo mode fires native notifications** — simulated incoming messages now
  produce real OS notifications (when the app isn't focused), matching
  production behavior.

### Fixed
- **Thread pane layout at narrow widths** — the contact name no longer
  overflows into the header buttons, header buttons no longer wrap or clip,
  and message bubbles are no longer squeezed by the invisible hover-actions
  strip (which also no longer intercepts clicks while hidden).
- **Missed notifications after switching apps** — notifications were wrongly
  suppressed when inflow was the active tab but Chrome wasn't the frontmost
  app. Suppression now requires the window to actually have OS focus.
- **Composer stays focused after sending a message.**
- **Rate limits and network blips no longer pile up as errors** in
  chrome://extensions — transient failures (timeouts, dropped connections,
  HTTP 429/5xx) log as warnings and recover on their own.

### Changed
- **Removed profile scraping** — the extension no longer calls LinkedIn's
  identity API. Everything shown (names, avatars, headline, location) comes
  from messaging data. Company/title display, the company logo badges, and
  the `company:` search filter are gone; demo mode people no longer have
  fabricated companies or roles.

## [0.3.6] - 2026-07-10

### Fixed
- **Notification clicks now open the right conversation** — clicking a native
  message notification (or the in-app toast) opens the app focused on that
  specific thread instead of just raising the window.
- **Mark-as-read now reliably syncs to LinkedIn** — outbound read/unread
  requests are checked against the response body, so a silently-rejected
  batch update surfaces as an error instead of appearing to succeed.
- **Read/unread toggled on LinkedIn now reflects in inflow** — a thread marked
  read or unread on another device is reconciled from the authoritative server
  flag for any conversation, not just the top of the focused inbox. Optimistic
  local state is preserved while a mutation is in flight.

### Changed
- Redundant conversation refetches triggered by realtime echoes are coalesced
  into far fewer network calls.

## [0.3.5] - 2026-07-05

### Added
- **Resizable sidebar** — drag the divider between the conversation list and
  the thread to resize it (280px up to 60% of the window); double-click the
  divider to reset. Your chosen width persists across sessions. Thanks
  @sharkymark for the suggestion (#6).
- When the sidebar is narrow, the Focused/Other/Archive/Spam tabs collapse
  into a compact dropdown so the header never overflows.

### Changed
- README: install steps moved to the top (#7) and screenshots now illustrate
  the feature tour.

## [0.3.4] - 2026-07-05

### Fixed
- **Blank app on load** — opening inflow could intermittently show an empty
  conversation list until a (lucky) reload. The first render raced the local
  database opening; queries that lost the race never recovered. They now
  reconnect the moment the database is ready.

### Changed
- **Much faster folder switching** — the conversation list now renders only
  the rows in view instead of every conversation in the folder, batches its
  per-row lookups, and skips re-rendering unchanged rows during background
  sync. Switching between Focused/Other/Archived/Spam is instant even with
  hundreds of conversations, and revisiting a folder paints immediately from
  memory.

## [0.3.3] - 2026-07-05

### Fixed
- **Duplicate bubble after sending** — a message you just sent could briefly
  show twice (the copy stored from the send response and the realtime echo
  carry timestamps a few ms apart) until the next thread refresh reconciled
  it. The two copies now collapse immediately.

## [0.3.2] - 2026-07-05

A deep sync-consistency release: a systematic audit of everything flowing
between LinkedIn and inflow, with 31 fixes — each locked in by a regression
test (the suite grew to 656 tests).

### Added
- **Cross-device star sync** — starring or unstarring a conversation on the
  LinkedIn website or your phone now updates inflow live, in both directions.
- **Unsend sync** — when someone unsends a message, it disappears from inflow
  immediately instead of lingering until the next refetch. Previously-stored
  copies of recalled messages are cleaned up too.
- **Deletion sync** — conversations you delete on the LinkedIn website (or
  another device) are now removed from inflow instead of living there forever.
  Conservative by design: a conversation must be absent from two consecutive
  full syncs before it's removed.

### Fixed
- **Unread accuracy** — a batch of fixes for unread indicators that were wrong
  or stuck:
  - A sync page fetched moments before a new message arrived could clear the
    unread dot for a message you never saw.
  - Someone editing or reacting to an *old* message no longer marks the thread
    unread, pulls it out of Archive, or fires a "new message" notification.
  - Duplicate threads with the same person (InMail + regular) are shown merged,
    but the hidden twin's unread could never be cleared — the thread stayed
    unread forever and inflated the badge.
  - The toolbar badge now counts exactly what the Focused list shows.
- **Message ordering and timestamps** — sent messages now get their real server
  timestamp immediately from the send response instead of the local clock, and
  a skewed system clock can no longer make the background sync silently skip
  newly arrived messages.
- **Group chats** — a message from a participant we hadn't synced yet could
  render as "You" and later show duplicated. Senders are now resolved from the
  event itself.
- **Folder consistency** — moving an archived conversation to Other or Spam no
  longer leaves it visible in Archived as well, and archive followed by a quick
  undo can no longer land on LinkedIn out of order and snap back.
- **Deleted conversations stay deleted** — a sync page fetched just before a
  local delete could silently resurrect the conversation.
- **Unsent messages** no longer leave an orphaned timestamp in the thread when
  they were the only message under it.
- **Shared post previews** refresh after a week — a post that failed to load
  once was cached as missing forever.
- **Large mailboxes** — the initial full sync no longer monopolizes the sync
  engine for hours; it works in short rounds so read-state reconciliation keeps
  running throughout.
- **Sign-in after startup** — interrupted sync items now recover on the next
  cycle instead of waiting for a browser restart; same after an account switch.
- **Toolbar icon clicks while dragging a tab** no longer error and do nothing —
  the click retries once the drag ends.

### Changed
- Database schema v12 (automatic, data-preserving migration).

## [0.3.1] - 2026-06-27

### Fixed
- **Compose to new contacts** — sending a first message to a recently connected
  person no longer fails with a misleading "not connected" error. The
  `createMessage` payload was missing a required field (`hostRecipientUrns`).

## [0.3.0] - 2026-06-27

### Added
- **Check for updates** command in the command palette (`Cmd+K`) for an on-demand
  release check.
- The running version is now shown on the keyboard shortcuts bar.

### Fixed
- Update checks now run reliably — the GitHub API host is declared, so the
  background check is no longer blocked.
- The `?` (shortcuts) and `!` (mark as spam) shortcuts now work on non-QWERTY
  keyboard layouts such as AZERTY. Thanks @qchuchu (#4).

### Removed
- The WhatsApp community top banner — the button in the conversation header
  already covers it.

## [0.2.0] - 2026-06-27

First public GitHub release, with in-app update notifications.

> [!IMPORTANT]
> **Existing users: this is a one-time fresh start.** This build pins a stable
> extension ID so all future updates preserve your data. Moving from an older
> build changes the extension's identity once, so inflow will open empty —
> re-enter your Gemini key (if you use AI features) and let it re-sync. This
> only happens this once; every release after this keeps your data.

### Added
- **Update notifications** — inflow now checks GitHub for new releases and shows
  a banner with a link to the release notes when an update is available.
- **GitHub Releases** — each version ships a downloadable `inflow-<version>-chrome.zip`.
- **Stable extension ID** — updates (zip download or rebuild) now preserve your
  conversations and settings regardless of where the extension folder lives.
- New envelope app icon.

### Fixed
- New conversations started from another device (e.g. your phone) no longer show
  the participant as "Unknown".
- A conversation read on another device now reflects as read in inflow, even
  while the realtime connection is active.

## [0.1.0]

Initial pre-release builds (shared informally before GitHub Releases).

[0.3.5]: https://github.com/grinich/inflow/releases/tag/v0.3.5
[0.3.4]: https://github.com/grinich/inflow/releases/tag/v0.3.4
[0.3.3]: https://github.com/grinich/inflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/grinich/inflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/grinich/inflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/grinich/inflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/grinich/inflow/releases/tag/v0.2.0

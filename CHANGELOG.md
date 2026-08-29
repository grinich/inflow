# Changelog

All notable changes to inflow are documented here. This project follows
[semantic versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **Clicking a notification opens the desktop app** — alerts were shown by the
  app *page*, and a page can't bring its own window forward while it's in the
  background, which is exactly the state you click a notification from. So
  clicking one did nothing. They now come from the app's service worker:
  clicking raises the installed app and opens the conversation, and because
  these notifications outlive the window that showed them, clicking one after
  you've closed the app launches it straight into that conversation. Clicking
  one of the extension's own fallback notifications also prefers the installed
  app over a stray extension tab.

  The *icon* on the notification is Chrome's own call and not something inflow
  can set: Chrome attributes every PWA notification to itself before Chrome
  152, and to the installed app — with its own entry in System Settings ›
  Notifications — from 152 on.
- **Restarting Chrome no longer strands the app on the install page** — the
  installed app window reopens at startup while the extension is still waking
  up, and inflow gave it one retry before settling on "Add to Chrome — it's
  free". Its other two retries fire when the window is focused or made
  visible, which a window that restored already focused and already visible
  never does, so the pitch stayed there until you clicked away and back. The
  page now keeps retrying on a backoff, and while the browser can see that the
  extension is installed it waits quietly rather than showing an install pitch
  to someone who already installed it.

## [0.6.0] - 2026-08-28

![The inƒlow app icon](https://inflow.im/icons/app-icon-192.png)

**inflow becomes an app.** It now lives at a real URL — [inflow.im/app](https://inflow.im/app) — and installs as a standalone desktop app with its own dock icon, unread badge, and native notifications. It also lands on Microsoft Edge. Underneath, 30 bugs found by a systematic audit of the composer, optimistic actions, caching, and realtime layers, each locked in by a regression test (the suite grew to 1,003 tests).

### Added
- **The app now lives at [inflow.im/app](https://inflow.im/app)** — a real,
  memorable URL instead of `chrome-extension://…/app.html`. The page embeds
  the extension full-screen (same local database, same everything), shows an
  install page when the extension isn't there yet, keeps working offline after
  the first visit, and can be installed as a standalone desktop app (dock
  icon and its own window) via Chrome's *Install inflow* menu item. The old
  extension URL keeps working.
- **Unread count on the dock icon** — when inflow is installed as a desktop
  app, the dock icon shows the number of unread Focused conversations (the
  same count as the toolbar badge); the browser-tab title shows it too, like
  `(3) inƒlow`.
- **Compose from the dock** — right-click the installed app's dock icon →
  *Compose new message* opens inflow with the new-message composer ready.
- **Native-feeling window** — the installed app draws edge-to-edge into the
  title bar (window-controls overlay) instead of showing a browser strip.
- **Smoother first run** — installing the extension now opens the inbox
  immediately instead of leaving you to find the toolbar icon.
- **Notifications carry the inflow identity in the installed app** — when the
  desktop app window is open (with notification permission granted), new-message
  alerts come from inƒlow with its own icon instead of being attributed to
  Chrome; clicking one focuses the app and opens the conversation. Without an
  app window they fall back to the extension's notifications as before.
- **inflow.im goes straight to your inbox** — with the extension installed,
  visiting the homepage redirects to [inflow.im/app](https://inflow.im/app);
  [inflow.im/home](https://inflow.im/home) always shows the homepage, which
  notices the install: the header button becomes *Open inƒlow →* and the
  install buttons give way to a green *Installed for Chrome* check that
  also opens the app.
  The inƒlow mark in the app's sidebar links back to the homepage.
- **inflow is coming to Microsoft Edge** — the extension is submitted to the
  Edge Add-ons store, and Edge installs update themselves from there like
  Chrome Web Store installs do (no "move to the store" prompt).
- **In-page install prompt** — the app page now offers a one-click *Install
  inƒlow as an app* chip when Chrome reports it installable, instead of
  leaving you to find the omnibox menu item.

### Fixed
- **Conversations in Other can move back to Focused** — the command palette,
  the thread list's right-click menu, the thread header's dropdown, and the
  `O` shortcut all showed only "Move to Other", even for conversations
  already there. Each now flips contextually to "Move to Focused" (and `O`
  toggles); archived and spam threads keep their existing routes back.
- **Notifications from the installed app work again** — the app asked for
  notification permission once and recorded the ask *before* you answered, so
  dismissing the prompt (rather than choosing Allow or Block) left permission
  undecided and permanently unaskable: every alert quietly fell back to one
  attributed to Chrome. The ask is now recorded only once you decide, and
  whenever permission is still undecided the app offers a *Turn on inƒlow
  notifications* button — so a browser tab, a dismissed prompt, and an install
  carrying the old flag can all still turn them on.
- **@-mentions in messages are now links** — a mentioned name used to render as
  plain text; it now links to the person's or company's LinkedIn profile.
- **Replying from LinkedIn web marks the thread read here too** — reading and
  replying elsewhere used to leave the conversation stuck unread in inflow.
- **Read receipts no longer go missing** — a ✓✓ that arrived before its message
  did was silently dropped, and realtime updates could wipe stored receipts,
  reactions, and edit markers off messages that already had them.
- **Attachment-only messages get a real preview** — an image or file with no
  text showed "New message" in the list instead of "Sent an image".
- **Drafts stop disappearing** — navigating past a conversation faster than its
  draft loaded deleted that draft, a slow load could overwrite text typed while
  it was in flight, and adding or removing a recipient wiped a new message's
  draft and attachments outright.
- **Failed actions undo themselves correctly** — a failed reaction, edit,
  archive, or star could revert a *different*, successful change made moments
  later; a failed send-and-archive left the conversation archived with no way
  back; and a failed archive could make a thread vanish from every tab at once.
- **A stalled network no longer logs you out** — a slow LinkedIn response was
  read as "signed out" and flashed the login screen. A hung attachment upload
  could also block every later send in that conversation until the extension
  restarted; it is now bounded.
- **Inline images render again** — images delivered in one of LinkedIn's URL
  shapes were dropped entirely, leaving an empty bubble.
- **AI replies got cheaper and smarter** — autocomplete fired a request on
  nearly every keystroke (~55 per reply); it now waits for a real pause, keeps
  the end of your draft rather than the beginning when asking for a completion,
  and stops predicting when you switch conversations.
- **Typing `3:1` no longer opens the emoji picker** and turns Enter into an
  emoji insert instead of a send.
- **Storage stops growing without bound** — cached profile photos and shared
  posts were never evicted.
- **A big inbox stops stuttering while addressing a message** — the recipient
  picker rescanned every profile and conversation on each typing pause.
- Fixed the reply shortcut leaving a merged conversation's hidden twin unread,
  a reply-suggestions spinner that could never stop, switching tabs mid-search
  showing the old tab's results, a long list rendering zero rows after it
  shrank, a search term next to a filter never matching, archived threads
  popping back into Focused, a corrupted sync setting silently meaning "sync
  everything", and closing a thread still marking it read.

### Security
- **Nothing can frame inflow.im** — the site now sends `frame-ancestors 'none'`
  and `X-Frame-Options: DENY`, since the /app shell holds your real inbox.
- **Fixed a service worker cache bug that broke the installed app** — any
  in-scope URL (such as the web manifest) could poison the shell's cache,
  breaking the app window and Chrome's install check.
- Prompt-building now strips nested tags repeatedly, so message text cannot
  reassemble a tag and break out of the untrusted-data block sent to the model.

## [0.5.2] - 2026-08-25

### Added
- **inflow badge on notification icons** — native message notifications now
  show the inflow logo badged in the corner of the sender's avatar, so it's
  clear at a glance which app the alert came from. (The large icon next to a
  notification is always Chrome's own logo — the OS puts it there for every
  extension.)

## [0.5.1] - 2026-08-24

### Fixed
- **Video messages were invisible** — LinkedIn delivers received videos as a
  reference to a separate video entity, not inline, so no attachment was
  extracted; with no body text the message rendered as nothing at all (worst
  when the video was the only message: the thread looked empty). The
  conversation preview was blank for the same reason and now says
  "Sent a video".

### Added
- **In-app video player** — videos show as a thumbnail with a play button and
  duration badge, and clicking plays them in a modal right in the window
  (Escape or a backdrop click closes it) instead of opening a new tab.

## [0.5.0] - 2026-08-16

### Added
- **inflow is on the Chrome Web Store** — installs from the store update
  themselves; releases are submitted automatically when a version tag is pushed.
  See [docs/chrome-web-store-release.md](docs/chrome-web-store-release.md).
- **inflow.im** — the changelog and privacy policy now have proper pages on the
  site instead of linking into GitHub.

### Changed
- **The update banner now moves manual installs to the store** — a sideloaded
  copy is told where to get automatic updates, with a note that the store build
  starts with an empty local database and re-syncs from LinkedIn. Store installs
  show no banner at all: they already update themselves, so the old "download
  the zip and reload the folder" advice was wrong there.

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

[0.6.0]: https://github.com/grinich/inflow/releases/tag/v0.6.0
[0.5.2]: https://github.com/grinich/inflow/releases/tag/v0.5.2
[0.5.1]: https://github.com/grinich/inflow/releases/tag/v0.5.1
[0.5.0]: https://github.com/grinich/inflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/grinich/inflow/releases/tag/v0.4.0
[0.3.6]: https://github.com/grinich/inflow/releases/tag/v0.3.6
[0.3.5]: https://github.com/grinich/inflow/releases/tag/v0.3.5
[0.3.4]: https://github.com/grinich/inflow/releases/tag/v0.3.4
[0.3.3]: https://github.com/grinich/inflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/grinich/inflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/grinich/inflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/grinich/inflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/grinich/inflow/releases/tag/v0.2.0

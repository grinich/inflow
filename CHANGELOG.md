# Changelog

All notable changes to inflow are documented here. This project follows
[semantic versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/).

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

[0.3.0]: https://github.com/grinich/inflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/grinich/inflow/releases/tag/v0.2.0

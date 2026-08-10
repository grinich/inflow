# Privacy Policy for inflow

_Last updated: 10 August 2026_

inflow is a Chrome extension that gives you a keyboard-driven inbox for your own
LinkedIn messages. It is an independent project and is **not affiliated with,
endorsed by, or associated with LinkedIn or Microsoft**.

## The short version

inflow has no backend. There is no inflow server, no account to create, and no
analytics. Your messages are read using the LinkedIn session already in your
browser and stored **only on your own computer**. The developer of inflow cannot
see your data.

## What data inflow handles

To show you your inbox, inflow reads and stores the following from your LinkedIn
account:

- **Personal communications** — the content of your LinkedIn messages, including
  message text, attachments, reactions, read receipts, and drafts you write.
- **Contact information** — the names, profile photos, headlines, and profile
  URLs of the people in your conversations, as returned by LinkedIn's messaging
  endpoints.
- **Authentication tokens** — the LinkedIn session cookies already present in
  your browser, read solely to authenticate requests to LinkedIn on your behalf.

inflow does **not** collect health information, financial or payment
information, location, web browsing history, or your personal communications
from any site other than LinkedIn.

## Where that data goes

**Stored locally on your device.** All conversation and message data lives in
IndexedDB and `chrome.storage.local` inside your browser profile, partitioned
per LinkedIn account. It is never uploaded to the developer or to any third
party for storage.

inflow makes network requests to exactly four hosts, and to no others:

| Host | Why | What is sent |
|------|-----|--------------|
| `www.linkedin.com` | Read and send your messages | Your existing LinkedIn session cookies |
| `media.licdn.com` | Fetch profile photos to show in desktop notifications | Nothing but the image URL |
| `generativelanguage.googleapis.com` | Optional AI reply suggestions (off by default) | See below |
| `api.github.com` | Check whether a newer version of inflow was released | Nothing about you — an unauthenticated public release lookup |

## Optional AI features (off by default)

inflow can suggest replies and autocomplete text while you compose. **These
features are disabled until you enter your own Google Gemini API key** in the
extension's settings.

When you enable them, the message text and participant names of the conversation
you are actively viewing are sent to Google's Gemini API under **your own API
key**, so that it can generate a suggestion. That data is handled by Google
under the [Gemini API terms](https://ai.google.dev/gemini-api/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy), not by inflow.
Removing your API key stops all such requests immediately.

## What inflow never does

- No selling or transfer of your data to third parties.
- No use of your data for advertising, profiling, or creditworthiness decisions.
- No transfer of your data for any purpose unrelated to showing you your inbox.
- No analytics, telemetry, crash reporting, or tracking of any kind.

## Deleting your data

Because everything is local, you are in full control:

- **Reset the database** — open inflow's debug panel and use the reset controls
  to clear all stored conversations and settings.
- **Uninstall the extension** — removing inflow from `chrome://extensions`
  deletes its IndexedDB databases and local storage along with it.

Deleting your local data does not affect your messages on LinkedIn itself.

## A note on LinkedIn's terms

inflow reads and sends messages through LinkedIn's own undocumented internal
APIs using your existing browser session. This may be inconsistent with
LinkedIn's [User Agreement](https://www.linkedin.com/legal/user-agreement) and
could put your LinkedIn account at risk of restriction. inflow is provided
as-is, for personal use, at your own risk.

## Changes to this policy

Any material change to how inflow handles data will be published in this file
and reflected in the extension's Chrome Web Store listing.

## Contact

Questions about this policy: open an issue at
<https://github.com/grinich/inflow/issues>.

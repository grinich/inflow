# Publishing to the Chrome Web Store

Pushing a `vX.Y.Z` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which creates the GitHub Release and then uploads the same build to the Chrome
Web Store and publishes it. Publication is automatic: the new version goes live
as soon as Google's review clears, with no further action.

The store listing is
[`ndehgbgifkapdigmefglpgacpagoclge`](https://chromewebstore.google.com/detail/ndehgbgifkapdigmefglpgacpagoclge).

## One-time setup

The workflow authenticates as you, through a Google OAuth client. Minting the
refresh token requires clicking through a consent screen, so it cannot be
automated — do it once, and the token keeps working until you revoke it.

### 1. Enable the API

In the [Google Cloud console](https://console.cloud.google.com/), create (or
pick) a project and enable **Chrome Web Store API** under *APIs & Services →
Library*.

### 2. Create an OAuth client

*APIs & Services → Credentials → Create credentials → OAuth client ID*.

- Application type: **Desktop app**
- Note the **Client ID** and **Client secret**

On the OAuth consent screen, add your own Google account (the one that owns the
store listing) as a **test user**. The app can stay in *Testing* — it is only
ever used by you.

> Publishing status matters: in *Testing*, refresh tokens expire after 7 days.
> Either move the consent screen to **In production** (no verification is needed
> for a private, single-user client) or expect to re-mint the token weekly.

### 3. Authorize, once

Open this URL in a browser, replacing `<CLIENT_ID>`, and approve the consent
screen:

```
https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/chromewebstore
```

Google shows an authorization **code**. Exchange it for a refresh token:

```sh
curl -sS -X POST https://oauth2.googleapis.com/token \
  -d client_id=<CLIENT_ID> \
  -d client_secret=<CLIENT_SECRET> \
  -d code=<CODE> \
  -d grant_type=authorization_code \
  -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
```

Copy `refresh_token` out of the response. It is shown once.

### 4. Store the secrets

In *Settings → Secrets and variables → Actions* on the repo, add:

| Secret | Value |
|--------|-------|
| `CWS_CLIENT_ID` | Client ID from step 2 |
| `CWS_CLIENT_SECRET` | Client secret from step 2 |
| `CWS_REFRESH_TOKEN` | Refresh token from step 3 |

The extension ID is not a secret — it is hardcoded in the workflow, since it is
the same ID that appears in the public listing URL.

## Cutting a release

Unchanged from before, plus the store step happening on its own:

1. Add the version's section to `CHANGELOG.md`, and mirror it into
   `site/changelog.html` so the site stays current.
2. `npm version <patch|minor|major>`
3. `git push --follow-tags`

The workflow then runs the tests, builds both zips, creates the GitHub Release
with the sideload zip attached, and uploads + publishes the store zip.

## When it fails

The store step is a separate job, so a failure there never rolls back the
GitHub Release — re-run just that job once fixed.

- **"Could not mint an access token"** — the refresh token was revoked or
  expired. Redo step 3. If this keeps happening weekly, the consent screen is
  still in *Testing*; move it to *In production*.
- **Upload rejected** — the response body carries the reason. The usual causes
  are a version that is not higher than the published one (the store refuses
  re-uploads of the same version) and a manifest that still carries a `key`
  field, which is why the store build uses `npm run zip:store`.
- **Review rejection** arrives by email from Google, not through the workflow.
  The uploaded draft stays in the dashboard; fix and push a new tag.

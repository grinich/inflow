# Publishing to the Chrome Web Store

Pushing a `vX.Y.Z` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which creates the GitHub Release and then uploads the same build to the Chrome
Web Store and publishes it. Publication is automatic: the new version goes live
as soon as Google's review clears, with no further action.

The store listing is
[`ndehgbgifkapdigmefglpgacpagoclge`](https://chromewebstore.google.com/detail/ndehgbgifkapdigmefglpgacpagoclge).

## One-time setup

The workflow authenticates as you, through a Google OAuth client, because the
Chrome Web Store API has no service-account path. Minting the refresh token
needs a consent screen click, so it cannot be fully automated — but everything
either side of that click is:

```sh
./scripts/setup-cws-secrets.sh
```

It prompts for the client ID and secret, opens the consent screen, catches the
callback itself, **verifies the token can actually reach the listing**, and
writes all three GitHub Actions secrets. Nothing touches disk or a command line,
so the values stay out of `ps`, your shell history, and any log.

There is no code to copy: Google blocked the out-of-band flow that older guides
describe (`redirect_uri=urn:ietf:wg:oauth:2.0:oob` now returns
`Error 400: invalid_request`), so `scripts/cws-oauth.py` serves the loopback
redirect that replaced it — a one-shot listener on `127.0.0.1` with a random
port, guarded by a `state` check. Desktop clients accept any loopback port
without registering it, so there is nothing to configure.

The ownership check is the part worth having: authorizing the wrong Google
account produces a token that looks perfectly valid and then fails deep inside a
release run. The script catches it before storing anything.

### What it needs first

An OAuth client of type **Desktop app**, in a Google Cloud project with the
**Chrome Web Store API** enabled.

Today that is the `xchat-releases` project, which already has the API enabled,
an OAuth consent screen set to **In production**, and a client named
`inflow-ci`. Reusing it is deliberate — the project is only a home for the
client, and a fresh one would mean redoing the API enable and the production
toggle for no benefit. The client is separate from `xchat-ci` so revoking one
extension's access does not break the other's releases.

If you ever start from nothing:

1. [Google Cloud console](https://console.cloud.google.com/) → *APIs & Services
   → Library* → enable **Chrome Web Store API**.
2. *Credentials → Create credentials → OAuth client ID* → **Desktop app**.
3. *Google Auth Platform → Audience* → set publishing status to **In
   production**. Leaving it in *Testing* expires the refresh token every 7 days,
   and releases start failing a week after they last worked.

Then run the script.

## Cutting a release

1. Add the version's section to `CHANGELOG.md`, then `npm run changelog:site`
   to regenerate the page on inflow.im (`npm test` fails if you forget).
2. `npm version <patch|minor|major>`
3. `git push --follow-tags`

CI runs the tests, builds both zips, creates the GitHub Release with the
sideload zip attached, and uploads + publishes the store zip.

## When it fails

The store step is a separate job, so a failure there never rolls back the GitHub
Release — fix the cause and re-run just that job.

- **"Could not mint an access token"** — the refresh token was revoked or
  expired. Re-run `./scripts/setup-cws-secrets.sh`. If this recurs weekly, the
  consent screen slipped back to *Testing*.
- **Upload rejected** — the reason is in the logged response body. The usual
  causes are a version that is not higher than the published one (the store
  refuses a re-upload of the same version) and a manifest still carrying a `key`
  field, which is why the store build goes through `npm run zip:store`.
- **Review rejection** arrives by email from Google, not through the workflow.
  The uploaded draft stays in the dashboard; fix it and push a new tag.

Revoke access any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Inflow.mcpb (Claude Desktop bundle)

CI builds `dist/Inflow.mcpb` (`npm run mcpb:build`) and attaches it to the
GitHub Release; the Agent Access modal's Download button points at the stable
`releases/latest/download/Inflow.mcpb` URL, so it starts resolving with the
first release that carries the asset. TODO: link it from inflow.im too.

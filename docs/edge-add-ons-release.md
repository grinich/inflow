# Publishing to Microsoft Edge Add-ons

Pushing a version tag runs `.github/workflows/release.yml`, whose
`edge-add-ons` job submits the same store zip the Chrome Web Store gets to
Microsoft Edge Add-ons. Until the secrets below are configured the job
**skips** (it does not fail), so releases work fine before the Edge listing
exists.

Edge itself can install extensions from the Chrome Web Store, and Brave and
Arc have no stores of their own (both install from CWS) — the Edge listing
exists for discoverability and a first-party install path for Edge users.

## One-time setup

1. **Register** (free) for the Microsoft Edge program in
   [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/).
2. **First submission is manual**: build the store artifact —
   `INFLOW_STORE_BUILD=1 npm run zip:store` → `dist/inflow-<version>-chrome-store.zip`
   (the only difference from the release zip is the stripped `key`; the
   manifest is browser-agnostic) — upload it in Partner Center, reuse the CWS
   listing copy/screenshots, and submit for review.
3. **Record the IDs**: the listing's **extension ID** (the CRX ID users' Edge
   installs will run under) and the **Product ID** (GUID, shown in Partner
   Center).
4. **Create API credentials**: Partner Center → *Publish API* →
   *Create API credentials* → Client ID + API key.
5. **Store the secrets**: run `./scripts/setup-edge-secrets.sh`
   (`EDGE_PRODUCT_ID` · `EDGE_CLIENT_ID` · `EDGE_API_KEY`).

## After the extension ID exists (code changes)

The Edge-store install runs under a new extension ID, which three places must
learn (all marked with comments):

- `src/lib/store-install.ts` — set `EDGE_STORE_EXTENSION_ID` (stops the
  store-migration banner from nagging Edge-store installs, and makes
  `storeUrlFor()` return the Edge listing).
- `site/app.html` — add the ID to the shell's probe `candidates`.
- `site/index.html` — add a `probe(...)` for it in the head script.

## What the workflow does

Mirrors the `chrome-web-store` job: rebuilds `npm run zip:store`, uploads the
zip to `POST /v1/products/$EDGE_PRODUCT_ID/submissions/draft/package`
(`Authorization: ApiKey` + `X-ClientID` headers, API v1.1), polls the returned
operation until the package is accepted, then `POST …/submissions` to create
the submission Microsoft reviews, and polls that too. Success shows
"Edge Add-ons: submitted for review" in the run summary; the listing updates
when Microsoft's review clears (arrives by email).

## When it fails

- **Skipped (secrets not configured)** — expected until step 5 above is done.
- **Upload not accepted / 401** — the API key expired (Partner Center shows
  the expiry). Create new credentials and re-run `setup-edge-secrets.sh`.
- **Package processing failed** — usually the version isn't higher than the
  listed one.
- **Publish not accepted** — an earlier submission is still in review or
  sitting as a draft in Partner Center; resolve it there first.
- **Review rejection** — arrives by email from Microsoft, not in the workflow.

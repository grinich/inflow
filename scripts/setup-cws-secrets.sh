#!/usr/bin/env bash
#
# One-time setup for automated Chrome Web Store publishing.
#
# Prompts for your Google OAuth client, walks you through the consent screen,
# exchanges the code for a refresh token, checks that the token can actually
# reach the inflow listing, and stores all three values as GitHub Actions
# secrets.
#
#   ./scripts/setup-cws-secrets.sh
#
# Nothing is written to disk and nothing is passed on a command line, so the
# values stay out of `ps`, your shell history, and any log. They live only in
# this process's memory and in GitHub's encrypted secret store.
#
# Prerequisites: an OAuth client of type "Desktop app" in a Google Cloud project
# with the Chrome Web Store API enabled. See docs/chrome-web-store-release.md.

set -euo pipefail

REPO="${REPO:-grinich/inflow}"
EXTENSION_ID="${EXTENSION_ID:-ndehgbgifkapdigmefglpgacpagoclge}"
REDIRECT="urn:ietf:wg:oauth:2.0:oob"
SCOPE="https://www.googleapis.com/auth/chromewebstore"

bold=$(tput bold 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '\n%s==>%s %s%s\n' "$green" "$reset" "$bold" "$1$reset"; }
fail() { printf '\n%sError:%s %s\n' "$red" "$reset" "$1" >&2; exit 1; }
note() { printf '%s%s%s\n' "$dim" "$1" "$reset"; }

# --- preflight ---------------------------------------------------------------

for cmd in curl python3 gh; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required but not installed."
done

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"

gh repo view "$REPO" >/dev/null 2>&1 ||
  fail "Cannot see $REPO with your gh account. Set REPO=owner/name if it moved."

step "Publishing $EXTENSION_ID from $REPO"

# --- 1. client credentials ---------------------------------------------------

step "Step 1 of 4 — OAuth client"
note "From Google Cloud console → APIs & Services → Credentials → your Desktop client."
printf '\n  Client ID: '
read -r CLIENT_ID
[ -n "$CLIENT_ID" ] || fail "Client ID cannot be empty."

printf '  Client secret (hidden): '
read -rs CLIENT_SECRET
printf '\n'
[ -n "$CLIENT_SECRET" ] || fail "Client secret cannot be empty."

# --- 2. consent --------------------------------------------------------------

AUTH_URL="https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}"

step "Step 2 of 4 — authorize"
note "Sign in as the Google account that OWNS the inflow store listing."
printf '\n%s\n\n' "$AUTH_URL"

if command -v open >/dev/null 2>&1; then
  printf '  Open this in your browser now? [Y/n] '
  read -r OPEN_IT
  case "${OPEN_IT:-y}" in [Yy]*|'') open "$AUTH_URL" >/dev/null 2>&1 || true ;; esac
fi

printf '\n  Authorization code: '
read -r AUTH_CODE
[ -n "$AUTH_CODE" ] || fail "Authorization code cannot be empty."

# --- 3. exchange -------------------------------------------------------------
# curl reads its config from stdin, so no value ever appears in argv.

step "Step 3 of 4 — exchanging the code for a refresh token"

TOKEN_JSON=$(
  printf 'url = "https://oauth2.googleapis.com/token"\ndata-urlencode = "client_id=%s"\ndata-urlencode = "client_secret=%s"\ndata-urlencode = "code=%s"\ndata-urlencode = "grant_type=authorization_code"\ndata-urlencode = "redirect_uri=%s"\nsilent\nshow-error\n' \
    "$CLIENT_ID" "$CLIENT_SECRET" "$AUTH_CODE" "$REDIRECT" |
  curl --config - || true
)

read_field() {
  printf '%s' "$TOKEN_JSON" | python3 -c \
    'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1" 2>/dev/null || true
}

REFRESH_TOKEN=$(read_field refresh_token)
ACCESS_TOKEN=$(read_field access_token)

if [ -z "$REFRESH_TOKEN" ]; then
  ERR=$(read_field error_description)
  [ -n "$ERR" ] || ERR=$(read_field error)
  [ -n "$ERR" ] || ERR="no refresh_token in the response"
  printf '\n%sThe exchange failed:%s %s\n' "$red" "$reset" "$ERR" >&2
  note "Authorization codes are single-use and expire within minutes — if you"
  note "reused one, or waited too long, start again from step 2."
  exit 1
fi

printf 'Got a refresh token.\n'

# --- 4. verify, then store ---------------------------------------------------
# Catches the failure that is otherwise invisible until a release run: the
# authorized account is a different Google account than the listing's owner.

step "Step 4 of 4 — checking the token can reach the listing"

ITEM_JSON=$(
  printf 'url = "https://www.googleapis.com/chromewebstore/v1.1/items/%s?projection=DRAFT"\nheader = "Authorization: Bearer %s"\nheader = "x-goog-api-version: 2"\nsilent\nshow-error\n' \
    "$EXTENSION_ID" "$ACCESS_TOKEN" |
  curl --config - || true
)

ITEM_ID=$(printf '%s' "$ITEM_JSON" | python3 -c \
  'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)

if [ "$ITEM_ID" != "$EXTENSION_ID" ]; then
  DETAIL=$(printf '%s' "$ITEM_JSON" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); e=d.get("error",d); print(e.get("message") or e.get("error_description") or json.dumps(d)[:300])' 2>/dev/null || true)
  printf '\n%sThat account cannot publish this extension.%s\n' "$red" "$reset" >&2
  printf '  %s\n\n' "${DETAIL:-unexpected response}" >&2
  note "Usually this means you authorized a different Google account than the one"
  note "that owns the listing. Nothing has been saved — re-run and sign in as the"
  note "publisher. (If the listing moved, set EXTENSION_ID=... when re-running.)"
  exit 1
fi

printf 'Confirmed: this account owns %s.\n' "$EXTENSION_ID"

step "Storing secrets on $REPO"

set_secret() {
  printf '%s' "$2" | gh secret set "$1" --repo "$REPO"
  printf '  %s set\n' "$1"
}

set_secret CWS_CLIENT_ID "$CLIENT_ID"
set_secret CWS_CLIENT_SECRET "$CLIENT_SECRET"
set_secret CWS_REFRESH_TOKEN "$REFRESH_TOKEN"

unset CLIENT_SECRET REFRESH_TOKEN ACCESS_TOKEN AUTH_CODE TOKEN_JSON

printf '\n%sDone.%s Releases now publish themselves.\n\n' "$green" "$reset"
note "Cut one with:  npm run changelog:site && npm version patch && git push --follow-tags"
note "The refresh token lasts until you revoke it at"
note "https://myaccount.google.com/permissions — provided the OAuth consent"
note "screen stays 'In production'. In 'Testing' it expires every 7 days."

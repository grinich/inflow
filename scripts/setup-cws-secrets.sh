#!/usr/bin/env bash
#
# One-time setup for automated Chrome Web Store publishing.
#
# Prompts for your Google OAuth client, opens the consent screen, catches the
# callback on a local port, checks the resulting token can actually reach the
# inflow listing, and stores all three values as GitHub Actions secrets.
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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-grinich/inflow}"
EXTENSION_ID="${EXTENSION_ID:-ndehgbgifkapdigmefglpgacpagoclge}"

bold=$(tput bold 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '\n%s==>%s %s%s\n' "$green" "$reset" "$bold" "$1$reset"; }
fail() { printf '\n%sError:%s %s\n' "$red" "$reset" "$1" >&2; exit 1; }
note() { printf '%s%s%s\n' "$dim" "$1" "$reset"; }

# --- preflight ---------------------------------------------------------------

for cmd in python3 gh; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required but not installed."
done
[ -f "$HERE/cws-oauth.py" ] || fail "Missing $HERE/cws-oauth.py"

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"
gh repo view "$REPO" >/dev/null 2>&1 ||
  fail "Cannot see $REPO with your gh account. Set REPO=owner/name if it moved."

step "Publishing $EXTENSION_ID from $REPO"

# --- 1. client credentials ---------------------------------------------------

step "Step 1 of 3 — OAuth client"
note "Google Cloud console → APIs & Services → Credentials → your Desktop client."
printf '\n  Client ID: '
read -r CLIENT_ID
[ -n "$CLIENT_ID" ] || fail "Client ID cannot be empty."

printf '  Client secret (hidden): '
read -rs CLIENT_SECRET
printf '\n'
[ -n "$CLIENT_SECRET" ] || fail "Client secret cannot be empty."

# --- 2. authorize ------------------------------------------------------------
# The helper serves a loopback redirect and catches the code itself; Google
# blocked the copy-the-code-out-of-the-browser (OOB) flow. Credentials go in on
# stdin and the token comes back on stdout, so neither reaches argv.

step "Step 2 of 3 — authorize in the browser"

RESULT=$(
  python3 -c '
import json, sys
json.dump({"client_id": sys.argv[1], "client_secret": input(), "extension_id": sys.argv[2]}, sys.stdout)
' "$CLIENT_ID" "$EXTENSION_ID" <<< "$CLIENT_SECRET" |
  python3 "$HERE/cws-oauth.py"
) || true

OK=$(printf '%s' "$RESULT" | python3 -c \
  'import json,sys; print("1" if json.load(sys.stdin).get("ok") else "")' 2>/dev/null || true)

if [ -z "$OK" ]; then
  DETAIL=$(printf '%s' "$RESULT" | python3 -c \
    'import json,sys; print(json.load(sys.stdin).get("error","unknown error"))' 2>/dev/null || true)
  printf '\n%sAuthorization failed.%s\n  %s\n\n' "$red" "$reset" "${DETAIL:-unknown error}" >&2
  note "Nothing has been saved. Fix the cause above and re-run."
  exit 1
fi

REFRESH_TOKEN=$(printf '%s' "$RESULT" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["refresh_token"])')

printf '\nConfirmed: this account can publish %s.\n' "$EXTENSION_ID"

# --- 3. store ----------------------------------------------------------------

step "Step 3 of 3 — storing secrets on $REPO"

set_secret() {
  printf '%s' "$2" | gh secret set "$1" --repo "$REPO"
  printf '  %s set\n' "$1"
}

set_secret CWS_CLIENT_ID "$CLIENT_ID"
set_secret CWS_CLIENT_SECRET "$CLIENT_SECRET"
set_secret CWS_REFRESH_TOKEN "$REFRESH_TOKEN"

unset CLIENT_SECRET REFRESH_TOKEN RESULT

printf '\n%sDone.%s Releases now publish themselves.\n\n' "$green" "$reset"
note "Cut one with:  npm run changelog:site && npm version patch && git push --follow-tags"
note "The refresh token lasts until you revoke it at"
note "https://myaccount.google.com/permissions — provided the OAuth consent"
note "screen stays 'In production'. In 'Testing' it expires every 7 days."

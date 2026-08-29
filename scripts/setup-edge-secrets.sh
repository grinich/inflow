#!/usr/bin/env bash
# Store the Microsoft Edge Add-ons publish credentials as GitHub Actions
# secrets so release.yml's edge-add-ons job can publish on tag push.
#
# Prerequisites (one-time, in Microsoft Partner Center — see
# docs/edge-add-ons-release.md):
#   1. Register for the Microsoft Edge program (free).
#   2. Submit the extension manually once, so the product exists.
#   3. Publish API page → "Create API credentials" → Client ID + API key.
#      The Product ID (a GUID) is shown on the same page / the product overview.
#
# Unlike the Chrome Web Store there is no OAuth consent dance — the
# credentials are static, so this script only prompts and stores them.
set -euo pipefail

REPO="${REPO:-grinich/inflow}"

command -v gh >/dev/null || { echo "gh CLI is required (brew install gh)"; exit 1; }
gh auth status >/dev/null || { echo "Run: gh auth login"; exit 1; }

read -r -p "Edge Product ID (GUID from Partner Center): " EDGE_PRODUCT_ID
read -r -p "Edge Client ID: " EDGE_CLIENT_ID
read -r -s -p "Edge API key (input hidden): " EDGE_API_KEY
echo

[ -n "$EDGE_PRODUCT_ID" ] && [ -n "$EDGE_CLIENT_ID" ] && [ -n "$EDGE_API_KEY" ] || {
  echo "All three values are required."; exit 1;
}

gh secret set EDGE_PRODUCT_ID --repo "$REPO" --body "$EDGE_PRODUCT_ID"
gh secret set EDGE_CLIENT_ID  --repo "$REPO" --body "$EDGE_CLIENT_ID"
gh secret set EDGE_API_KEY    --repo "$REPO" --body "$EDGE_API_KEY"

echo "Secrets stored on $REPO. The edge-add-ons job will publish on the next tag push."
echo "Reminder: API keys expire (Partner Center shows the date) — re-run this script with fresh credentials when they do."

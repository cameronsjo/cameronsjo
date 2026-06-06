#!/usr/bin/env bash
# setup-stats-token.sh — one-shot setup for the STATS_TOKEN secret the weekly
# profile workflow uses. GitHub has no API to mint a classic PAT, so the token
# itself must be created in the browser — but this script pre-opens the creation
# page with the right scopes ticked, then handles the secret set for you.
#
# Usage:  ./scripts/setup-stats-token.sh
set -euo pipefail

REPO="cameronsjo/cameronsjo"
SECRET="STATS_TOKEN"
# Pre-ticks `repo` (lets private contributions count toward the streak) +
# `read:user`. Classic-token creation page; scopes arrive pre-selected.
TOKEN_URL="https://github.com/settings/tokens/new?scopes=repo,read:user&description=${REPO//\//-}-${SECRET}"

die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# ── Pre-flight ──────────────────────────────────────────────────────────────
command -v gh >/dev/null || die "gh CLI not found — install it first"
gh auth status >/dev/null 2>&1 || die "gh not authenticated — run: gh auth login"
gh repo view "$REPO" >/dev/null 2>&1 || die "can't reach $REPO"

if gh secret list --repo "$REPO" 2>/dev/null | awk '{print $1}' | grep -qx "$SECRET"; then
  printf '\033[1;33m! %s already set on %s — this will overwrite it.\033[0m\n' "$SECRET" "$REPO"
fi

# ── Open the token page ─────────────────────────────────────────────────────
printf '\n\033[1;34m━━ Create the token ━━\033[0m\n'
echo "Opening the GitHub token page with 'repo' + 'read:user' pre-selected."
echo "Set an expiry you like, scroll down, click 'Generate token', then copy it."
echo
echo "  $TOKEN_URL"
echo
if command -v open >/dev/null; then open "$TOKEN_URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null; then xdg-open "$TOKEN_URL" >/dev/null 2>&1 || true
fi

# ── Read + deliver the token ────────────────────────────────────────────────
read -rsp "Paste the token (input hidden): " TOKEN; echo
[[ -n "$TOKEN" ]] || die "empty — aborted"

# Classic PATs are ghp_…, older ones are 40 hex chars. Warn, don't hard-fail.
if [[ ! "$TOKEN" =~ ^ghp_[A-Za-z0-9]{36,}$ && ! "$TOKEN" =~ ^[a-f0-9]{40}$ ]]; then
  read -rp "Doesn't look like a classic PAT (ghp_… or 40 hex) — continue anyway? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { unset TOKEN; die "aborted"; }
fi

printf '%s' "$TOKEN" | gh secret set "$SECRET" --repo "$REPO"
unset TOKEN
ok "$SECRET set on $REPO"

# ── Offer an end-to-end verification run ────────────────────────────────────
printf '\n\033[1;34m━━ Verify ━━\033[0m\n'
read -rp "Trigger the profile workflow now to confirm it works? [y/N] " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
  gh workflow run profile.yml --repo "$REPO"
  ok "Dispatched. Watch it:  gh run watch --repo $REPO \$(gh run list --repo $REPO --workflow profile.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
else
  echo "Skipped. It'll run on the Monday cron, or trigger manually with:"
  echo "  gh workflow run profile.yml --repo $REPO"
fi

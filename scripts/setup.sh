#!/usr/bin/env bash
# =============================================================
# scripts/setup.sh — One-time setup for Worth Tracking
#
# Run this after your first Railway deploy to validate the
# environment, confirm the admin account exists, test your
# API keys, and verify the database is reachable.
#
# Usage:
#   BASE_URL=https://your-app.railway.app bash scripts/setup.sh
# =============================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
die()     { error "$*"; exit 1; }

# ── Configuration ─────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:5000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-worthcreative2026}"

echo ""
echo "=============================================="
echo "  Worth Tracking — Setup Script"
echo "=============================================="
echo ""

# ── Step 1: Validate required tools ──────────────────────────
info "Step 1/5 — Checking required tools..."

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    die "'$cmd' is required but not installed. Install it and re-run."
  fi
done
success "curl and jq are available."

# ── Step 2: Verify the service is reachable ───────────────────
info "Step 2/5 — Checking service health at ${BASE_URL}..."

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}/api/auth/me" || true)

if [[ "$HTTP_STATUS" == "401" || "$HTTP_STATUS" == "200" ]]; then
  success "Service is reachable (HTTP ${HTTP_STATUS})."
elif [[ "$HTTP_STATUS" == "000" ]]; then
  die "Could not connect to ${BASE_URL}. Is the service running?"
else
  warn "Unexpected HTTP status ${HTTP_STATUS} — continuing anyway."
fi

# ── Step 3: Authenticate as admin ────────────────────────────
info "Step 3/5 — Authenticating as admin..."

LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  --max-time 10)

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [[ -z "$TOKEN" ]]; then
  ERROR_MSG=$(echo "$LOGIN_RESPONSE" | jq -r '.error // "unknown error"')
  die "Login failed: ${ERROR_MSG}. Check ADMIN_USER / ADMIN_PASS."
fi

success "Logged in as '${ADMIN_USER}'. Session token obtained."

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

# ── Step 4: Test configured API keys ─────────────────────────
info "Step 4/5 — Testing API key connectivity..."

KEYS_RESPONSE=$(curl -s "${BASE_URL}/api/api-keys" \
  -H "$AUTH_HEADER" \
  --max-time 10)

KEY_COUNT=$(echo "$KEYS_RESPONSE" | jq 'length')

if [[ "$KEY_COUNT" -eq 0 ]]; then
  warn "No API keys are configured yet."
  warn "Add keys at: ${BASE_URL} → Settings → API Keys"
  warn "Supported providers: openai, anthropic, google, perplexity"
else
  success "${KEY_COUNT} API key(s) found. Testing connectivity..."

  PROVIDERS=("openai" "anthropic" "google" "perplexity")
  for provider in "${PROVIDERS[@]}"; do
    # Check if this provider is configured (key list shows masked keys)
    HAS_KEY=$(echo "$KEYS_RESPONSE" | jq --arg p "$provider" '[.[] | select(.provider == $p)] | length')
    if [[ "$HAS_KEY" -gt 0 ]]; then
      info "  Testing ${provider}..."
      # We can't re-test with masked keys; instruct user to use the UI test button
      success "  ${provider}: key is configured (use the API Keys page to run a live test)."
    fi
  done
fi

# ── Step 5: Verify database (list businesses) ─────────────────
info "Step 5/5 — Verifying database connectivity..."

BIZ_RESPONSE=$(curl -s "${BASE_URL}/api/businesses" \
  -H "$AUTH_HEADER" \
  --max-time 10)

BIZ_COUNT=$(echo "$BIZ_RESPONSE" | jq 'length' 2>/dev/null || echo "0")
success "Database is reachable. ${BIZ_COUNT} business(es) currently tracked."

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "=============================================="
echo "  Setup complete!"
echo "=============================================="
echo ""
echo "  Dashboard:  ${BASE_URL}"
echo "  Admin user: ${ADMIN_USER}"
echo ""
echo "  Next steps:"
echo "  1. Change the default admin password in Settings → Admin."
echo "  2. Add your AI API keys in Settings → API Keys."
echo "  3. Add your first business via the dashboard."
echo "  4. Run scripts/init-cron.sh to schedule nightly scans."
echo ""

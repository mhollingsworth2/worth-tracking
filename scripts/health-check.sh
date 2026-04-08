#!/usr/bin/env bash
# =============================================================
# scripts/health-check.sh — Daily pipeline health check
#
# Verifies API key validity, database connectivity, and
# reports quality scores for all tracked businesses.
# Exits with code 1 if any critical issue is found so it
# can be used as a Railway health-check command or in CI.
#
# Usage:
#   BASE_URL=https://your-app.railway.app bash scripts/health-check.sh
# =============================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
die()     { error "$*"; exit 1; }

CRITICAL_ISSUES=0
WARNINGS=0

flag_critical() { error "$*"; CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1)); }
flag_warn()     { warn  "$*"; WARNINGS=$((WARNINGS + 1)); }

# ── Configuration ─────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:5000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-worthcreative2026}"
# Alert if mention rate drops below this percentage
MENTION_RATE_THRESHOLD="${MENTION_RATE_THRESHOLD:-20}"
# Alert if daily budget usage exceeds this percentage
BUDGET_WARN_THRESHOLD="${BUDGET_WARN_THRESHOLD:-75}"

echo ""
echo "=============================================="
echo -e "  ${BOLD}Worth Tracking — Health Check${NC}"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""

# ── Prerequisite check ────────────────────────────────────────
for cmd in curl jq; do
  command -v "$cmd" &>/dev/null || die "'$cmd' is required but not installed."
done

# ── Authenticate ──────────────────────────────────────────────
info "Authenticating..."

LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  --max-time 15 || echo '{}')

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [[ -z "$TOKEN" ]]; then
  die "Authentication failed. Service may be down or credentials are wrong."
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
success "Authenticated as '${ADMIN_USER}'."

# ── Check 1: Service reachability ─────────────────────────────
echo ""
info "Check 1/5 — Service reachability"

ME_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE_URL}/api/auth/me" \
  -H "$AUTH_HEADER" \
  --max-time 10 || echo "000")

if [[ "$ME_STATUS" == "200" ]]; then
  success "Service is responding (HTTP 200)."
else
  flag_critical "Service returned HTTP ${ME_STATUS} — may be degraded."
fi

# ── Check 2: API key validity ─────────────────────────────────
echo ""
info "Check 2/5 — API key configuration"

KEYS_RESPONSE=$(curl -s "${BASE_URL}/api/api-keys" \
  -H "$AUTH_HEADER" \
  --max-time 10 || echo '[]')

KEY_COUNT=$(echo "$KEYS_RESPONSE" | jq 'length' 2>/dev/null || echo "0")

if [[ "$KEY_COUNT" -eq 0 ]]; then
  flag_critical "No API keys are configured. Scans cannot run."
else
  success "${KEY_COUNT} API key(s) configured."

  PROVIDERS=("openai" "anthropic" "google" "perplexity")
  CONFIGURED_PROVIDERS=()
  for provider in "${PROVIDERS[@]}"; do
    HAS=$(echo "$KEYS_RESPONSE" | jq --arg p "$provider" '[.[] | select(.provider == $p)] | length')
    if [[ "$HAS" -gt 0 ]]; then
      CONFIGURED_PROVIDERS+=("$provider")
      success "  ${provider}: configured"
    else
      info "  ${provider}: not configured (optional)"
    fi
  done

  if [[ ${#CONFIGURED_PROVIDERS[@]} -eq 0 ]]; then
    flag_critical "No recognised providers found (openai, anthropic, google, perplexity)."
  fi
fi

# ── Check 3: Database connectivity & business count ───────────
echo ""
info "Check 3/5 — Database connectivity"

BIZ_RESPONSE=$(curl -s "${BASE_URL}/api/businesses" \
  -H "$AUTH_HEADER" \
  --max-time 10 || echo '[]')

BIZ_COUNT=$(echo "$BIZ_RESPONSE" | jq 'length' 2>/dev/null || echo "0")

if [[ "$BIZ_COUNT" -eq 0 ]]; then
  flag_warn "Database is reachable but no businesses are tracked yet."
else
  success "Database is reachable. ${BIZ_COUNT} business(es) found."
fi

# ── Check 4: Quality scores per business ──────────────────────
echo ""
info "Check 4/5 — Business quality scores (mention rates)"

if [[ "$BIZ_COUNT" -gt 0 ]]; then
  echo "$BIZ_RESPONSE" | jq -c '.[]' | while IFS= read -r biz; do
    BIZ_ID=$(echo "$biz" | jq -r '.id')
    BIZ_NAME=$(echo "$biz" | jq -r '.name')

    STATS=$(curl -s "${BASE_URL}/api/businesses/${BIZ_ID}/stats" \
      -H "$AUTH_HEADER" \
      --max-time 10 || echo '{}')

    MENTION_RATE=$(echo "$STATS" | jq -r '.mentionRate // 0')
    TOTAL_SEARCHES=$(echo "$STATS" | jq -r '.totalSearches // 0')
    TOTAL_MENTIONS=$(echo "$STATS" | jq -r '.totalMentions // 0')
    AVG_POSITION=$(echo "$STATS" | jq -r '.avgPosition // "N/A"')

    echo ""
    echo -e "  ${BOLD}${BIZ_NAME}${NC} (id: ${BIZ_ID})"
    echo "    Searches  : ${TOTAL_SEARCHES}"
    echo "    Mentions  : ${TOTAL_MENTIONS}"
    echo "    Rate      : ${MENTION_RATE}%"
    echo "    Avg Pos   : ${AVG_POSITION}"

    if [[ "$TOTAL_SEARCHES" -eq 0 ]]; then
      warn "    → No scan data yet. Run a scan from the dashboard."
    elif (( $(echo "$MENTION_RATE < $MENTION_RATE_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
      warn "    → Mention rate below ${MENTION_RATE_THRESHOLD}% threshold — review content gaps."
    else
      success "    → Mention rate is healthy."
    fi

    # Check for unread critical alerts
    ALERTS=$(curl -s "${BASE_URL}/api/alerts" \
      -H "$AUTH_HEADER" \
      --max-time 10 || echo '[]')

    CRITICAL_UNREAD=$(echo "$ALERTS" | jq --argjson id "$BIZ_ID" \
      '[.[] | select(.businessId == $id and .severity == "critical" and .isRead == 0)] | length' \
      2>/dev/null || echo "0")

    if [[ "$CRITICAL_UNREAD" -gt 0 ]]; then
      flag_warn "${BIZ_NAME}: ${CRITICAL_UNREAD} unread critical alert(s) — check the Alerts page."
    fi
  done
fi

# ── Check 5: API budget status ────────────────────────────────
echo ""
info "Check 5/5 — API budget status"

USAGE=$(curl -s "${BASE_URL}/api/usage/today" \
  -H "$AUTH_HEADER" \
  --max-time 10 || echo '{}')

TOTAL_SPEND=$(echo "$USAGE" | jq -r '.totalSpend // 0')
DAILY_BUDGET=$(echo "$USAGE" | jq -r '.dailyBudget // 10')
PCT_USED=$(echo "$USAGE" | jq -r '.pctUsed // 0')
BUDGET_STATUS=$(echo "$USAGE" | jq -r '.status // "unknown"')
CALL_COUNT=$(echo "$USAGE" | jq -r '.callCount // 0')

echo "  Today's spend : \$${TOTAL_SPEND} / \$${DAILY_BUDGET} (${PCT_USED}%)"
echo "  API calls     : ${CALL_COUNT}"
echo "  Status        : ${BUDGET_STATUS}"

if [[ "$BUDGET_STATUS" == "exceeded" ]]; then
  flag_critical "Daily budget exceeded (\$${TOTAL_SPEND} / \$${DAILY_BUDGET}). Scans are paused."
elif [[ "$PCT_USED" -ge "$BUDGET_WARN_THRESHOLD" ]]; then
  flag_warn "Budget at ${PCT_USED}% — approaching daily limit of \$${DAILY_BUDGET}."
else
  success "Budget usage is within normal range (${PCT_USED}%)."
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "=============================================="
echo -e "  ${BOLD}Health Check Summary${NC}"
echo "=============================================="
echo ""

if [[ "$CRITICAL_ISSUES" -gt 0 ]]; then
  echo -e "  ${RED}CRITICAL ISSUES : ${CRITICAL_ISSUES}${NC}"
fi
if [[ "$WARNINGS" -gt 0 ]]; then
  echo -e "  ${YELLOW}WARNINGS        : ${WARNINGS}${NC}"
fi
if [[ "$CRITICAL_ISSUES" -eq 0 && "$WARNINGS" -eq 0 ]]; then
  echo -e "  ${GREEN}All checks passed — pipeline is healthy.${NC}"
fi

echo ""
echo "  Dashboard : ${BASE_URL}"
echo "  Alerts    : ${BASE_URL} → Alerts"
echo "  Budget    : ${BASE_URL} → Settings → Budget"
echo ""

# Exit with non-zero if critical issues found (useful for CI / Railway health checks)
if [[ "$CRITICAL_ISSUES" -gt 0 ]]; then
  exit 1
fi

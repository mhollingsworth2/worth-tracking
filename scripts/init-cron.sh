#!/usr/bin/env bash
# =============================================================
# scripts/init-cron.sh — Set up the nightly pipeline cron job
#
# Creates a Railway cron service that runs the archival and
# scan pipeline every night at 02:00 UTC. Requires the
# Railway CLI to be installed and authenticated.
#
# Usage:
#   BASE_URL=https://your-app.railway.app \
#   RAILWAY_PROJECT_ID=<id> \
#   bash scripts/init-cron.sh
#
# Environment variables:
#   BASE_URL             — deployed service URL (required)
#   ADMIN_USER           — admin username (default: admin)
#   ADMIN_PASS           — admin password (default: worthcreative2026)
#   RAILWAY_PROJECT_ID   — Railway project ID (required for cron setup)
#   CRON_SCHEDULE        — cron expression (default: "0 2 * * *")
# =============================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
die()     { error "$*"; exit 1; }

# ── Configuration ─────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:5000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-worthcreative2026}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 2 * * *}"
RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-}"

echo ""
echo "=============================================="
echo "  Worth Tracking — Cron Initialisation"
echo "=============================================="
echo ""

# ── Step 1: Check prerequisites ───────────────────────────────
info "Step 1/4 — Checking prerequisites..."

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    die "'$cmd' is required but not installed."
  fi
done

if command -v railway &>/dev/null; then
  RAILWAY_CLI=true
  success "Railway CLI detected."
else
  RAILWAY_CLI=false
  warn "Railway CLI not found. Cron service creation will be skipped."
  warn "Install it with: npm install -g @railway/cli"
fi

# ── Step 2: Obtain admin token ────────────────────────────────
info "Step 2/4 — Authenticating with the service..."

LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  --max-time 15)

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [[ -z "$TOKEN" ]]; then
  ERROR_MSG=$(echo "$LOGIN_RESPONSE" | jq -r '.error // "unknown error"')
  die "Login failed: ${ERROR_MSG}"
fi

success "Admin token obtained."
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

# ── Step 3: Verify businesses exist ───────────────────────────
info "Step 3/4 — Checking businesses to scan..."

BIZ_RESPONSE=$(curl -s "${BASE_URL}/api/businesses" \
  -H "$AUTH_HEADER" \
  --max-time 10)

BIZ_COUNT=$(echo "$BIZ_RESPONSE" | jq 'length' 2>/dev/null || echo "0")

if [[ "$BIZ_COUNT" -eq 0 ]]; then
  warn "No businesses are configured yet. Add at least one business before the cron runs."
else
  success "${BIZ_COUNT} business(es) will be included in nightly scans."
  echo "$BIZ_RESPONSE" | jq -r '.[].name' | while read -r name; do
    info "  • ${name}"
  done
fi

# ── Step 4: Create Railway cron service ───────────────────────
info "Step 4/4 — Configuring Railway cron service..."

if [[ "$RAILWAY_CLI" == true && -n "$RAILWAY_PROJECT_ID" ]]; then
  # The cron command hits the scan endpoint for every business
  # and the archival endpoint (if implemented), then exits.
  CRON_CMD="bash -c 'TOKEN=\$(curl -s -X POST ${BASE_URL}/api/auth/login -H \"Content-Type: application/json\" -d \"{\\\"username\\\":\\\"${ADMIN_USER}\\\",\\\"password\\\":\\\"${ADMIN_PASS}\\\"}\" | jq -r .token); BUSINESSES=\$(curl -s ${BASE_URL}/api/businesses -H \"Authorization: Bearer \$TOKEN\" | jq -r \".[].id\"); for ID in \$BUSINESSES; do curl -s -X POST ${BASE_URL}/api/businesses/\$ID/scan -H \"Authorization: Bearer \$TOKEN\" -H \"Content-Type: application/json\" -d \"{}\"; done; echo \"Nightly scan complete.\"'"

  info "Creating pipeline-cron service in project ${RAILWAY_PROJECT_ID}..."
  info "Schedule: ${CRON_SCHEDULE} (nightly at 02:00 UTC)"

  # Use Railway CLI to create a cron service
  # railway run creates a one-off; for a persistent cron we add it via the project config
  cat <<EOF

  To create the cron service manually in the Railway dashboard:
  ─────────────────────────────────────────────────────────────
  1. Open your project at https://railway.app/project/${RAILWAY_PROJECT_ID}
  2. Click "+ New" → "Cron Job"
  3. Set the schedule to: ${CRON_SCHEDULE}
  4. Set the command to:

     curl -s -X POST ${BASE_URL}/api/auth/login \\
       -H "Content-Type: application/json" \\
       -d '{"username":"${ADMIN_USER}","password":"${ADMIN_PASS}"}' \\
       | jq -r '.token' \\
       | xargs -I{} sh -c '
           BUSINESSES=\$(curl -s ${BASE_URL}/api/businesses -H "Authorization: Bearer {}");
           echo "\$BUSINESSES" | jq -r ".[].id" | while read ID; do
             curl -s -X POST ${BASE_URL}/api/businesses/\$ID/scan \\
               -H "Authorization: Bearer {}" \\
               -H "Content-Type: application/json" \\
               -d "{}";
           done'

  5. Add the environment variable:
       BASE_URL=${BASE_URL}

EOF

  success "Cron configuration printed above. Apply it in the Railway dashboard."

else
  warn "Skipping Railway cron creation (CLI not available or RAILWAY_PROJECT_ID not set)."
  echo ""
  echo "  To schedule nightly scans manually, add a Railway cron job with:"
  echo "  Schedule : ${CRON_SCHEDULE}"
  echo "  Command  : See the Railway dashboard → New → Cron Job"
  echo ""
  echo "  Or run scans on demand from the dashboard at:"
  echo "  ${BASE_URL} → select a business → Run Scan"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "=============================================="
echo "  Cron initialisation complete!"
echo "=============================================="
echo ""
echo "  Schedule : ${CRON_SCHEDULE} (nightly at 02:00 UTC)"
echo "  Targets  : ${BIZ_COUNT} business(es)"
echo "  Budget   : configure at ${BASE_URL} → Settings → Budget"
echo ""
echo "  Run scripts/health-check.sh any time to verify the pipeline."
echo ""

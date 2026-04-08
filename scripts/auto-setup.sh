#!/usr/bin/env bash
# =============================================================================
# Worth Tracking — Auto-Setup Script
# Merges PRs #1, #2, #3 and runs post-deploy setup in one command.
#
# Usage:
#   chmod +x scripts/auto-setup.sh
#   ./scripts/auto-setup.sh
#
# Requirements: gh (GitHub CLI), curl, jq
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }
divider() { echo -e "${CYAN}────────────────────────────────────────────────────────────${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
divider
echo -e "${BOLD}  Worth Tracking — Merge & Setup Automation${RESET}"
divider
echo ""

# ── 1. Prerequisite checks ────────────────────────────────────────────────────
step "Checking prerequisites"

MISSING=()

if ! command -v gh &>/dev/null; then
  MISSING+=("gh (GitHub CLI — https://cli.github.com)")
fi

if ! command -v curl &>/dev/null; then
  MISSING+=("curl")
fi

if ! command -v jq &>/dev/null; then
  MISSING+=("jq (https://stedolan.github.io/jq/)")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  error "Missing required tools:"
  for tool in "${MISSING[@]}"; do
    echo -e "  ${RED}✗${RESET} $tool"
  done
  echo ""
  echo "Install them and re-run this script."
  exit 1
fi

success "gh, curl, and jq are available"

# Verify gh is authenticated
if ! gh auth status &>/dev/null; then
  error "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi
success "GitHub CLI is authenticated"

# ── 2. Detect repo ────────────────────────────────────────────────────────────
step "Detecting repository"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
if [[ -z "$REPO" ]]; then
  error "Could not detect the GitHub repository."
  error "Make sure you are inside the git repository directory."
  exit 1
fi
success "Repository: ${BOLD}$REPO${RESET}"

# ── 3. Merge PRs ──────────────────────────────────────────────────────────────
step "Merging pull requests"

PR_IDS=(1 2 3)
MERGED=()
SKIPPED=()

for PR in "${PR_IDS[@]}"; do
  echo ""
  info "Processing PR #${PR}…"

  # Fetch PR state
  PR_STATE=$(gh pr view "$PR" --repo "$REPO" --json state -q .state 2>/dev/null || echo "NOT_FOUND")

  case "$PR_STATE" in
    OPEN)
      info "PR #${PR} is open — merging with squash…"
      if gh pr merge "$PR" \
           --repo "$REPO" \
           --squash \
           --delete-branch \
           --auto 2>/dev/null; then
        success "PR #${PR} merged"
        MERGED+=("$PR")
      else
        # --auto may fail if branch protection is off; try direct merge
        if gh pr merge "$PR" \
             --repo "$REPO" \
             --squash \
             --delete-branch 2>/dev/null; then
          success "PR #${PR} merged"
          MERGED+=("$PR")
        else
          warn "PR #${PR} could not be merged automatically (may need review approval)"
          SKIPPED+=("$PR")
        fi
      fi
      ;;
    MERGED)
      success "PR #${PR} is already merged — skipping"
      SKIPPED+=("$PR")
      ;;
    CLOSED)
      warn "PR #${PR} is closed (not merged) — skipping"
      SKIPPED+=("$PR")
      ;;
    NOT_FOUND)
      warn "PR #${PR} not found — skipping"
      SKIPPED+=("$PR")
      ;;
    *)
      warn "PR #${PR} has unexpected state '${PR_STATE}' — skipping"
      SKIPPED+=("$PR")
      ;;
  esac
done

echo ""
if [[ ${#MERGED[@]} -gt 0 ]]; then
  success "Merged PRs: ${MERGED[*]}"
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  info "Skipped PRs: ${SKIPPED[*]}"
fi

# ── 4. Wait for Railway deployment ────────────────────────────────────────────
step "Waiting for Railway deployment"

# Determine the app URL — prefer RAILWAY_PUBLIC_DOMAIN env var, then prompt
APP_URL="${RAILWAY_PUBLIC_DOMAIN:-}"

if [[ -z "$APP_URL" ]]; then
  echo ""
  echo -e "${YELLOW}Enter your Railway app URL (e.g. https://worth-tracking.up.railway.app):${RESET}"
  read -r APP_URL
fi

# Strip trailing slash
APP_URL="${APP_URL%/}"

# Ensure it starts with https://
if [[ "$APP_URL" != https://* && "$APP_URL" != http://* ]]; then
  APP_URL="https://${APP_URL}"
fi

info "Polling ${APP_URL} for a healthy response…"

MAX_WAIT=300   # seconds
INTERVAL=10    # seconds between polls
ELAPSED=0
HEALTHY=false

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    --connect-timeout 5 \
    "${APP_URL}/" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" =~ ^(200|301|302|304)$ ]]; then
    HEALTHY=true
    break
  fi

  REMAINING=$((MAX_WAIT - ELAPSED))
  info "Not ready yet (HTTP ${HTTP_CODE}) — retrying in ${INTERVAL}s (${REMAINING}s remaining)…"
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [[ "$HEALTHY" == "true" ]]; then
  success "Deployment is live at ${APP_URL}"
else
  warn "Deployment did not become healthy within ${MAX_WAIT}s."
  warn "The app may still be starting. Continuing with setup anyway…"
fi

# ── 5. Run setup.sh ───────────────────────────────────────────────────────────
step "Running setup script"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SCRIPT="${SCRIPT_DIR}/setup.sh"

if [[ -f "$SETUP_SCRIPT" ]]; then
  chmod +x "$SETUP_SCRIPT"
  info "Executing ${SETUP_SCRIPT}…"
  if APP_URL="$APP_URL" bash "$SETUP_SCRIPT"; then
    success "setup.sh completed successfully"
  else
    warn "setup.sh exited with a non-zero status — review output above"
  fi
else
  warn "scripts/setup.sh not found — skipping setup step"
  info "You can run setup manually once the app is live."
fi

# ── 6. Run health-check.sh ────────────────────────────────────────────────────
step "Running health check"

HEALTH_SCRIPT="${SCRIPT_DIR}/health-check.sh"

if [[ -f "$HEALTH_SCRIPT" ]]; then
  chmod +x "$HEALTH_SCRIPT"
  info "Executing ${HEALTH_SCRIPT}…"
  if APP_URL="$APP_URL" bash "$HEALTH_SCRIPT"; then
    success "Health check passed"
  else
    warn "Health check reported issues — review output above"
  fi
else
  # Inline minimal health check when the script doesn't exist yet
  info "scripts/health-check.sh not found — running inline health check…"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 "${APP_URL}/" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" =~ ^(200|301|302|304)$ ]]; then
    success "App responded with HTTP ${HTTP_CODE} — looks healthy"
  else
    warn "App responded with HTTP ${HTTP_CODE} — may need attention"
  fi
fi

# ── 7. Summary ────────────────────────────────────────────────────────────────
echo ""
divider
echo -e "${BOLD}  Setup Complete${RESET}"
divider
echo ""

if [[ ${#MERGED[@]} -gt 0 ]]; then
  echo -e "  ${GREEN}✓${RESET} Merged PRs:    ${MERGED[*]}"
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo -e "  ${YELLOW}–${RESET} Skipped PRs:   ${SKIPPED[*]}"
fi
echo -e "  ${GREEN}✓${RESET} App URL:       ${APP_URL}"
echo ""
echo -e "${BOLD}  Next steps:${RESET}"
echo -e "  1. Open ${APP_URL} in your browser"
echo -e "  2. Log in with the default admin credentials:"
echo -e "     Username: ${BOLD}admin${RESET}"
echo -e "     Password: ${BOLD}worthcreative2026${RESET}"
echo -e "  3. ${RED}Change the admin password immediately${RESET}"
echo -e "  4. Add your first business and configure AI API keys"
echo ""
divider
echo ""

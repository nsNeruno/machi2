#!/usr/bin/env bash
#
# generate-prod-env.sh — generate a starter production env file for the secrets in
# INFRASTRUCTURE.md §3 (Railway) / Appendix A.5 (Oracle/paid-VPS fallback).
#
# This is a *staging* artifact, not something the app or Railway reads directly:
# Railway takes its config from the dashboard's Variables UI, not a file. Run this
# locally, paste the values into Railway's Variables (or use --push if the Railway CLI
# is installed and linked), then delete the generated file.
#
# What it generates (see INFRASTRUCTURE.md §3 for what each one protects):
#   DEVICE_TOKEN_SECRET, SESSION_SECRET, IP_HASH_SALT   — fresh random secrets
#   ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD                — first-boot-only admin login
#   NODE_ENV, TRUST_PROXY, SESSION_COOKIE_SECURE         — required production flags
#
# What it deliberately does NOT generate: DATABASE_URL. On Railway that's a reference
# variable to the Postgres service, wired in the dashboard, never a value you type in
# (INFRASTRUCTURE.md §3). Use --vps if you're instead filling in the Oracle/paid-VPS
# `.env` (Appendix A.5), which needs POSTGRES_PASSWORD instead.
#
# Usage:
#   ./scripts/generate-prod-env.sh                     writes .env.production
#   ./scripts/generate-prod-env.sh --vps                also generates POSTGRES_PASSWORD
#                                                        for the Oracle/paid-VPS .env
#   ./scripts/generate-prod-env.sh --push                also pushes each value to the
#                                                        linked Railway service
#   ./scripts/generate-prod-env.sh --force               overwrite an existing output file
#   ADMIN_SEED_EMAIL=you@example.com ./scripts/generate-prod-env.sh   skip the prompt
#
# Rotation note: DEVICE_TOKEN_SECRET has real product blast radius if changed after
# launch — see ARCHITECTURE.md / the conversation that produced this script. Re-running
# this script is for a fresh initial setup, not a routine rotation habit.

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- pretty output (matches dev.sh) -----------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi
step() { printf "%s▸ %s%s\n" "$CYAN" "$1" "$RESET"; }
ok()   { printf "%s  ✓ %s%s\n" "$GREEN" "$1" "$RESET"; }
warn() { printf "%s  ! %s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "%s✗ %s%s\n" "$RED" "$1" "$RESET" >&2; exit 1; }

usage() {
  cat <<'EOF'
generate-prod-env.sh — generate a starter production env file (secrets only).

Usage:
  ./scripts/generate-prod-env.sh          writes .env.production (Railway variable set)
  ./scripts/generate-prod-env.sh --vps    also generates POSTGRES_PASSWORD for the
                                          Oracle/paid-VPS .env (Appendix A.5)
  ./scripts/generate-prod-env.sh --push   also pushes each value to the linked Railway
                                          service via the Railway CLI
  ./scripts/generate-prod-env.sh --force  overwrite an existing output file
  ./scripts/generate-prod-env.sh --help   show this help

Env override:
  ADMIN_SEED_EMAIL=you@example.com ./scripts/generate-prod-env.sh   skip the prompt
  OUT_FILE=.env.staging ./scripts/generate-prod-env.sh              write elsewhere
EOF
}

# --- args --------------------------------------------------------------------
VPS=0
PUSH=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --vps)     VPS=1 ;;
    --push)    PUSH=1 ;;
    --force)   FORCE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

command -v openssl >/dev/null 2>&1 || die "openssl is required and wasn't found on PATH."

OUT_FILE="${OUT_FILE:-.env.production}"

if [[ -e "$OUT_FILE" && "$FORCE" -ne 1 ]]; then
  die "$OUT_FILE already exists — pass --force to overwrite, or remove it first."
fi

step "Generating secrets"
DEVICE_TOKEN_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
IP_HASH_SALT=$(openssl rand -base64 16)
ADMIN_SEED_PASSWORD=$(openssl rand -base64 24)
POSTGRES_PASSWORD=""
if [[ "$VPS" -eq 1 ]]; then
  POSTGRES_PASSWORD=$(openssl rand -base64 32)
fi
ok "Generated DEVICE_TOKEN_SECRET, SESSION_SECRET, IP_HASH_SALT, ADMIN_SEED_PASSWORD$([[ "$VPS" -eq 1 ]] && echo ", POSTGRES_PASSWORD")"

ADMIN_SEED_EMAIL="${ADMIN_SEED_EMAIL:-}"
if [[ -z "$ADMIN_SEED_EMAIL" ]]; then
  read -rp "Admin seed email (first superadmin login): " ADMIN_SEED_EMAIL
fi
[[ -n "$ADMIN_SEED_EMAIL" ]] || die "Admin seed email is required."

step "Writing $OUT_FILE"
: > "$OUT_FILE"
chmod 600 "$OUT_FILE"   # set before content is written — no window where it's readable by others

{
  echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/generate-prod-env.sh"
  echo "# Staging file only — Railway reads its config from the dashboard Variables UI,"
  echo "# not this file. Paste each value in (INFRASTRUCTURE.md §3), or run with --push"
  echo "# to send them via the Railway CLI, then delete this file. Do not commit it —"
  echo "# .gitignore already excludes .env.* except .env.example."
  echo
  echo "NODE_ENV=production"
  echo "TRUST_PROXY=1"
  echo "SESSION_COOKIE_SECURE=1"
  echo
  echo "DEVICE_TOKEN_SECRET=$DEVICE_TOKEN_SECRET"
  echo "SESSION_SECRET=$SESSION_SECRET"
  echo "IP_HASH_SALT=$IP_HASH_SALT"
  echo
  echo "# First-boot only: admin-bootstrap.service.ts ignores these forever once a"
  echo "# superadmin exists. Delete both from Railway once you've logged in once."
  echo "ADMIN_SEED_EMAIL=$ADMIN_SEED_EMAIL"
  echo "ADMIN_SEED_PASSWORD=$ADMIN_SEED_PASSWORD"

  if [[ "$VPS" -eq 1 ]]; then
    echo
    echo "# --- Oracle/paid-VPS fallback only (Appendix A.5) ---"
    echo "# docker-compose.yml builds DATABASE_URL from this at container start; you"
    echo "# don't need to assemble the connection string by hand."
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  fi

  echo
  echo "# Not generated here — these already default correctly in code (see"
  echo "# .env.example). Uncomment only to override the production posture:"
  echo "# REJOIN_COOLDOWN_SECONDS=30"
  echo "# ENQUEUE_IP_LIMIT=3"
  echo "# ENQUEUE_IP_TTL_SECONDS=60"
  echo "# ENQUEUE_DEVICE_LIMIT=1"
  echo "# ENQUEUE_DEVICE_TTL_SECONDS=5"
  echo "# READ_IP_LIMIT=60"
  echo "# READ_IP_TTL_SECONDS=60"
  echo "# MAX_STREAMS_PER_IP=3"
} >> "$OUT_FILE"

ok "Wrote $OUT_FILE (mode 600)"
warn "ADMIN_SEED_PASSWORD: $ADMIN_SEED_PASSWORD  <- note this down now, it's your first admin login"

if [[ "$PUSH" -eq 1 ]]; then
  step "Pushing variables to the linked Railway service"
  command -v railway >/dev/null 2>&1 || die "Railway CLI not found — install it, or drop --push and paste values manually from $OUT_FILE."
  # Flag name has moved before between Railway CLI versions — check
  # 'railway variables --help' if this fails.
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    railway variables --set "${key}=${value}"
  done < <(grep -v '^#' "$OUT_FILE" | grep '=')
  ok "Pushed. Verify in the Railway dashboard, then delete $OUT_FILE locally."
else
  warn "Remember to delete $OUT_FILE once its values are in Railway (or the VPS .env)."
fi

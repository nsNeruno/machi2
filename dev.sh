#!/usr/bin/env bash
#
# dev.sh — one command to boot the whole local stack.
#
# Brings up Postgres (Docker), applies migrations, seeds dev data, then runs the API and
# web dev servers together with hot reload.
#
# It runs in the foreground until you press Ctrl-C, then shuts everything down cleanly —
# the API and web servers (whole process tree) and the Postgres container. Pass --keep-db
# if you'd rather leave Postgres running for a faster next start.
#
# When both servers are ready it opens the web app in your default browser (so you don't
# have to catch the URL in the scrolling logs). Pass --no-open to skip that.
#
# Usage:
#   ./dev.sh            boot (migrate + seed); Ctrl-C stops servers + Postgres
#   ./dev.sh --reset    wipe the local DB first (drop, re-migrate, re-seed)
#   ./dev.sh --no-seed  boot without (re)seeding
#   ./dev.sh --keep-db  leave the Postgres container running on Ctrl-C
#   ./dev.sh --no-open  don't open the browser when ready
#   ./dev.sh --help     show this help

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- pretty output ---------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi
step() { printf "%s▸ %s%s\n" "$CYAN" "$1" "$RESET"; }
ok()   { printf "%s  ✓ %s%s\n" "$GREEN" "$1" "$RESET"; }
warn() { printf "%s  ! %s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "%s✗ %s%s\n" "$RED" "$1" "$RESET" >&2; exit 1; }

usage() {
  cat <<'EOF'
dev.sh — one command to boot the whole local stack (Postgres + API + web).

Runs in the foreground until Ctrl-C, then shuts everything down cleanly.

Usage:
  ./dev.sh            boot (migrate + seed); Ctrl-C stops servers + Postgres
  ./dev.sh --reset    wipe the local DB first (drop, re-migrate, re-seed)
  ./dev.sh --no-seed  boot without (re)seeding
  ./dev.sh --keep-db  leave the Postgres container running on Ctrl-C
  ./dev.sh --no-open  don't open the browser when ready
  ./dev.sh --help     show this help
EOF
}

# --- args ------------------------------------------------------------------
RESET_DB=0
SEED=1
STOP_DB=1           # stop everything by default; --keep-db opts out
OPEN_BROWSER=1      # open the web app when ready; --no-open opts out
for arg in "$@"; do
  case "$arg" in
    --reset)   RESET_DB=1 ;;
    --no-seed) SEED=0 ;;
    --keep-db) STOP_DB=0 ;;
    --no-open) OPEN_BROWSER=0 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

# --- prerequisites ---------------------------------------------------------
step "Checking prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js is not installed (need 22 LTS+)."
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed (run: corepack enable)."
command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "Docker daemon is not running — start Docker Desktop and retry."
# docker compose v2 (plugin) or legacy docker-compose
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else command -v docker-compose >/dev/null 2>&1 && COMPOSE=(docker-compose) || die "Docker Compose not found."; fi
ok "node $(node -v), pnpm $(pnpm -v), docker present"

# --- .env ------------------------------------------------------------------
if [ ! -f .env ]; then
  step "Creating .env from .env.example"
  cp .env.example .env
  ok ".env created (dev placeholder secrets)"
else
  ok ".env present"
fi

# --- dependencies ----------------------------------------------------------
if [ ! -d node_modules ]; then
  step "Installing dependencies (first run)"
  pnpm install
  ok "dependencies installed"
fi

# --- ports -----------------------------------------------------------------
# Read the actual ports from .env so the checks and printed URLs match config.
read_port() { grep -E "^$1=" .env 2>/dev/null | tail -1 | sed -E 's/^[^=]+=//; s/[^0-9].*$//'; }
API_PORT="$(read_port PORT)";      API_PORT="${API_PORT:-3000}"
WEB_PORT="$(read_port VITE_PORT)"; WEB_PORT="${WEB_PORT:-5173}"
port_in_use() { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

step "Checking ports"
for pair in "$API_PORT|API (PORT in .env)" "$WEB_PORT|web (VITE_PORT in .env)"; do
  port="${pair%%|*}"; label="${pair#*|}"
  if port_in_use "$port"; then
    die "Port $port is already in use — needed for $label.
       Free it:  lsof -ti tcp:$port | xargs kill
       or change the port in .env, then run ./dev.sh again."
  fi
done
ok "ports $API_PORT (api) and $WEB_PORT (web) are free"

# --- postgres --------------------------------------------------------------
step "Starting Postgres"
"${COMPOSE[@]}" up -d postgres >/dev/null
printf "%s  waiting for Postgres to accept connections" "$DIM"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U arcade -d arcade >/dev/null 2>&1; then
    printf "%s\n" "$RESET"; ok "Postgres is ready"; break
  fi
  printf "."
  sleep 1
  [ "$i" -eq 30 ] && { printf "%s\n" "$RESET"; die "Postgres did not become ready in time."; }
done

# --- database --------------------------------------------------------------
if [ "$RESET_DB" -eq 1 ]; then
  step "Resetting database (drop → migrate → seed)"
  pnpm db:reset
  ok "database reset"
else
  step "Applying migrations"
  pnpm db:migrate
  ok "migrations applied"
  if [ "$SEED" -eq 1 ]; then
    step "Seeding dev data"
    pnpm db:seed
    ok "seed loaded"
  fi
fi

# --- run -------------------------------------------------------------------
DEV_PID=""
ANNOUNCE_PID=""
cleanup() {
  trap - INT TERM EXIT          # make cleanup idempotent
  [ -n "$ANNOUNCE_PID" ] && kill "$ANNOUNCE_PID" 2>/dev/null || true
  printf "\n%s▸ Shutting down dev servers%s\n" "$CYAN" "$RESET"
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    # Signal the whole job's process group (api, web, and their child bundlers).
    kill -TERM "-$DEV_PID" 2>/dev/null || kill -TERM "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  ok "dev servers stopped"
  if [ "$STOP_DB" -eq 1 ]; then
    "${COMPOSE[@]}" stop postgres >/dev/null 2>&1 || true
    ok "Postgres stopped"
  else
    printf "%s  Postgres left running (%s stop postgres to stop it)%s\n" "$DIM" "${COMPOSE[*]}" "$RESET"
  fi
}
trap cleanup INT TERM EXIT

# Printed once both servers actually respond, so the URLs land *after* the noisy startup
# logs instead of being scrolled off-screen by them.
# Best-effort primary LAN IPv4, so we can print an address other devices can reach.
# Empty string if it can't be determined (offline, unusual network setup).
lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then          # macOS
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null
  elif command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then  # Linux
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

print_banner() {
  local ip
  ip="$(lan_ip)"
  printf '\n%s══════════════════════════════════════════════════%s\n' "$GREEN$BOLD" "$RESET"
  printf '%s  ✅ Dev servers ready — click to open:%s\n\n' "$BOLD" "$RESET"
  printf '       web     http://localhost:%s\n' "$WEB_PORT"
  printf '       admin   http://localhost:%s/admin\n' "$WEB_PORT"
  printf '       api     http://localhost:%s/api/health\n' "$API_PORT"
  if [ -n "$ip" ]; then
    printf '\n%s  On the same Wi-Fi (phone, tablet): http://%s:%s%s\n' "$BOLD" "$ip" "$WEB_PORT" "$RESET"
  fi
  printf '\n%s  Seed login is in the logs above · Ctrl-C stops everything%s\n' "$DIM" "$RESET"
  printf '%s══════════════════════════════════════════════════%s\n\n' "$GREEN$BOLD" "$RESET"
}

# Open a URL in the default browser, on macOS / Linux / WSL. No-op if none is available.
open_url() {
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1        # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1  # Linux
  elif command -v wslview >/dev/null 2>&1; then wslview "$1" >/dev/null 2>&1     # WSL
  else return 1; fi
}

announce_when_ready() {
  local i
  for i in $(seq 1 90); do
    kill -0 "$DEV_PID" 2>/dev/null || return 0   # dev servers gone — nothing to announce
    if curl -sf --max-time 1 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1 \
      && curl -s --max-time 1 -o /dev/null "http://localhost:$WEB_PORT" >/dev/null 2>&1; then
      print_banner
      if [ "$OPEN_BROWSER" = 1 ]; then
        if open_url "http://localhost:$WEB_PORT"; then
          printf "%s  Opened http://localhost:%s in your default browser.%s\n\n" "$DIM" "$WEB_PORT" "$RESET"
        fi
      fi
      return 0
    fi
    sleep 1
  done
  print_banner   # timed out waiting; show the URLs anyway
}

printf "\n%s▸ Starting dev servers — compiling (first run can take ~15s)…%s\n" "$CYAN" "$RESET"
printf "%s  the URLs will print here once both servers are ready.%s\n\n" "$DIM" "$RESET"

# Job control (set -m) puts pnpm dev in its own process group so Ctrl-C reaches the
# script's trap, which then tears the whole group down. Disable it again right after so
# the readiness watcher doesn't emit job-control chatter.
set -m
pnpm dev &
DEV_PID=$!
set +m

announce_when_ready &
ANNOUNCE_PID=$!

wait "$DEV_PID"

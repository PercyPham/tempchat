#!/usr/bin/env bash
# dev.sh — start Redis (if needed), backend, and webapp. Logs interleaved in one terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

log() { echo -e "${CYAN}[dev]${RESET} $*"; }

# ── Cleanup on exit ──────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  log "Shutting down…"
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
    # Kill any children (e.g. air's compiled binary child process)
    pkill -TERM -P "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. Docker / Redis ────────────────────────────────────────────────────────
if ! docker compose -f "$ROOT/docker-compose.dev.yml" ps --status running 2>/dev/null | grep -q redis; then
  log "Starting Redis via docker compose…"
  docker compose -f "$ROOT/docker-compose.dev.yml" up -d
else
  log "Redis already running — skipping docker compose up"
fi

# ── 2. Stream helper — prefix every line with a colored tag ──────────────────
# Usage: stream_prefix COLOR "[tag]" command [args...]
stream_prefix() {
  local color="$1" tag="$2"
  shift 2
  "$@" > >(while IFS= read -r line; do echo -e "${color}${tag}${RESET} ${line}"; done) \
        2> >(while IFS= read -r line; do echo -e "${color}${tag}${RESET} ${line}"; done >&2) &
  PIDS+=($!)
}

# ── 3. Backend ───────────────────────────────────────────────────────────────
log "Starting backend…"
stream_prefix "$GREEN" "[backend]" \
  bash -c "cd '$ROOT/backend' && exec $(go env GOPATH)/bin/air"

# ── 4. Webapp ────────────────────────────────────────────────────────────────
log "Starting webapp…"
stream_prefix "$YELLOW" "[webapp]" \
  bash -c "cd '$ROOT/webapp' && exec pnpm dev"

log "All services started. Press Ctrl+C to stop."
wait

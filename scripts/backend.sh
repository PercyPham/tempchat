#!/usr/bin/env bash
# backend.sh — start Redis (if needed) and the Go backend.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CYAN='\033[0;36m'
RESET='\033[0m'
log() { echo -e "${CYAN}[backend]${RESET} $*"; }

if ! docker compose -f "$ROOT/docker-compose.dev.yml" ps --status running 2>/dev/null | grep -q redis; then
  log "Starting Redis via docker compose…"
  docker compose -f "$ROOT/docker-compose.dev.yml" up -d
else
  log "Redis already running — skipping docker compose up"
fi

log "Starting Go server with live-reload (air) on :8080…"
cd "$ROOT/backend"
exec "$(go env GOPATH)/bin/air"

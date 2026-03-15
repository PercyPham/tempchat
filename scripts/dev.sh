#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Start infra if redis is not already running
if ! docker compose -f "$ROOT/docker-compose.dev.yml" ps -q redis 2>/dev/null | grep -q .; then
  echo "Starting dev infrastructure..."
  docker compose -f "$ROOT/docker-compose.dev.yml" up -d
fi

# Kill all background jobs on exit (Ctrl+C or error)
trap 'echo "Stopping..."; kill $(jobs -p) 2>/dev/null; wait' EXIT INT TERM

echo "Starting backend (air)..."
(cd "$ROOT/backend" && air) &

echo "Starting webapp (vite)..."
(cd "$ROOT/webapp" && npm run dev) &

wait

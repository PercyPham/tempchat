#!/usr/bin/env bash
# deploy-be.sh — cross-compile the Go binary and deploy to the production droplet.
#
# Usage:
#   TEMPCHAT_HOST=deploy@<droplet-ip> bash scripts/deploy-be.sh
#
# Required env:
#   TEMPCHAT_HOST   — SSH target, e.g. deploy@1.2.3.4
#
# Optional env:
#   TEMPCHAT_DEPLOY_USER — OS user owning /opt/tempchat (default: root for scp,
#                          binary moved into place on server side)
set -euo pipefail

TEMPCHAT_HOST=deploy@tempchat

HOST="${TEMPCHAT_HOST:?Set TEMPCHAT_HOST=<user>@<droplet-ip>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$ROOT/backend/bin/server-linux"
ENV_FILE="$ROOT/backend/.env.production"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RESET='\033[0m'
log()     { echo -e "${CYAN}[deploy-be]${RESET} $*"; }
success() { echo -e "${GREEN}[deploy-be]${RESET} $*"; }

log "Cross-compiling for linux/amd64…"
cd "$ROOT/backend"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -ldflags="-s -w" -o "$BINARY" ./cmd/server

log "Uploading binary to $HOST:/tmp/server…"
scp "$BINARY" "$HOST:/tmp/server"

log "Uploading env to $HOST:/tmp/.env.production…"
scp "$ENV_FILE" "$HOST:/tmp/.env.production"

log "Installing binary, env, and restarting service…"
ssh "$HOST" << 'REMOTE'
set -euo pipefail
sudo install -o tempchat -g tempchat -m 0755 /tmp/server /opt/tempchat/server
sudo rm /tmp/server
sudo install -o tempchat -g tempchat -m 0640 /tmp/.env.production /opt/tempchat/.env
sudo rm /tmp/.env.production
sudo systemctl restart tempchat
sleep 1
sudo systemctl is-active --quiet tempchat && echo "tempchat service is running" \
  || { echo "ERROR: tempchat service failed to start"; sudo journalctl -u tempchat -n 20 --no-pager; exit 1; }
REMOTE

success "Deployed successfully. Live logs: ssh $HOST 'journalctl -u tempchat -f'"

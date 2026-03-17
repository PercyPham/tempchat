#!/usr/bin/env bash
# webapp.sh — start the Vite dev server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/webapp"
exec pnpm dev

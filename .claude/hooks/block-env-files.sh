#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

if [[ "$tool_name" == "Bash" ]]; then
  command=$(echo "$input" | jq -r '.tool_input.command // ""')
  if echo "$command" | grep -qE '(^|[^a-zA-Z0-9_])\.env(\.production)?([^a-zA-Z0-9_.]|$)' && \
     ! echo "$command" | grep -qE '\.env\.example'; then
    echo "Blocked: command references a secrets file (.env / .env.production)." >&2
    exit 2
  fi
else
  file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
  basename=$(basename "$file_path")
  if [[ "$basename" == ".env" || "$basename" == ".env.production" ]]; then
    echo "Blocked: Claude Code is not allowed to access $file_path (secrets file). Use .env.example instead." >&2
    exit 2
  fi
fi

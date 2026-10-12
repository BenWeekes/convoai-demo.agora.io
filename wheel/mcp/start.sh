#!/usr/bin/env bash
# Start wheel-mcp. Agora App ID + cert for the RTM dealer-bot are read from the
# gitignored simple-backend/.env (the shared demo app) — never committed.
set -euo pipefail
ENV_FILE=/home/ubuntu/agent-samples/simple-backend/.env
val() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r'; }

export WHEEL_APP_ID="$(val EVENTDEMO_APP_ID)"
export WHEEL_APP_CERT="$(val EVENTDEMO_APP_CERTIFICATE)"
export WHEEL_BOT_UID="${WHEEL_BOT_UID:-wheel-dealer-bot}"
export PORT="${PORT:-8120}"
export WHEEL_START_BALANCE="${WHEEL_START_BALANCE:-100}"

cd /home/ubuntu/web/wheel/mcp
exec node server.mjs

#!/usr/bin/env bash
# Start the slot-mcp server. The Agora App ID + certificate for the RTM dealer-bot
# are NOT committed — they are read here from the gitignored simple-backend/.env
# (the shared demo app, same one the slot_play profile uses, so the bot publishes
# into the same Agora project the client joins).
set -euo pipefail
ENV_FILE=/home/ubuntu/agent-samples/simple-backend/.env
val() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r'; }

export SLOT_APP_ID="$(val EVENTDEMO_APP_ID)"
export SLOT_APP_CERT="$(val EVENTDEMO_APP_CERTIFICATE)"
export SLOT_BOT_UID="${SLOT_BOT_UID:-slot-dealer-bot}"
export PORT="${PORT:-8119}"
export SLOT_START_BALANCE="${SLOT_START_BALANCE:-100}"
export SLOT_STAKE="${SLOT_STAKE:-10}"

cd /home/ubuntu/web/slot/mcp
exec node server.mjs

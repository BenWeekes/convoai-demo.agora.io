#!/usr/bin/env bash
# Start quiz-mcp. Agora App ID + cert for the RTM host-bot are read from the
# gitignored simple-backend/.env (the shared demo app) — never committed.
set -euo pipefail
ENV_FILE=/home/ubuntu/agent-samples/simple-backend/.env
val() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r'; }

export QUIZ_APP_ID="$(val EVENTDEMO_APP_ID)"
export QUIZ_APP_CERT="$(val EVENTDEMO_APP_CERTIFICATE)"
export QUIZ_BOT_UID="${QUIZ_BOT_UID:-quiz-host-bot}"
export PORT="${PORT:-8121}"
export QUIZ_START_SCORE="${QUIZ_START_SCORE:-0}"

cd /home/ubuntu/web/quiz/mcp
exec node server.mjs

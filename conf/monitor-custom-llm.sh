#!/usr/bin/env bash
# Cron-driven watchdog for server-custom-llm.
#
# Checks (in order):
#   1. `pm2 jlist` reports status "online" for `server-custom-llm`
#   2. The HTTP listener on 127.0.0.1:8100 answers a TCP connect
#
# On either failure, `pm2 restart server-custom-llm` is invoked and the
# outcome logged. Success paths are silent (or one line at DEBUG) so
# the log stays readable.
#
# Rationale: after upstream `git pull` adds a new npm dep, missing
# `npm install` results in a MODULE_NOT_FOUND crash — pm2 gives up
# after ~15 quick restarts and leaves the process in "errored" state
# indefinitely. This watchdog restarts every 5 min so an intervening
# `npm install` (or transient issue) is picked up automatically.
#
# Install: crontab -e →
#   */5 * * * * /home/ubuntu/web/conf/monitor-custom-llm.sh >> /home/ubuntu/web/conf/monitor-custom-llm.log 2>&1
# See deploy.md → "Custom LLM watchdog".

set -u
PATH="/home/ubuntu/.nvm/versions/node/$(ls /home/ubuntu/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/bin:/usr/bin:/bin"

APP="server-custom-llm"
PORT="${CUSTOM_LLM_PORT:-8100}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { echo "[$STAMP] $*"; }

# Pull pm2 status
status="$(pm2 jlist 2>/dev/null | node -e '
  let s = "";
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => {
    try {
      const list = JSON.parse(s);
      const p = list.find((x) => x.name === "'"$APP"'");
      process.stdout.write(p ? p.pm2_env.status : "missing");
    } catch { process.stdout.write("parse-error"); }
  });
' 2>/dev/null || echo "pm2-error")"

if [ "$status" != "online" ]; then
  log "pm2 status=$status → restarting $APP"
  pm2 restart "$APP" >/dev/null 2>&1 && log "restart ok" || log "restart FAILED"
  exit 0
fi

# TCP-probe the HTTP port — a healthy Node listener answers connect but
# we don't do a full HTTP GET (some routes 404). If port is dead the
# process is up but the app is wedged; restart.
if ! timeout 3 bash -c ">/dev/tcp/127.0.0.1/$PORT" 2>/dev/null; then
  log "port $PORT unreachable despite pm2 status=online → restarting $APP"
  pm2 restart "$APP" >/dev/null 2>&1 && log "restart ok" || log "restart FAILED"
  exit 0
fi

# All good — stay quiet so the log doesn't churn.
exit 0

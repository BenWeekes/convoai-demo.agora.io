#!/usr/bin/env bash
# End-to-end Baccarat test over RTM (no audio): start a baccarat_play agent, send a
# bet, then a reveal, and show the agent replies + the baccarat-mcp tool log.
# Usage: run-play-test.sh ["<bet text>"] [waitSec]
set -euo pipefail
PROFILE="baccarat_play"
BET="${1:-Hi, I would like to bet twenty dollars on the banker please.}"
WAIT="${2:-16}"
BACKEND="http://127.0.0.1:8082"
MCPLOG="/home/ubuntu/baccarat-mcp/calls.log"
CHAN="BPLAY_$(date +%s)"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== profile=$PROFILE channel=$CHAN =="
start=$(curl -s -m 120 "$BACKEND/start-agent?profile=$PROFILE&channel=$CHAN&connect=true")
AID=$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);r=d['agent_response']['response'];import json as j;r=j.loads(r) if isinstance(r,str) else r;print(r.get('agent_id',''))" "$start")
echo "agent_id=$AID"
[ -z "$AID" ] && { echo "start failed:"; echo "$start" | head -c 500; exit 1; }

tok=$(curl -s -m 30 "$BACKEND/start-agent?profile=$PROFILE&channel=$CHAN&connect=false")
APPID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['appid'])" "$tok")
TOKEN=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['token'])" "$tok")
URTM=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['user_rtm_uid'])" "$tok")
ARTM=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['agent_rtm_uid'])" "$tok")
echo "user_rtm_uid=$URTM  agent_rtm_uid=$ARTM"

MARK=$(wc -l < "$MCPLOG" 2>/dev/null || echo 0)
echo "waiting 6s for agent to join..."; sleep 6

node "$HERE/rtm-play-test.cjs" "$APPID" "$URTM" "$TOKEN" "$CHAN" "$ARTM" "$BET" "$WAIT" || true

echo
echo "== baccarat-mcp tool calls for this run =="
tail -n +"$((MARK+1))" "$MCPLOG" 2>/dev/null | grep "$CHAN" || echo "(no tool calls logged for $CHAN)"

curl -s -m 20 -o /dev/null "$BACKEND/start-agent?profile=$PROFILE&hangup=true&agent_id=$AID" || true
echo "[hung up $AID]"

#!/usr/bin/env bash
# Example orchestrator: drive + compose all four providers with one source audio.
# Fill in the *_KEY / *_AVATAR values (or export them) before running.
set -euo pipefail
: "${AGORA_APP_ID:?}" ; : "${AGORA_APP_CERTIFICATE:?}"
export SDK_LIB="${SDK_LIB:?path to agora_sdk libs}"
export RECV_AV="${RECV_AV:-./recv_av}"
SRC="${SRC:-./input.m4a}"
ffmpeg -y -v error -i "$SRC" -ac 1 -ar 24000 -c:a pcm_s16le input_24k.wav
export WAV="$PWD/input_24k.wav"

run () { # name  driver  extra-env...
  local name=$1 driver=$2; shift 2
  env WORK="$PWD/$name" "$@" python3 "$driver"
  env WORK="$PWD/$name" SRC="$SRC" python3 compose_grid.py "$name.mp4" 480
}
run tavus drive_generic.py API_BASE=https://tavusapi.com/v2/conversations/agora API_KEY="$TAVUS_KEY" AVATAR_ID="$TAVUS_AVATAR"
run lemon drive_generic.py API_BASE=https://lemonslice.com/api/liveai/agora API_KEY="$LEMON_KEY" AVATAR_ID="$LEMON_AVATAR"
run proto drive_generic.py API_BASE=https://api.protoface.com/v1/agora/ API_KEY="$PROTO_KEY" AVATAR_ID="$PROTO_AVATAR"
run anam  drive_anam.py    API_KEY="$ANAM_KEY" AVATAR_ID="$ANAM_AVATAR" ANAM_MODEL=cara-4

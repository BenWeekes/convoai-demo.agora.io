#!/usr/bin/env bash
# build_grid.sh — human-reference N-cell sync grid.
#
# A human clip's audio drives several avatars (LemonSlice + Anam) lip-syncing the SAME
# audio; each avatar is time-aligned to the human clip (the reference) and composited into
# one square grid with the human's ORIGINAL audio. Built for the benb3 6-cell grid:
#   Row1: [ benb3 (human) | Anam | q3 ]   Row2: [ q4 | q5 | q6 ]   (3x2, 540px square cells)
#
# This is the vendor-grid pipeline (avatar-direct) with the HUMAN clip as the reference:
# because every avatar lip-syncs to the exact same source audio, alignment is a per-avatar
# OFFSET (flat), measured by align_grid.py; peak-warp is only needed if a cell actually drifts.
#
# Prereqs: source env.sh (see env.example.sh); `go build -o recv_av recv_av.go`.
# Secrets come from env.sh / agent-samples/simple-backend/.env — never hardcode them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
source "${ENV_FILE:-$HERE/env.sh}"

# ---- inputs ----
HUMAN="${HUMAN:-$HOME/benb3.mov}"          # cell 1 (reference); its audio drives all + is the mux audio
CELL="${CELL:-540}"                        # square cell size (px)
WORKROOT="${WORKROOT:-/tmp/bgrid}"; mkdir -p "$WORKROOT"
OUT="${OUT:-$HERE/benb_grid.mp4}"
UP="https://convoai-demo.agora.io/photo-uploads/benbgrid"   # where q3..q6 images are hosted
LS_BASE="https://lemonslice.com/api/liveai/agora"
# cells 2..6 in grid order: name|driver|avatar-id
AVATARS=(
  "anam|anam|9286a171-5713-4d90-bd02-5934344e2651"
  "q3|lemon|$UP/q3.png"
  "q4|lemon|$UP/q4.png"
  "q5|lemon|$UP/q5.png"
  "q6|lemon|$UP/q6.png"
)

# ---- 1. drive audio (24k mono PCM16) ----
WAV="$WORKROOT/input_24k.wav"
ffmpeg -y -v error -i "$HUMAN" -ac 1 -ar 24000 -c:a pcm_s16le "$WAV"
export WAV SDK_LIB RECV_AV AGORA_APP_ID AGORA_APP_CERTIFICATE

# ---- 2. drive + record + compose each avatar ----
for spec in "${AVATARS[@]}"; do
  IFS='|' read -r name driver aid <<<"$spec"
  work="$WORKROOT/$name"; mkdir -p "$work"
  if [ "$driver" = "anam" ]; then
    # directorNotes give Anam more energy (customStylePrompt + expressivity 0..1)
    env WORK="$work" AVATAR_ID="$aid" API_KEY="$ANAM_KEY" ANAM_MODEL="${ANAM_MODEL:-cara-4}" \
        ANAM_STYLE="${ANAM_STYLE:-Lively and animated, bright energy, quick expressive gestures, frequent smiling}" \
        ANAM_EXPRESSIVITY="${ANAM_EXPRESSIVITY:-1}" \
        python3 drive_anam.py
  else
    env WORK="$work" AVATAR_ID="$aid" API_BASE="$LS_BASE" API_KEY="$LS_KEY" ASPECT=1x1 \
        python3 drive_generic.py
  fi
  env WORK="$work" python3 compose_native.py "$WORKROOT/$name.mp4" "$CELL"
done

# ---- 3. measure per-avatar delay vs the human reference (flat offset; drift check) ----
#   align_grid.py prints: "<name>.mp4: ... delay=+1.050s ... drift=0.030s"
mapfile -t ALIGN < <(python3 align_grid.py "$HUMAN" \
  "$WORKROOT/anam.mp4" "$WORKROOT/q3.mp4" "$WORKROOT/q4.mp4" "$WORKROOT/q5.mp4" "$WORKROOT/q6.mp4")
printf '%s\n' "${ALIGN[@]}"
get_delay(){ printf '%s\n' "${ALIGN[@]}" | grep -oE "$1\.mp4: .*delay=[+-][0-9.]+" | grep -oE "delay=[+-][0-9.]+" | grep -oE "[+-][0-9.]+" | head -1; }
# NOTE: if any cell's drift is large (>~0.1s), warp it to the human with align_peak.py
# (see vendor-grid.md) instead of a flat pad.

# ---- 4. build the mux: crop each cell square, freeze-pad avatars by their delay, xstack 3x2 ----
FPS=30
# cell crops: benb3 1280x720 -> center 720 square; anam 1152x768 -> center 768 square; lemon 432 -> scale.
fc=""
fc+="[0:v]crop=720:720:280:0,scale=${CELL}:${CELL},fps=${FPS},setpts=PTS-STARTPTS[c0];"
i=1
for spec in "${AVATARS[@]}"; do
  IFS='|' read -r name driver aid <<<"$spec"
  d="$(get_delay "$name")"; d="${d#+}"; [ -z "$d" ] && d=0
  if [ "$name" = "anam" ]; then crop="crop=ih:ih:(iw-ih)/2:0,"; else crop=""; fi   # anam is landscape -> center square
  fc+="[$i:v]${crop}scale=${CELL}:${CELL},fps=${FPS},tpad=start_duration=${d}:start_mode=clone:stop_mode=clone,setpts=PTS-STARTPTS[c$i];"
  i=$((i+1))
done
fc+="[c0][c1][c2][c3][c4][c5]xstack=inputs=6:layout=0_0|${CELL}_0|$((CELL*2))_0|0_${CELL}|${CELL}_${CELL}|$((CELL*2))_${CELL}[v]"

ffmpeg -y -v error \
  -i "$HUMAN" \
  -i "$WORKROOT/anam.mp4" -i "$WORKROOT/q3.mp4" -i "$WORKROOT/q4.mp4" -i "$WORKROOT/q5.mp4" -i "$WORKROOT/q6.mp4" \
  -filter_complex "$fc" -map "[v]" -map 0:a \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -shortest "$OUT"
echo "built $OUT"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"

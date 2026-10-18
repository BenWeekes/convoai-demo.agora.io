# Reproduce the Trulience generic-protocol test (for Trulience)

Run exactly what we ran: drive your avatar over the **convoai_to_video generic protocol**, have it
publish into an Agora RTC channel, and record it. All scripts are in this `avatar-direct/` folder.

## What you need
- **Go** + the **Agora Go Server SDK** (to build the recorder `recv_av`).
- **Python 3**: `pip install requests websockets numpy`
- **ffmpeg** + **mkvtoolnix** (`apt-get install ffmpeg mkvtoolnix`)
- An **Agora project** (App ID + App Certificate) — your own is fine; the avatar publishes into a
  channel on *that* project.
- Your Trulience generic creds (below).

## Trulience test creds (yours)
```
API_BASE  = https://agora-pub.trulience.com/native-provider
API_KEY   = bwhQFqKSP4DZOj9LlSASPAE5mLprExz5na1syItCvDM
AVATAR_ID = 5933209494856748618
```

## 1. Build the recorder
```bash
cd avatar-direct
go build -o recv_av recv_av.go          # links the Agora Go Server SDK (see its go_sdk/vendor_sdk)
```

## 2. Environment
```bash
export AGORA_APP_ID=<your agora app id>
export AGORA_APP_CERTIFICATE=<your agora app certificate>
export SDK_LIB=/path/to/agora_sdk        # dir with the Agora Go SDK .so libs (LD_LIBRARY_PATH)
export RECV_AV=$PWD/recv_av
```

## 3. Prepare 24 kHz mono audio
```bash
ffmpeg -i your_audio.m4a -ac 1 -ar 24000 -c:a pcm_s16le in_24k.wav   # any speech clip
export WAV=$PWD/in_24k.wav
```

## 4. Drive the avatar + record  (this is the whole test)
```bash
WORK=$PWD/trl \
  AVATAR_ID=5933209494856748618 \
  API_BASE=https://agora-pub.trulience.com/native-provider \
  API_KEY=bwhQFqKSP4DZOj9LlSASPAE5mLprExz5na1syItCvDM \
  python3 drive_generic.py
```
What it does (see `drive_generic.py`): `POST {API_BASE}/session/start` (header `x-api-key`, body incl.
`agora_settings{app_id,token,channel,uid:102}`) → connects the returned `websocket_address` → sends
`init`, then `voice` frames (base64 24k PCM16, ~60 ms, paced real-time) → `voice_end`. Your avatar
publishes H.264 + audio into the Agora channel at **uid 102**, and `recv_av` records it to
`trl/recv.264` + `trl/audio.wav` (+ `trl/meta.txt`). On stop it `DELETE {API_BASE}/session/stop`.

## 5. Make the viewable mp4
```bash
WORK=$PWD/trl python3 compose_native.py trl.mp4 480     # reconstruct video + mux its own captured audio
```
`trl.mp4` is the standalone recording to eyeball (its OWN audio ⇒ self-consistent lip-sync).

## Optional: arbitrary resolution (video_settings passthrough)
Add `VIDEO_W`/`VIDEO_H`/`VIDEO_FPS` — the client sends a `video_settings:{width,height,fps}` block in
`session/start` + `init` (see the resolution-passthrough proposal in our test report):
```bash
VIDEO_W=1080 VIDEO_H=1920 VIDEO_FPS=30 WORK=$PWD/trl AVATAR_ID=5933209494856748618 \
  API_BASE=https://agora-pub.trulience.com/native-provider API_KEY=<key> python3 drive_generic.py
```

## Notes / what we observed
- Works end-to-end; avatar rendered + lip-synced, 854×480, ~0 drift vs the driving audio.
- We saw **no server→client WS messages** (no `init_ack`) — non-blocking, but an `init_ack` + error
  frames would help clients confirm init and detect failures without a timeout.
- Files: `drive_generic.py` (client), `recv_av.go` (recorder), `compose_native.py` (mux),
  `agora_token.py` (RTC token builder). Grid context: `../docs/ai/L1/female-vendor-grid.md`.

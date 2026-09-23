# avatar-direct — drive avatar providers directly (no ConvoAI)

Call generic avatar providers (**LemonSlice, Tavus, Protoface, Anam**) directly with
a **fixed WAV**, so each provider lip-syncs to the *same* audio, and record the
published video. Useful for byte-identical, side-by-side provider comparisons.

Normally Agora **ConvoAI** does this: it generates TTS and streams it to the avatar
provider, which joins your Agora channel and publishes lip-synced A/V. Here we play
ConvoAI's role ourselves but stream a WAV we control instead of live TTS.

Live demo grid (four providers, identical audio):
`https://convoai-demo.agora.io/avatar-overlay/avatar-grid.html`

## The unified protocol

Reference: **github.com/AgoraIO-Solutions/convoai_to_video** (generalized from Anam's
original). All the generic vendors implement the same shape:

```
POST {api_base}/session/start          headers: x-api-key: <KEY>
  body: { avatar_id, quality:"high", version:"v1", video_encoding:"H264",
          activity_idle_timeout:120, area:"NORTH_AMERICA",
          agora_settings:{ app_id, token, channel, uid, enable_string_uid:false } }
  -> 200/201 { session_id, websocket_address, session_token }

WS  {websocket_address}                 header: Authorization: Bearer <session_token>
  -> { command:"init", session_id, avatar_id, ...same fields..., agora_settings }
  -> { command:"voice", audio:<base64 PCM16>, sampleRate:24000, encoding:"PCM16", event_id }  (repeat, ~0.5s chunks)
  -> { command:"voice_end", event_id }

DELETE {api_base}/session/stop          body: { session_id }
```

Audio in is **24 kHz mono PCM16**. The provider publishes **H264** video (+ the echoed
audio) at `uid` into the Agora channel.

**Anam is the exception** — it predates `/session/start` and uses a two-step auth
against `api.anam.ai` (`/auth/session-token` then `/engine/session`), but the same WS
voice streaming. See `drive_anam.py`.

## Files

| File | What |
|---|---|
| `drive_generic.py` | Unified driver (LemonSlice / Tavus / Protoface / any `/session/start` vendor) |
| `drive_anam.py` | Anam two-step variant |
| `agora_token.py` | Agora v007 RTC/RTM token builder (mints the channel token) |
| `recv_av.go` | Go subscriber/recorder — captures the avatar uid's H264 → `recv.264` (+ per-frame `video.timestamps`), and its audio → `audio.wav` (+ `meta.txt`) |
| `compose_native.py` | Reconstruct video (mkvmerge, real timestamps) + mux the recording's **own captured** audio, aligned by the captured offset → streamable MP4 |
| `compose_src.py` | Same reconstruction, but mux a **pristine source** WAV (full 24k, byte-identical to what drove the lip-sync) instead of the band-limited echo — for the cleanest audio. Used by the commentary-overlay workflow (`docs/ai/L1/avatar-commentary-overlay.md`). |

## A/V sync — how the recording stays in sync (read this before touching it)

The rule: **do not align A/V yourself.** The provider publishes audio+video into the
Agora channel already in sync (shared RTP timing), so every subscriber receives them in
sync. We just record what comes out of the channel in realtime and never assume a fixed
FPS. Concretely:

1. **Warm up before joining.** `drive_*.py` opens the session and streams `init`, then
   waits `WARMUP` seconds (**default 15**) *before* starting `recv_av`. Slow providers
   (LemonSlice cold-start) publish video several seconds after their first audio; if the
   recorder joins immediately it captures that startup/silence lead and the clip looks
   offset. Joining *after* the provider is already publishing both streams makes
   `audio_offset_ms ≈ 0`, so **all four providers record identically**.
2. **Real per-frame timestamps, not fixed FPS.** `recv_av` writes each encoded frame's
   time to `video.timestamps` (mkvmerge v2, preferring the media `CaptureTimeMs` clock).
   `compose_native.py` feeds those to `mkvmerge --timestamps` so the reconstructed video
   keeps the true realtime cadence even when frames drop.
3. **Mux the recording's own audio, offset by the captured value only.** `recv_av`
   records only the avatar uid's republished (already-synced) audio to `audio.wav` and
   writes `audio_offset_ms` (audio start − video start) to `meta.txt`. `compose_native.py`
   locks `video[t] ↔ audio[t−offset]` — no cross-correlation, no lip/waveform matching.
4. **Trim to an identical lead + length.** Every clip is trimmed so speech begins at
   `LEAD` (0.5 s) with the same `DUR`, so the grid can start them together and they play
   in sync. (Verified: all four land within ~40 ms of each other.)

If sync ever looks off for one provider, the fix is almost always **more `WARMUP`**, not
post-processing math.

## Setup

- **recv_av**: build against the Agora Go Server SDK (v2.3.3+). It needs
  `LD_LIBRARY_PATH` pointing at the SDK's `agora_sdk` libs and `AGORA_APP_ID` /
  `AGORA_APP_CERTIFICATE`. It publishes a silent PCM track itself (otherwise the SDK
  segfaults on `OnCapabilitiesChanged` for some providers).
- **python**: `pip install requests websockets numpy`
- **mkvmerge**: `apt-get install mkvtoolnix` (for exact per-frame timing on compose)
- Source audio → 24 kHz mono PCM16:
  `ffmpeg -i input.m4a -ac 1 -ar 24000 -c:a pcm_s16le input_24k.wav`

## Usage

```bash
export AGORA_APP_ID=<appid> AGORA_APP_CERTIFICATE=<cert>
export SDK_LIB=/path/to/vendor_sdk/agora_sdk RECV_AV=./recv_av
export WAV=$PWD/input_24k.wav

# LemonSlice (avatar_id = an image URL)
API_BASE=https://lemonslice.com/api/liveai/agora API_KEY=$LEMON_KEY \
  AVATAR_ID='https://…/face.jpg' WORK=$PWD/lemon python3 drive_generic.py

# Tavus (avatar_id = persona id, e.g. p0f105b5b82e)
API_BASE=https://tavusapi.com/v2/conversations/agora API_KEY=$TAVUS_KEY \
  AVATAR_ID=p0f105b5b82e WORK=$PWD/tavus python3 drive_generic.py

# Protoface (avatar_id = av_stock_001 …)
API_BASE=https://api.protoface.com/v1/agora/ API_KEY=$PROTO_KEY \
  AVATAR_ID=av_stock_001 WORK=$PWD/proto python3 drive_generic.py

# Anam (two-step; avatar_id = anam avatar uuid, ANAM_MODEL=cara-4)
API_KEY=$ANAM_KEY AVATAR_ID=<uuid> ANAM_MODEL=cara-4 WORK=$PWD/anam python3 drive_anam.py

# Compose each: reconstruct video + mux its own captured audio, offset-aligned, trimmed
WORK=$PWD/tavus python3 compose_native.py tavus.mp4 480   # 480 = output height
```

`WARMUP` (seconds before the recorder joins, default 15) and `DUR` (record seconds) are
env-tunable per run. Bump `WARMUP` for a provider that's slow to start publishing video.

## Aspect ratio / dimensions

Each provider controls output size differently, and the `convoai_to_video` protocol
standardizes **no** size field (only `quality`, which is bitrate not resolution). Full
measured matrix — how to switch portrait/landscape/square and the exact dims per mode —
is in **`docs/ai/L1/avatar-provider-sizing.md`**. Quick version:

| Provider | Control | Modes (measured) |
|---|---|---|
| Anam | `width`/`height` (two-step) | cara-4: 1152×768 (3:2) or 768×1152 (2:3) only — no square |
| LemonSlice | `aspect_ratio` (`ASPECT=`) | 1x1→432² · 16x9→608×336 · 9x16→336×608 · 2x3→368×560 · 3x2→560×368 |
| Tavus | none (fixed by avatar) | `r82c08901584`→720×720; `aspect_ratio` ignored |
| Protoface | none (fixed) | 512×512; `aspect_ratio` ignored |

No aspect is shared by all four: **1:1** covers Tavus/LemonSlice/Protoface but not Anam
(floor 3:2); **2:3 / 3:2** covers Anam + LemonSlice only.

## Per-provider notes

- **LemonSlice** — `avatar_id` is an **image URL**; returns `201`; can be slow to cold-start.
  Output aspect follows the image unless you pass `ASPECT=1x1`/`3x2`; sends `init_ack`.
- **Tavus** — `avatar_id` is a **persona id** (`p…`); WS is a `media-proxy` host; 1280×720.
  Use a persona that exists on the key (list: `GET https://tavusapi.com/v2/personas`).
- **Protoface** — free tier is rate-limited (429 if you hammer it / leave sessions open);
  512×512; watermarked on the free plan.
- **Anam** — landscape 1152×768 or portrait 768×1152 depending on the avatar's checkpoint
  (`cara-4` avatars); some avatars only do `cara-3` @ 720×480. Two-step auth.

Keys/avatar ids are **not** committed — pass them via env.

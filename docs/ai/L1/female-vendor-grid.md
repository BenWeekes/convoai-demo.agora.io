# Female heart-shirt avatar — HUMAN-VOICE vendor comparison grid

A vendor-comparison grid of **one female avatar (red heart on a white t-shirt)** rendered by several
providers, all **driven by the same human voice recording (`~/f.m4a`), NOT TTS**. This is the
`build_grid.sh` human-reference method (identical audio drives every cell → flat per-cell OFFSET, and
that clean audio is the mux track) applied to the vendor-comparison avatars — NOT the old TTS vendor
grid (`vendor-grid.md`), which synced each tile to a channel-recorded anam reference with peak-warp.

Use this when the ask is "same woman, driven by a real voice clip, compare the vendors."

## Inputs
- **Audio (two sources, both preserved in `web/uploads/fgrid/` — gitignored but committed):**
  - `f.m4a` (~34.6s) — the **new human voice** this grid was built with.
  - `pp.m4a` (~19s) — the **original "purple peaches" track** the first vendor grid used (for
    regression / reproducing the original). Drives an older *different* avatar (bedroom/camisole woman),
    not this heart-shirt one — see `vendor-grid.md` + the chinese-vendor-grid memory.
  - Convert either to the drive format: `ffmpeg -i <audio> -ac 1 -ar 24000 -c:a pcm_s16le out_24k.wav`
    → **24 kHz mono PCM16** (required by HeyGen/LiveAvatar; also the final mux audio).
- **Source image (LemonSlice):** `sa.png` (the heart-shirt woman) hosted at
  `https://convoai-demo.agora.io/photo-uploads/fgrid/sa.png` (in `web/uploads/fgrid/`).

## Per-vendor avatar IDs (the female heart-shirt avatar)
| Vendor | Avatar id | Driver | Notes |
|---|---|---|---|
| **LemonSlice** | `…/photo-uploads/fgrid/sa.png` | `drive_generic.py` (`ASPECT=3x2`) | image URL of the woman ✓ |
| **Anam** | `c289b176-1bc1-4303-96aa-1343f58a1710` | `drive_anam.py` (`cara-4`) | Anam avatar IS the same woman ✓ |
| **Tavus** | `r69627e4e455` (replica) | `drive_generic.py` | female replica — NOT the default demo persona `p0f105b5b82e` (a man) |
| **Protoface** | `av_01M3KSSV6D8Z37AGD44Q2VPSC1` | `drive_generic.py` | female custom avatar — NOT `av_stock_001` (a man + watermark) |
| **HeyGen** | `c9c3b3b6-70de-4b61-8c27-8a7e48cc92a4` | `drive_heygen.py` (LiveAvatar) | female avatar ✓ (see HeyGen section) |
| **Trulience** | `5933209494856748618` | `drive_generic.py` | ✓ **generic now works** — endpoint `https://agora-pub.trulience.com/native-provider` speaks the SAME protocol (no longer export-only) |

All 6 are DIRECT-DRIVABLE (no ConvoAI, no exports). Keys/ids live in the private
`convoai-simple-backend/.env` `FGRID_*` block; `avatar-direct/env.sh` (gitignored) holds Agora/LS/Anam
creds. The default `TAVUS`/`PROTOFACE` *backend profiles* point at MALE demo avatars — do not reuse them.

## Build each cell (driven by f_24k.wav)
`cd avatar-direct && source env.sh`; each cell: drive → `recv_av` records the channel A/V →
`compose_native.py <out> 480` (reconstruct + mux its own captured audio, height 480).
```bash
export WAV=/tmp/fgrid/f_24k.wav
UP=https://convoai-demo.agora.io/photo-uploads/fgrid
# LemonSlice
WORK=/tmp/fgrid/lemon AVATAR_ID=$UP/sa.png API_BASE=https://lemonslice.com/api/liveai/agora API_KEY=$LS_KEY ASPECT=3x2 python3 drive_generic.py
# Anam
WORK=/tmp/fgrid/anam  AVATAR_ID=c289b176-1bc1-4303-96aa-1343f58a1710 API_KEY=$ANAM_KEY ANAM_MODEL=cara-4 ANAM_EXPRESSIVITY=0.8 python3 drive_anam.py
# Tavus (TAVUS_AVATAR_API_KEY from .env)
WORK=/tmp/fgrid/tavus AVATAR_ID=r69627e4e455 API_BASE=https://tavusapi.com/v2/conversations/agora API_KEY=$TKEY python3 drive_generic.py
# Protoface — use FGRID_PROTOFACE_API_KEY (its own account); top-crop later to drop the watermark
WORK=/tmp/fgrid/proto AVATAR_ID=$FGRID_PROTOFACE_AVATAR_ID API_BASE=https://api.protoface.com/v1/agora/ API_KEY=$FGRID_PROTOFACE_API_KEY python3 drive_generic.py
# HeyGen — LiveAvatar (NOT api.heygen.com); see the HeyGen section below
WORK=/tmp/fgrid/heygen HEYGEN_API_KEY=$FGRID_HEYGEN_API_KEY AVATAR_ID=$FGRID_HEYGEN_AVATAR_ID python3 drive_heygen.py
# Trulience — generic native-provider (same protocol as LemonSlice)
WORK=/tmp/fgrid/trl AVATAR_ID=$FGRID_TRULIENCE_AVATAR_ID API_BASE=$FGRID_TRULIENCE_BASE_URL API_KEY=$FGRID_TRULIENCE_API_KEY python3 drive_generic.py
# then compose each: WORK=/tmp/fgrid/<v> python3 compose_native.py /tmp/fgrid/<v>.mp4 480
```

## Mux
Because every cell lip-syncs to the SAME `f.m4a`, align is a flat OFFSET: trim the mux audio
(`f_24k.wav`) to ~0.5s before its speech onset, each cell is already composed with a 0.5s lead, so
speech lines up. `xstack` the cells (crop/scale to a common tile, Protoface watermark cropped), map
`f_24k.wav` as the single audio track, `-shortest`. Verify mouths open together at audio peaks.

## Credentials
All female-grid vendor keys + avatar ids live in the **private** `convoai-simple-backend/.env` under the
`FGRID_*` block (`FGRID_HEYGEN_API_KEY`, `FGRID_HEYGEN_AVATAR_ID`, `FGRID_PROTOFACE_API_KEY`,
`FGRID_PROTOFACE_AVATAR_ID`, `FGRID_TAVUS_AVATAR_ID`, `FGRID_ANAM_AVATAR_ID`, `FGRID_LEMON_IMAGE`,
`FGRID_TRULIENCE_BASE_URL`, `FGRID_TRULIENCE_API_KEY`, `FGRID_TRULIENCE_AVATAR_ID`).
The drive scripts source them from there; `avatar-direct/env.sh` (gitignored) holds the Agora/LS/Anam
creds. **Protoface's custom avatar is on a DIFFERENT account** than the backend `PROTOFACE_*` profile —
use `FGRID_PROTOFACE_API_KEY`, not `PROTOFACE_AVATAR_API_KEY`.

## HeyGen — direct drive (drive_heygen.py) ✓ WORKS
HeyGen's current streaming product is **"Live Avatar"** — a SEPARATE API at **`https://api.liveavatar.com/v1`**
(NOT `api.heygen.com/v1/streaming.*`, which 404s/401s — that's the old/legacy path). It publishes
straight to an Agora channel. `avatar-direct/drive_heygen.py` implements the TEN-framework
`heygen_avatar_python` flow:
`POST /sessions/token` (header `x-api-key`) with `{mode:"CUSTOM", avatar_id, video_settings:{quality},
agora_config:{agora_app_id,agora_token,agora_channel,agora_uid}}` → `data.session_id` + `data.session_token`
→ `POST /sessions/start` (header `authorization: Bearer <session_token>`, body `{}`) → `data.ws_url`
→ WS: `{"type":"agent.speak","audio":<b64 **24 kHz** mono PCM16>}` (~60ms frames) + `{"type":"session.keep_alive"}`
every 10s, then `{"type":"agent.speak_end","event_id"}` → `POST /sessions/stop` (`x-api-key`). recv_av
records uid 102. **Audio MUST be 24000 Hz** (`SUPPORTED_SAMPLE_RATES=[24000]`).
```bash
WORK=/tmp/fgrid/heygen HEYGEN_API_KEY=$FGRID_HEYGEN_API_KEY AVATAR_ID=$FGRID_HEYGEN_AVATAR_ID \
  WAV=/tmp/fgrid/f_24k.wav python3 drive_heygen.py
```
Reference impl kept at `~/heygen.py` + `~/extension.py` (TEN-framework).

## Vendor gotchas (this build)
- **Tavus** `r…` is a **replica** id; the `/v2/conversations/agora` WS can be slow to come up (saw a
  one-off WS read timeout — retry with a longer `WARMUP`). The default demo id `p0f105b5b82e` is a man.
- **Protoface** `av_01M3KSSV…` needs its **own account key** (`FGRID_PROTOFACE_API_KEY=sk_live_I3RF…`);
  with the backend's `PROTOFACE_AVATAR_API_KEY` it 400s `avatar.not_found`. With the right key it
  renders (crop `480:286:0:80` to drop the "Powered by Protoface" watermark).
- **HeyGen** ✓ works via the **LiveAvatar** API (above). KEY GOTCHA: the key goes to
  `api.liveavatar.com`, NOT `api.heygen.com` — on `api.heygen.com` the same key returns 401
  `Unauthorized` / the `streaming.*` paths 404. The `FGRID_HEYGEN_API_KEY` UUID is correct *for
  LiveAvatar*. Output is 854×480.
- **Trulience** ✓ generic protocol works now (2026-10-18) — `API_BASE=https://agora-pub.trulience.com/native-provider`
  with `drive_generic.py`, same as LemonSlice; publishes to the Agora channel, recorded by recv_av.
  No longer export-only. Note: it sends NO server→client WS messages (no `init_ack`) — harmless but a
  parity gap (see the test report `web/uploads/fgrid/trulience-generic-test.md`).

See `vendor-grid.md` (the TTS/export comparison grid + heart recolor + blind `/avatar-compare/` publish)
and `avatar-direct/README.md` (drivers, recorder, `compose_native`, A/V-sync rules).

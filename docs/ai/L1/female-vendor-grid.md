# Female heart-shirt avatar — HUMAN-VOICE vendor comparison grid

A vendor-comparison grid of **one female avatar (red heart on a white t-shirt)** rendered by several
providers, all **driven by the same human voice recording (`~/f.m4a`), NOT TTS**. This is the
`build_grid.sh` human-reference method (identical audio drives every cell → flat per-cell OFFSET, and
that clean audio is the mux track) applied to the vendor-comparison avatars — NOT the old TTS vendor
grid (`vendor-grid.md`), which synced each tile to a channel-recorded anam reference with peak-warp.

Use this when the ask is "same woman, driven by a real voice clip, compare the vendors."

## Inputs
- **Audio:** `~/f.m4a` (~34.6s). `ffmpeg -i ~/f.m4a -ac 1 -ar 24000 -c:a pcm_s16le /tmp/fgrid/f_24k.wav`
  — 24 kHz mono PCM16, the drive format AND the final mux audio.
- **Source image (LemonSlice):** `~/sa.png` (the heart-shirt woman) → host it (LemonSlice needs a URL):
  `cp ~/sa.png web/uploads/fgrid/sa.png` → `https://convoai-demo.agora.io/photo-uploads/fgrid/sa.png`.

## Per-vendor avatar IDs (the female heart-shirt avatar)
| Vendor | Avatar id | Driver | Notes |
|---|---|---|---|
| **LemonSlice** | `…/photo-uploads/fgrid/sa.png` | `drive_generic.py` (`ASPECT=3x2`) | image URL of the woman ✓ |
| **Anam** | `c289b176-1bc1-4303-96aa-1343f58a1710` | `drive_anam.py` (`cara-4`) | Anam avatar IS the same woman ✓ |
| **Tavus** | `r69627e4e455` (replica) | `drive_generic.py` | female replica — NOT the default demo persona `p0f105b5b82e` (a man) |
| **Protoface** | `av_01M3KSSV6D8Z37AGD44Q2VPSC1` | `drive_generic.py` | female custom avatar — NOT `av_stock_001` (a man + watermark) |
| **HeyGen** | `c9c3b3b6-70de-4b61-8c27-8a7e48cc92a4` | (see HeyGen note) | female avatar |
| **Trulience** | — | EXPORT-ONLY | hand-rendered mp4; can't be driven with new audio |

Keys live in `.env` (`TAVUS_AVATAR_API_KEY`, `PROTOFACE_AVATAR_API_KEY`) / `avatar-direct/env.sh`
(`LS_KEY`, `ANAM_KEY`). The default `TAVUS`/`PROTOFACE` backend profiles point at MALE demo avatars —
do not reuse them for this grid.

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
# Protoface (PROTOFACE_AVATAR_API_KEY)  — crop 480:286:0:80 later to drop the watermark
WORK=/tmp/fgrid/proto AVATAR_ID=av_01M3KSSV6D8Z37AGD44Q2VPSC1 API_BASE=https://api.protoface.com/v1/agora/ API_KEY=$PKEY python3 drive_generic.py
# then: WORK=/tmp/fgrid/<v> python3 compose_native.py /tmp/fgrid/<v>.mp4 480
```

## Mux
Because every cell lip-syncs to the SAME `f.m4a`, align is a flat OFFSET: trim the mux audio
(`f_24k.wav`) to ~0.5s before its speech onset, each cell is already composed with a 0.5s lead, so
speech lines up. `xstack` the cells (crop/scale to a common tile, Protoface watermark cropped), map
`f_24k.wav` as the single audio track, `-shortest`. Verify mouths open together at audio peaks.

## Credentials
All female-grid vendor keys + avatar ids live in the **private** `convoai-simple-backend/.env` under the
`FGRID_*` block (`FGRID_HEYGEN_API_KEY`, `FGRID_HEYGEN_AVATAR_ID`, `FGRID_PROTOFACE_API_KEY`,
`FGRID_PROTOFACE_AVATAR_ID`, `FGRID_TAVUS_AVATAR_ID`, `FGRID_ANAM_AVATAR_ID`, `FGRID_LEMON_IMAGE`).
The drive scripts source them from there; `avatar-direct/env.sh` (gitignored) holds the Agora/LS/Anam
creds. **Protoface's custom avatar is on a DIFFERENT account** than the backend `PROTOFACE_*` profile —
use `FGRID_PROTOFACE_API_KEY`, not `PROTOFACE_AVATAR_API_KEY`.

## HeyGen — direct drive (drive_heygen.py)
HeyGen CAN publish straight to an Agora channel (no LiveKit bridge): its streaming API supports
`version:"agora_v1"` with `agora_settings`. `avatar-direct/drive_heygen.py` implements the
TEN-framework flow (`github.com/TEN-framework/ten-framework .../heygen_avatar_python`):
`POST /v1/streaming.create_token` (x-api-key) → `POST /v1/streaming.new` (Bearer; `avatar_name`,
`version:agora_v1`, `agora_settings{app_id,token,channel,uid}`, `namespace:demo`) →
`/v1/streaming.start` → WS `{"type":"agent.speak","audio":<b64 **24k mono PCM16**>,"event_id"}` …
`{"type":"agent.speak_end"}` → `/v1/streaming.stop`. recv_av records uid 102.
```bash
WORK=/tmp/fgrid/heygen HEYGEN_API_KEY=$FGRID_HEYGEN_API_KEY AVATAR_ID=$FGRID_HEYGEN_AVATAR_ID \
  WAV=/tmp/fgrid/f_24k.wav python3 drive_heygen.py
```

## Vendor gotchas (this build)
- **Tavus** `r…` is a **replica** id; the `/v2/conversations/agora` WS can be slow to come up (saw a
  one-off WS read timeout — retry with a longer `WARMUP`). The default demo id `p0f105b5b82e` is a man.
- **Protoface** `av_01M3KSSV…` needs its **own account key** (`FGRID_PROTOFACE_API_KEY=sk_live_I3RF…`);
  with the backend's `PROTOFACE_AVATAR_API_KEY` it 400s `avatar.not_found`. With the right key it
  renders (crop `480:286:0:80` to drop the "Powered by Protoface" watermark).
- **HeyGen** — the driver exists (above); needs a **valid HeyGen API key** (Settings → API, a long
  base64 string, NOT a UUID — a UUID returns 401 `Unauthorized`). NB HeyGen v1/v2 are legacy (removed
  2026-10-31); if v1 `streaming.*` 404s later, migrate to the v3 streaming API.
- **Trulience** is export-only — supply a fresh f.m4a export or omit it.

See `vendor-grid.md` (the TTS/export comparison grid + heart recolor + blind `/avatar-compare/` publish)
and `avatar-direct/README.md` (drivers, recorder, `compose_native`, A/V-sync rules).

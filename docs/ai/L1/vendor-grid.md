# Vendor avatar-comparison grid — preparation process (single source of truth)

How to build / refresh the **blind** avatar-comparison grids + polls. This is the ONE place for the
end-to-end recipe; `avatar-commentary-overlay.md` holds the deeper mux-alignment gotchas it shares,
and memory `project-chinese-vendor-grid` has the originating run notes.

## What ships

Canonical home `/avatar-compare/` (avatar-overlay node app, `public/avatar-compare/`). Four
independent, un-linked, blind top-level URLs per language:
- `english-grid/` + `chinese-grid/` — interactive 6-tile; each tile → blind solo `solo/?v=<1-6>&l=<en|zh>`
- `english-vote/` + `chinese-vote/` — a 3×2 **mux** video + ranking form
- scored variant `vote-en/` (lip-sync + engagement /10); upper-body `vote-body-en/`
- secret results `results/?key=<VENDOR_POLL_KEY>&lang=<en|zh|en-scores>` (blind→real map lives here)

**Blind map (EN and ZH): Vendor 1=Tavus, 2=Trulience, 3=Anam, 4=Protoface, 5=HeyGen, 6=LemonSlice.**
Mux tiles are row-major (TL→BR) in that order → **Trulience = position 2 (top-middle)**. The `results`
page REAL map is ground truth; the `NAMES=[…]` array in a vote page is its form order, NOT the mux order.

## Media layout

All blind: `media/{en,zh}-{1..6}.mp4` (tiles, 720×480) + `media/{en,zh}-mux.mp4` (1920×852 = 3×2 of
640×426). Non-blind source tiles are kept as `public/grid-<vendor>.mp4` (en) / `public/grid2-<vendor>-zh.mp4`
(zh). **Media is gitignored** in avatar-overlay (code-only repo) — it lives on the box; back up
elsewhere if it matters (the Trulience vendor exports especially — not regenerable).

## The reference: everything syncs to ANAM

The shared track is one common script read; every tile must lip-sync to it. **Anam is the reference
tile** (`grid-anam.mp4` / `grid2-anam-zh.mp4`); its audio is the common track and is the audio used
in the mux and in each solo tile. All other vendors are time-warped to it.

## Per-vendor source

- **Channel-driven vendors** (Tavus, Anam, Protoface, HeyGen, LemonSlice): recorded from the Agora
  channel via `avatar-direct/compose_native.py` (echo tiles, height 480). Protoface cropped
  `480:286:0:80` to drop its watermark.
- **Trulience is export-only** — they hand over a 2560×1440 mp4 (`~/tru-en.mp4`, `~/tru-zh.mp4`).
  Fit to the tile with **`crop=1608:1072:471:64,scale=720:480,fps=30`** (matches the others' head
  size; looser leaves it small, tighter over-zooms).

## 1) Time-align each vendor — METHOD DEPENDS ON VENDOR TYPE

**The mux audio is the anam tile's audio + a ~1.3s lead pad** (measured: `zh-mux` audio vs
`grid2-anam-zh.mp4` audio = corr 1.000 at lag 1300ms). So "the reference" is anam's *channel
recording*, which itself drifts ~120–300ms vs the clean source in the early section only.

- **EXPORT-ONLY vendors (Trulience): OFFSET-ONLY — NEVER peak-warp.** An offline export is
  frame-accurate to the audio track the vendor was given (verified: `tru-zh` audio vs the clean
  `pp-chinese-v3.wav` = corr **0.988 with ZERO drift** early/mid/late). Warping it to a channel-
  recorded reference *distorts* an already-perfect clip (a prior pass applied 0.72–1.5× per-phrase
  scales — wrong). Just **trim to speech onset** (zh ≈7.77s) and apply the **mux lead pad** (§3).
  A small early residual is expected and acceptable — it's anam's early drift, not Trulience's; do
  NOT chase it with a warp.
- **CHANNEL-RECORDED vendors (Tavus, Anam, Protoface, HeyGen, LemonSlice): PEAK-ANCHORED warp.**
  Real-time playout drifts (rate/latency), ~150ms ahead around ONE phrase then snaps back — a global
  stretch can't fix local drift. Anchor on the **major audio peaks** (stressed syllables the mouth
  follows):

Use **`/home/ubuntu/web/avatar-direct/align_peak.py`** (numpy-only) — for channel-recorded vendors:
```
python3 align_peak.py --ref grid2-anam-zh.mp4 --vendor <prepped-vendor>.mp4 \
        --out <aligned>.mp4 [--vendor-leadin <sec>]
```
It extracts both audios (mono 16k f32), builds an RMS envelope, picks prominent peaks (>0.3·max, min
1 s apart), matches them 1:1 in order (~12 for the pp track), and piecewise-linearly warps the
**vendor video** (trim+setpts concat) so its peaks land on anam's peak times. Then attach anam's
audio to the aligned video to make the tile.

**Gotchas (hard-won — see avatar-commentary-overlay.md):**
- Align on **speech onset / peaks**, and trim the shared audio by the reference's own onset, or every
  mouth sits ~300ms ahead.
- **Envelope cross-correlation misaligns an exported clip (Trulience) vs channel-recorded tiles** by
  ~0.3s — different envelope shape. Peak-anchoring avoids this.
- The residual-lag self-check is **fooled by repetitive speech**; **verify on the video/mouth**, not
  by warping audio with `atempo`.
- **Normalize by DRIFT SLOPE, not onset→offset span** (Tavus rings a longer tail while in sync; span-
  normalizing it *introduces* drift).

**VERIFY (mandatory):** grab the mux/tile frame at a loud reference peak — all mouths open together;
in a silence — all closed. Compare the warped tile vs anam at the same timestamp (same vowel shape).

## 2) Chinese tiles: GREEN heart (English = RED)

Chinese tiles carry a green heart so the two language builds are distinguishable; English keeps red.
Vendor exports may ship the wrong color — recolor red→green by swapping R↔G only inside the lower-chest
heart ROI (on the finished 720×480 tile), via `colorchannelmixer` + `geq` mask + `maskedmerge`:
```
GEQ="255*gt(Y\,0.73*H)*gt(X\,0.30*W)*lt(X\,0.72*W)*gt(r(X\,Y)-g(X\,Y)\,58)*gt(r(X\,Y)-b(X\,Y)\,45)*gt(r(X\,Y)\,105)"
ffmpeg -y -i tile.mp4 -filter_complex "\
 [0:v]split=3[base][sw][m];\
 [sw]colorchannelmixer=rr=0:rg=1:rb=0:gr=1:gg=0:gb=0:br=0:bg=0:bb=1[swapped];\
 [m]format=rgb24,geq=r='$GEQ':g='$GEQ':b='$GEQ'[mask];\
 [base][swapped][mask]maskedmerge[out]" -map "[out]" -map 0:a -c:a copy tile-green.mp4
```
ROI = `Y>0.73·H && X∈[0.30·W,0.72·W] && r−g>58 && r−b>45 && r>105`. The **X center-band is essential**
(else it catches a red background object + leaves the heart patchy); `Y>0.73` because hearts sit at
frac≥0.78 while chins/lips are ≤0.70. Thresholds are **per-export** — VERIFY on a frame (heart fully
green, skin/background clean; or sample heart-region avg RGB and check G>R). Loosen `r−g` if patchy;
narrow `X`/raise `Y` if skin leaks.

## 3) Blind-copy + build the mux

- Copy each aligned (and, for zh, green) tile → `media/<lang>-<N>.mp4` (N = blind Vendor number).
- Mux = 3×2 @1920×852, tiles 640×426, row-major Vendor 1..6, **anam's audio** (`-c:a copy`), each tile
  labelled `drawtext 'Vendor N'` (white on black box, fontsize ~22, x=8 y=2). To replace ONE vendor
  without a full rebuild: overlay the new 640×426 warped tile onto the existing mux at that tile's
  (x,y) — position 2 is (640,0) — `-c:a copy`, duration unchanged. Keep originals in
  `media/_backup_pre_tru/` before overwriting.
- **MUX LEAD-IN PAD (critical, easy to miss).** The mux **audio has a ~1.3s silent lead-in**, and every
  tile is **freeze-padded by that much** so mouths land on the audio — measured anam delay inside the
  mux is **+1.300s (EN) / +1.333s (ZH)** (lands within ~0.03s of the audio). So when overlaying a
  replacement tile, prepend the same freeze pad — `tpad=start_duration=1.30:start_mode=clone:stop_mode=clone`
  (ZH 1.333) — BEFORE the overlay. Overlaying a natural-timed tile from t=0 looks "duration-correct"
  but is ~1.3s early. (Standalone grid tiles are muted + loop independently, so they don't need the
  pad; only the mux shares one audio.)

## To replace a single vendor tile (e.g. a fresh Trulience export)

1. Prep the source → 720×480 tile (export: crop/scale above; channel: compose_native).
2. **Align by type:** export (Trulience) → **offset only** (trim to onset; apply mux lead pad at the
   overlay step — §3 — do NOT warp); channel-recorded → `align_peak.py` against anam.
3. (zh) recolor the heart green; verify.
4. Standalone tile → `media/{en,zh}-<N>.mp4` (attach anam audio; muted anyway). Mux: overlay the
   640×426 tile at the tile's position with the **freeze pad** (§3) → `media/{en,zh}-mux.mp4`.
5. Verify sync via a tile-vs-anam mouth montage at mux peaks + a silence, zoom vs neighbors, (zh)
   heart color. Media stays on the box (gitignored).

## Human-reference variant (human clip + N avatars, same voice)

A variant where **a human's recorded clip drives several avatars** lip-syncing that person's
voice, muxed into one square grid (e.g. the benb3 6-cell grid: `[benb3|Anam|q3] / [q4|q5|q6]`,
3×2, 540px cells). Reference impl: **`avatar-direct/build_grid.sh`** (+ `align_grid.py`).

- **The human clip is the sync reference** and its **original audio is the mux audio** (not a
  recorded cell — avoids the anam-drift problem that bit the vendor grid). The human cell sits at
  offset 0; the avatars are fitted to it.
- **Drive** each avatar (LemonSlice via `drive_generic.py` with the hosted image URL + `ASPECT=1x1`;
  Anam via `drive_anam.py` with the avatar uuid + `cara-4`) using the human's 24k mono WAV, record
  with `recv_av`, compose with `compose_native.py`.
- **Alignment is a flat per-avatar OFFSET** here (unlike channel-recorded vendors that drift):
  because every avatar lip-syncs to the *exact same* source audio, `align_grid.py` measures a
  single delay per avatar (benb3 onset 1.55s, avatars ~0.5s → ~1.05–1.12s freeze-pad) with windowed
  drift all <0.07s. Apply `tpad=start_duration=<delay>:start_mode=clone:stop_mode=clone`; only reach
  for the peak-warp if a cell's windowed drift is actually large.
- **Mux**: crop each cell square (human 1280×720→center 720², Anam landscape→center square, LemonSlice
  432²), `xstack` 3×2, map the human's audio. Cartoon source images render **full-body** (small
  faces) vs the human/LemonSlice head-shots — crop those cells tighter if a uniform head size is wanted.
- **Verify** the same way: mouth-vs-human montages at 2–3 audio peaks + a silence (NOT a fixed-Y
  "mouth band" — faces sit at different heights per cell; use full-frame captures).

### Direct-drive gotchas (hard-won — `drive_*`, `compose_native.py`)

- **A short cell is almost always `compose_native`, NOT the provider.** It used to default
  `DUR=20.0` and silently `trim` every clip to 20s. A whole session was burnt chasing a phantom
  "Anam 20s session cap" that did not exist — the raw `v.mkv`/`audio.wav` in the WORK dir were the
  full ~45s the entire time; only the composed `.mp4` was 20s. **Before blaming a provider for a
  short/early-ending cell, `ffprobe` the raw capture (`WORK/v.mkv`, `WORK/audio.wav`).** If those are
  full-length, it is compose. Fixed: `compose_native` now keeps the **full captured length** from
  `vstart` when `DUR` is unset (pass `DUR=<s>` only to deliberately cap). Anam has **no** session
  length cap (confirmed on the client: 25fps locked 10s→91s).
- **LemonSlice send cadence: ~60ms frames, never 0.5s bursts.** `drive_generic.py` streamed
  half-second `voice` chunks then slept 0.5s; that under-runs LemonSlice's jitter buffer and the
  channel-published audio glitches at the chunk boundaries. Stream **small ~60ms frames paced
  real-time** (`STEP=0.06`), matching the clean h2a/`puppet_session.py` bridge (`CHUNK=SR*2*0.06`).
  (Moot in the *final* grid — it plays the human's clean audio — but it matters for standalone
  review clips and any live use.)
- **Anam liveliness = `directorNotes`.** `drive_anam.py` folds `ANAM_STYLE` (→`customStylePrompt`)
  and `ANAM_EXPRESSIVITY` 0..1 (→`expressivity`) into `personaConfig.directorNotes`. `build_grid.sh`
  defaults both (lively prompt, expressivity 1). Model is `cara-4`.
- **Anam kill endpoint 404s.** `POST /engine/session/{id}/kill` returns an HTML 404 from
  `api.anam.ai/v1` (same path ConvoAI's extension uses). Sessions are reaped by `activityIdleTimeout`
  instead (ConvoAI uses 120s; keep ours modest so leaked sessions self-clear). Not the cause of any
  truncation — see the compose gotcha above.

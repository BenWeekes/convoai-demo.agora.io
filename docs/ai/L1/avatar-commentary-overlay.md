# Avatar commentary overlay (Gina hosts a video)

How to make an avatar **commentate over an existing video** — analyse the footage,
write timed personality-driven commentary, voice it cleanly, lip-sync it on an avatar,
chroma-key the avatar's background out, and composite it into the corner. Built on the
direct-drive stack in `avatar-direct/` (see that README first).

Live example: `/avatar-overlay/lotto-gina.html` (v3 tags) and `/avatar-overlay/lotto-gina-v2.html`
(v2 per-line emotion) — "Gina" hosting a 49's lotto draw. Scratchpad scripts for that build
live outside the repo; the reusable pieces are `avatar-direct/compose_src.py` plus the
recipes below.

## Pipeline

```
source video ──▶ analyse frames ──▶ write timed commentary
                                          │
              ElevenLabs TTS (clean) ◀────┘
                     │  place each line at its cue on a silent canvas
                     ▼
             timed track (mono 24k, = video length)
                     │  drive avatar (LemonSlice etc.), 15s warmup, record
                     ▼
             avatar video (blue bg) ──▶ align track-t0 ──▶ chroma-key ──▶ overlay on source ──▶ publish
```

## 1. Analyse the footage

Build timestamped contact sheets so you can read on-screen events and pin exact cue times:

```bash
ffmpeg -i in.mov -vf "fps=1/3,scale=480:-2,drawtext=text='%{pts\:hms}':x=6:y=6:\
fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6" -q:v 3 f_%03d.jpg
montage f_0[0-1]*.jpg -tile 5x4 -geometry +2+2 sheet1.jpg      # view sheets
```

Re-sample a tight window at `fps=1` (crop to the region of interest) to pin fast events
(e.g. exact ball-drop seconds) to ±1s. Note every cue time + what's on screen.

## 2. Write the commentary

- One utterance per on-screen beat; call out what the viewer sees **as** it appears.
- Weave in the character's traits (the example Gina: favourite number 8, colour green,
  "Bet 2 Match 2 = £2→£500", laughs when a sum is a round 10/20/30).
- **Fill dead air**: add anticipation lines during waits (e.g. while the machine spins).
- Keep each line short enough to finish before the next cue (calls ~1–3s).

## 3. Voice it — CLEAN audio (this is what removes crackle)

- Request **raw PCM**, never MP3: `output_format=pcm_24000` (MP3 128k adds crackle on
  sibilants). Then apply a limiter for headroom:
  `ffmpeg -f s16le -ar 24000 -ac 1 -i in.raw -af "alimiter=level_in=1:level_out=0.84:limit=0.97:attack=5:release=50" out.wav`
- **Emotion**, two options:
  - **v3** (`eleven_v3`): inline audio tags (see below). Run at **stability ~0.3** or the
    tags barely register.
  - **v2** (`eleven_multilingual_v2`): no tags; set **per-line** `style` (higher = more
    expressive, ~0.8 for hype/ball-calls) and `stability` (lower = more variation, ~0.25),
    `use_speaker_boost:true`. This gave the more natural, varied read in the example.

### ElevenLabs v3 audio tags (reference)

The tag set is **open-ended, not a fixed enum** — the model interprets bracketed cues, so
descriptive tags like `[announcing]`, `[tense]`, `[nervous]`, `[dramatically]`,
`[whispering]` work by interpretation even though they aren't in the official list.
Documented working tags (elevenlabs.io/docs/best-practices/prompting/eleven-v3):

- **Emotion / delivery:** `[excited]` `[sarcastic]` `[curious]` `[crying]` `[mischievously]` `[snorts]`
- **Non-verbal vocal:** `[laughs]` `[laughs harder]` `[starts laughing]` `[wheezing]` `[whispers]` `[sighs]` `[exhales]` `[swallows]` `[gulps]`
- **Sound effects** (hit-or-miss): `[gunshot]` `[applause]` `[clapping]` `[explosion]`
- **Experimental:** `[strong X accent]` (fill in X) `[sings]` `[woo]` `[fart]`

Caveats: tag effect is **voice-dependent** (a calm voice resists `[shouting]`); **stability**
gates responsiveness (Creative ~0.0 = most expressive but can hallucinate, Natural ~0.5 =
balanced, Robust ~1.0 = ignores directional tags); **punctuation** (ellipses, CAPS, `!`)
complements tags — lean on it when a tag reads flat. Tags are directives, so for non-English
speech keep the **spoken text in the target language and the bracket tags in English**
(e.g. German commentary with `[excited]`/`[tense]` cues).

### Clean an existing recording's audio (de-crackle / de-noise)

To strip crackle and non-voice static from an **already-recorded** mp4 (not TTS), keep the
video and reprocess only the audio:

```bash
# declick (crackle) + RNNoise (voice-trained; drops non-voice noise, keeps speech)
curl -sL -o std.rnnn https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn
ffmpeg -i in.mov -af "adeclick,arnndn=m=std.rnnn" -c:v copy -c:a aac -b:a 192k -movflags +faststart out.mp4
```

- `adeclick` targets impulsive crackle; `arnndn` (RNNoise) removes broadband hiss/static
  while preserving voice — far better than a static `afftdn`/`highpass` for speech.
- More aggressive: add `afftdn=nf=-30` or a stronger declick. Gentler: `arnndn` alone.
- Verify by comparing **spectrograms** (`showspectrumpic`) — the inter-word haze should drop
  while the speech harmonics stay intact — and the quietest-20% RMS (noise floor).

## 4. Assemble the timed track

Place each limited utterance at its cue on a silent canvas the length of the video, in
numpy; if a line runs long, push the next start to `prev_end + 0.15` so they never overlap.
Write one mono 24k wav (the driver's input **and** the final audio). Verify it's silent
between cues and speaking on each cue with a quick RMS-per-window check.

## 5. Drive the avatar + record

Use `avatar-direct/drive_generic.py` with `WAV=<timed_track>` and `WARMUP=15` (recorder
joins only once the provider is already publishing A/V in sync — see the sizing/sync notes
in `avatar-direct/README.md`). For a 155s track expect a ~3-minute record. Silence in the
track = idle face; speech = lip-sync.

## 6. Align + chroma-key + composite

**A/V sync rule.** `recv_av` captures the provider's video AND audio *already in sync* from
the Agora channel (the 15s warmup only lets it start publishing). Two ways to use that:

- **Best for overlays (clean audio + sync):** mux the **clean 24k source** (the timed track),
  positioned by **envelope cross-correlation of the recorded echo against that source**. The
  echo is the source as the channel played it, so the cross-correlation offset is *exact*
  (same content) — `vstart = xcorr_lag(echo, source) + audio_offset`, then trim the video from
  `vstart` and mux the source from 0. You get pristine 24k audio AND RTC-accurate sync.
- **Quick fallback (sync, but 16k/clicky):** `compose_native.py` muxes the recorded **echo**
  audio (`astart = vstart − audio_offset`) and you overlay with that clip's own audio. Simple
  and always in sync, but the echo carries the channel's Opus/jitter-buffer artifacts —
  audibly **clicky/poppy** vs the clean source. Only use it when audio quality doesn't matter.

**Never** position the video by single-threshold **onset detection** — an onset caught a few
ms off pushes the mouth *ahead* of the voice (cost ~190ms on a roulette clip). Cross-correlation
is exact; onset is not.

```bash
# in-sync avatar clip: recorded video + recorded echo audio (compose_native handles the offset)
WORK=<rec_dir> DUR=<len> python3 compose_native.py avatar.mp4 <height>
# roulette/base video (keep its watermark; freeze the tail for the outro)
ffmpeg -i source.mov -vf "tpad=stop_duration=3.5:stop_mode=clone" -an base.mp4
# composite: key the bg out, overlay, and use the AVATAR CLIP'S OWN audio (map 1:a)
ffmpeg -i base.mp4 -i avatar.mp4 -filter_complex \
 "[1:v]chromakey=0x28b22b:0.16:0.01[g];[0:v][g]overlay=x=W-w+55:y=H-h:shortest=1[v]" \
 -map "[v]" -map "1:a" -t <len> \
 -c:v libx264 -crf 21 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart out.mp4
```

Sample the avatar's background colour from a corner first (`ffprobe`/pixel read).

## Gotchas (learned the hard way)

- **Use `colorkey` (RGB), not `chromakey`, for a BLUE background** — `chromakey` works in
  YUV and wipes the whole subject for this blue. `colorkey=0x0061f5:0.24:0.08` keeps the
  green dress/skin cleanly.
- **Never put `-ss` on both overlay inputs** — two input-seeks desync the overlay PTS and
  the avatar silently doesn't render. Add `setpts=PTS-STARTPTS` when seeking one input for a
  still test; for the real render feed both from t=0 (no input `-ss`).
- **A/V sync — mux the clean source, positioned by cross-correlation (NOT onset).** The recorded
  echo is in sync with the video from the channel but sounds **clicky/poppy** (16k Opus + jitter
  buffer). Mux the clean 24k **source** instead, and find its position by cross-correlating the
  echo against the source (exact — same content). Onset-detection positioning is the trap that
  drifts (~190ms, mouth ahead of voice). The echo (`compose_native`, `-map 1:a`) is the quick
  in-sync fallback when audio quality doesn't matter, but for anything a viewer listens to,
  use the clean source.
- **Multi-avatar mux (one shared audio):** you can't give each tile its own audio, so align
  every tile's video to the shared track by **envelope cross-correlation of its audio against
  the reference tile's audio** (all avatars lip-synced the *same* source, so matching the
  audio content matches the mouths). This preserves each avatar's RTC sync on the shared
  track — verify residual lag ≈ 0 for every tile. Single-threshold onset detection is NOT
  reliable here (providers' onsets varied by 300–800ms).
- **Cue timing drift**: a long line pushes later lines; keep hype lines tight, or the cold
  read lands after its on-screen graphic.
- **Ordinal calls read better**: "the second ball… thirty-nine", not just "thirty-nine".

See `avatar-provider-sizing.md` for per-provider aspect/size control and
`avatar-direct/README.md` for the driver, recorder, and A/V-sync warmup method.

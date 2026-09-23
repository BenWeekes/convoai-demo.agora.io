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
  - **v3** (`eleven_v3`): inline tags `[excited]`, `[announcing]`, `[laughs]` — subtle.
  - **v2** (`eleven_multilingual_v2`): no tags; set **per-line** `style` (higher = more
    expressive, ~0.8 for hype/ball-calls) and `stability` (lower = more variation, ~0.25),
    `use_speaker_boost:true`. This gave the more natural, varied read in the example.

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

Reconstruct with real timestamps, find where **track t=0** sits in the recording, trim the
avatar clip so its t=0 == source-video t=0, then key + overlay. `avatar-direct/compose_src.py`
does the audio-onset alignment for a single clip; the overlay adds:

```bash
mkvmerge -o v.mkv --timestamps 0:video.timestamps recv.264
# track-t0 in the recording = audio_offset(ms)/1000 + first-utterance-onset - lead_before_first_line
ffmpeg -ss <vstart> -i v.mkv -t <video_dur> -an -c:v libx264 -crf 18 gina_aligned.mp4
# composite: key the blue bg out, overlay, use the CLEAN track as audio
ffmpeg -i source.mov -i gina_aligned.mp4 -i timed_track.wav -filter_complex \
 "[1:v]scale=-1:528,colorkey=0x0061f5:0.24:0.08[g];\
  [0:v][g]overlay=x=W-w+10:y=H-h-16:shortest=1[v]" \
 -map "[v]" -map "2:a" -t <video_dur> \
 -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart out.mp4
```

Sample the avatar's background colour from a corner first (`ffprobe`/pixel read); the
example's LemonSlice blue is ~`#0061f5`.

## Gotchas (learned the hard way)

- **Use `colorkey` (RGB), not `chromakey`, for a BLUE background** — `chromakey` works in
  YUV and wipes the whole subject for this blue. `colorkey=0x0061f5:0.24:0.08` keeps the
  green dress/skin cleanly.
- **Never put `-ss` on both overlay inputs** — two input-seeks desync the overlay PTS and
  the avatar silently doesn't render. Add `setpts=PTS-STARTPTS` when seeking one input for a
  still test; for the real render feed both from t=0 (no input `-ss`).
- **Mux the clean SOURCE audio**, not the provider's echoed audio — the echo is 16k
  band-limited; the source is full 24k and byte-identical to what drove the lip-sync.
- **Cue timing drift**: a long line pushes later lines; keep hype lines tight, or the cold
  read lands after its on-screen graphic.
- **Ordinal calls read better**: "the second ball… thirty-nine", not just "thirty-nine".

See `avatar-provider-sizing.md` for per-provider aspect/size control and
`avatar-direct/README.md` for the driver, recorder, and A/V-sync warmup method.

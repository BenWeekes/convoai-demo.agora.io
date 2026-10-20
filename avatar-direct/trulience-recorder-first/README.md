# Trulience recorder-first generic protocol test

This directory owns the shared client and recorder for the Trulience onset test.
It sends a WAV using `convoai_to_video` and records the avatar's own audio/video
from Agora. It does not create a ConvoAI agent or start a game.

The receiver joins before TMS Start. After Start responds, the client connects
the returned WSS, sends `init` and immediately sends the first real voice chunk.
There is no fixed warmup, startup callback discard, added input silence, wait for
first received video, or adjustment of audio to match the mouth.

## Build

Install Go, Python 3.12, FFmpeg and mkvtoolnix on Linux. Use Agora Go Server SDK
checkout `94bce9f5eb3101e86b899e40fe5a5672423ecea1`, including its `agora_sdk`
runtime libraries. The receiver uses that revision's four-argument `Connect`
and channel-aware encoded-video callback.

From this repository:

```bash
cd avatar-direct/trulience-recorder-first
export AGORA_GO_SDK_ROOT=/absolute/path/to/agora-golang-sdk
bash recorder/build.sh "$PWD/.work/recv-av"
python3 -m venv .venv
.venv/bin/pip install -r recorder/requirements.txt
export LD_LIBRARY_PATH="$AGORA_GO_SDK_ROOT/agora_sdk${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

The build uses a temporary module replacement without editing the SDK or storing
machine-specific paths in Git. A GPU is not required on the recording host.

## Record and compose

Supply `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` and provider `API_KEY` from the
demo server's existing private environment. Use the endpoint's Agora project.
Do not commit credentials, SDK logs or captures.

Use the exact reported source sample:

```bash
curl -fL https://convoai-demo.agora.io/photo-uploads/fgrid/f_24k.wav \
  -o .work/input_24k.wav

.venv/bin/python record-generic.py \
  --base https://agora-pub.trulience.com/native-provider \
  --avatar 3056992990537531835 \
  --wav "$PWD/.work/input_24k.wav" \
  --work "$PWD/.work/run-001" \
  --recorder "$PWD/.work/recv-av"

.venv/bin/python compose-recording.py \
  .work/run-001 .work/run-001/recording.mp4

ffmpeg -v error -xerror -threads 1 -i .work/run-001/recording.mp4 \
  -fps_mode:v passthrough -enc_time_base:v 1:1000000 -f null -
```

Each `--work` must be a new directory. Input must be PCM16, 24 kHz mono, at most
120 seconds. For another source:
`ffmpeg -i input.m4a -ac 1 -ar 24000 -c:a pcm_s16le .work/input_24k.wav`.

Production is the default. Add `--environment staging` for staging avatars.
Optional `--width`/`--height` default to 1280×720 and pass through top-level generic
Start/init fields; output FPS is 30. The six-second output tail after `voice_end`
can be changed with `--tail`; it does not delay the first voice chunk.

Run when the provider slot is free. The client authenticates Stop with the exact
Start response's session ID and token, including on WSS/recording failure.
It stops only its own session. A failed Stop or recorder failure fails the test.

## Evidence and interpretation

Both tracks in the MP4 come from publisher UID 102 in the selected Agora channel.
The source WAV is never substituted into the output. The MP4 retains the full
capture without speech trimming.

- `timeline.json`: join readiness, Start, init, first voice, voice end, sent
  chunks/samples, and authenticated Stop. Confirm readiness precedes Start and
  first voice follows init immediately.
- `recv.264`, `video.timestamps`: all encoded video callbacks and their
  capture-clock differences. The first frame must be a keyframe.
- `audio.wav`: all target-publisher PCM callbacks.
- `video.jsonl`, `audio.jsonl`: byte offsets, callback arrival times and available
  SDK clocks, including audio RenderTimeMs/PresentTimeMs.
- `meta.json`: counts, zero-discard assertions and the measured track offset.
- `rec.log` and SDK logs: private diagnostics; redact before sharing.

The MP4 reconstruction uses video capture-time differences and PCM sample count,
with the first-callback arrival offset. These are visible assumptions, not proof
of identical audio/video clock domains or live playout. All callback clocks are
retained so discrepancies can be investigated without shifting the soundtrack.
Check opening words, middle and ending; a transport pass alone is insufficient.
Avoid heavy transcodes on the TMS host while capturing timing.

Two full runs on the TMS host passed on 20 October 2026: 830180 source samples,
577 voice chunks, first voice in the same millisecond as init, zero startup
discard, and authenticated Stop. Recorded lip-onset thresholds were −2 ms and
−12 ms relative to speech, with clear opening +31 ms and +20 ms. These are
diagnostic thresholds, not phoneme-accuracy guarantees. The demo-server rerun is
still required for cross-host confirmation; prior failures are not conclusively
explained.

[Reference Agora recording](https://agora-pub.trulience.com/game-avatar-architecture/recordings/trulience-305-recorder-first-2026-10-20.mp4)

Return an MP4 URL, session ID, UTC window, `timeline.json`, `meta.json` and Stop
result. Retain raw captures privately. The original parent-folder vendor drivers
remain separate; their 15-second warmup recipe is not used here.

## Local regression

```bash
.venv/bin/python -m unittest discover -s . -p test_record_generic.py -v
```

Checks join-before-Start, immediate voice, no Start after join failure,
authenticated cleanup on WSS/send failure and credential-free timeline output.

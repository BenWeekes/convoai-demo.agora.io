# Trulience recorder-first onset test

Canonical instructions and shared source:
`avatar-direct/trulience-recorder-first/README.md`.

Use this for the native-provider opening-word issue. It joins the Agora receiver
and installs observers before calling `/session/start`, then sends generic
WebSocket init and immediately streams the real PCM16 WAV in ~60 ms chunks.
There is no fixed warmup, callback discard or source-audio substitution.
It captures both media streams from avatar UID 102 and authenticates Stop.

The source was moved from TMS commit `3008856` into this private demo repository;
the driver, Go recorder, build helper, muxer and tests are unchanged by the move.
The same implementation passed two full 34.6-second runs on the TMS host.
First-voice and init timestamps matched; all 577 chunks were sent. Recorded
opening lip thresholds were −2/−12 ms from audio; clear opening +31/+20 ms.
Demo-server execution is the remaining cross-host confirmation.

This result does not conclusively explain the earlier failed recordings.
Preserve raw video, PCM and per-callback timestamps. The MP4 reconstruction uses
video capture differences and audio sample count with first-callback offset;
do not shift the soundtrack to match mouth motion.

Endpoint: `https://agora-pub.trulience.com/native-provider`.
Regression avatar: `3056992990537531835`, production (omit environment).
Use existing private credentials. Logs/captures remain in ignored `.work/`.
Other vendor drivers in `avatar-direct/` keep their existing behavior.

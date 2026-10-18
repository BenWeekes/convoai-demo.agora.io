# Trulience generic-provider integration test — PASSED ✅

Test of Trulience's new **generic (native-provider) protocol** endpoint against the standard
`convoai_to_video` unified avatar protocol (github.com/AgoraIO-Solutions/convoai_to_video), driven
with a fixed human-voice WAV and recorded from the Agora channel. Date: 2026-10-18.

## Config tested
```
api_base_url : https://agora-pub.trulience.com/native-provider
api_key      : <provided>
avatar_id    : 5933209494856748618
```
Driver: a generic client (`avatar-direct/drive_generic.py`) that plays the "Agora side" of the
protocol — i.e. it does what Agora ConvoAI would do, but streams a byte-identical 24 kHz mono PCM16
WAV instead of live TTS, so every vendor lip-syncs to the exact same audio.

## Result: WORKS end-to-end
- `POST {api_base}/session/start` (header `x-api-key`) → **200**, returned `session_id` +
  `websocket_address` = `wss://agora-pub.trulience.com/native-provider/ingest` + `session_token`.
- WS connected; sent `init`, then `voice` frames (base64 PCM16, ~60 ms, paced real-time), then `voice_end`.
- **The avatar published H.264 video + audio into the Agora channel** at the agent uid, and our Go
  recorder captured **1298 frames over ~40 s** (`recv.264` 17 MB). The correct avatar rendered and
  **lip-synced the provided audio**. Captured `audio_offset_ms = 92` (small, fine).
- Composed to a clean 854×480 tile and muxed side-by-side with LemonSlice / Anam / Tavus / Protoface /
  HeyGen — all six driven by the same clip. No alignment surprises.

So the generic protocol is functional and drop-in compatible with the same client that drives
LemonSlice / Tavus / Protoface. 🎉

## Minor observations (non-blocking — for parity/robustness)
1. **No server→client WebSocket messages observed.** Other vendors (e.g. LemonSlice) reply with an
   `init_ack` after `init`, and emit status/error frames. Trulience's `/native-provider/ingest` sent
   **nothing** back over the WS during the session. It still worked, but an `init_ack` (and any
   error/`speak`-boundary events) would let clients (a) confirm the session initialised, (b) detect
   failures without a timeout, and (c) know when playback of a `voice` segment ends. Recommend adding
   at least an `init_ack` and error frames.
2. **`session/start` response shape** — please confirm the stable field names
   (`session_id`, `websocket_address`, `session_token`) match the convoai_to_video spec exactly, and
   whether `session_token` must be presented on the WS (we sent it as `Authorization: Bearer` and it
   was accepted; a no-op is fine but worth documenting).
3. **Audio format** — we sent 24 kHz mono PCM16 (base64 in `{"command":"voice","audio":…,
   "sampleRate":24000,"encoding":"PCM16"}`); it worked. Please document the supported sample rates /
   encodings so clients can align upstream.
4. **Session teardown** — we called `DELETE {api_base}/session/stop {session_id}`; please confirm
   that's the intended stop path for this endpoint (vs the game-avatar DELETE `/{id}`).

Nothing above blocks use — the integration is working. These are just parity items with the other
generic vendors. Happy to re-test any changes.

---

## Feature request: arbitrary output width/height (resolution passthrough)

We'd like to request **any width/height** for the avatar's published video. Proposal: carry a
**`video_settings`** object in the avatar-join block (the `POST {api_base}/session/start` body) AND in
the WS `init` message — consistent with HeyGen LiveAvatar's `video_settings` and Anam's width/height.

**Example `session/start` (avatar join) body:**
```json
{
  "avatar_id": "5933209494856748618",
  "quality": "high",
  "version": "v1",
  "video_encoding": "H264",
  "agora_settings": {
    "app_id": "<agora app id>",
    "token": "<agora rtc token>",
    "channel": "<channel>",
    "uid": 102,
    "enable_string_uid": false
  },
  "video_settings": { "width": 1080, "height": 1920, "fps": 30 }
}
```

Suggested semantics:
- `width`/`height` in **pixels**, any values the renderer supports (portrait, landscape, square, etc.);
  `fps` optional (default 30).
- **Echo the negotiated resolution back** in the `session/start` response (e.g.
  `"video": {"width":1080,"height":1920,"fps":30}`) so the client knows what will be published and can
  reject/adjust if the request was clamped.
- If a requested size is unsupported, return a clear error (or clamp and report the actual size).
- Keep it a nested object so future params (e.g. `background`/alpha, `bitrate`) can be added without
  breaking the top level.

Our generic client already sends this when configured — e.g.
`VIDEO_W=1080 VIDEO_H=1920 VIDEO_FPS=30 … python3 drive_generic.py` → adds the `video_settings` block
to both `session/start` and `init`. Just let us know the object/field names you settle on and we'll align.

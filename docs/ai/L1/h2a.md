# Human to Avatar (h2a) — live voice-driven avatar broadcast

A broadcaster's **live voice drives a LemonSlice avatar** (an uploaded photo) in real time; viewers
watch the avatar + hear the voice via a shared link. No LLM/TTS — direct voice→avatar.

- **Broadcast:** `/h2a/broadcast`
- **Watch:** `/h2a/watch?channel=<ch>` (the share link the broadcaster copies)

(Replaces the old `/avatar-overlay/puppet-talk.html` + `puppet-watch.html`, which now 301 here.)

## Architecture — one Agora RTC channel per broadcast

- **Broadcaster** = host: publishes mic (Agora RTC, uid 101), subscribes the avatar **video** for
  self-view, **speaker off by default** (never plays the avatar audio → no echo of own voice).
- **`puppet_session.py`** (one per broadcast): `recv_pcm_stream_rtc` subscribes ONLY the broadcaster's
  uid (101), streams PCM to LemonSlice liveai, which publishes lip-synced avatar A/V at uid 102.
- **Viewers** = audience: subscribe the avatar A/V (uid 102), play audio; mute/unmute speaker.
- **Viewer count** = Agora **RTM presence** on the same channel (unified RTC+RTM token from
  `build_token_with_rtm`; pass the token to `rtm.login({token})`, subscribe `{withPresence:true}`,
  poll `presence.getOnlineUsers`). Broadcaster shows occupancy−1.
- **Lifecycle is broadcaster-owned:** `End broadcast`, or tab close (`pagehide`/`beforeunload` →
  `sendBeacon /puppet/stop`), ends the LemonSlice session. `PUPPET_MAX_SECONDS` (default 300) is the
  spend backstop — bump it for longer broadcasts.

## Backend — `puppet_service.py` (pm2 `puppet`, :8095, proxied at `/puppet`)

Running copy: `/home/ubuntu/puppet/`. **Tracked source: `web/puppet/`** (keep in sync; restart with
`pm2 restart puppet`). Uses the gitignored `simple-backend/.env` for Agora cert + LemonSlice key.

- `POST /start-mic?avatar_id=<photoURL>&avatar_aspect_ratio=<2x3|1x1|16x9>&denoise=<|rnnoise>` →
  `{channel, appId, token, uid:101, avatarUid:102, watchPath:/h2a/watch?channel=…, maxSeconds}`.
- `GET /token?channel=&role=viewer` → viewer `{appId, channel, uid, token, avatarUid}`.
- `POST /stop {sessionId}` (or `{room}`). `/start`, `/avatars`, `/start-mic` two-channel modes remain
  for the old puppet/photo demos.

## Photo gallery (upload / delete / pick)

Reuses simple-backend photo store under profile **`H2A`**:
- Upload: `POST /simple-backend/upload-photo?profile=H2A` (multipart `photo`) → `{id, image_url}`.
- List: `GET /simple-backend/photos?profile=H2A` → array of `{id, image_url, is_default}` (the
  curated default seed is always appended; don't offer Delete on it).
- Delete: `DELETE /simple-backend/photo/<id>?profile=H2A`.
- Files land in `web/uploads/H2A/`, served at `/photo-uploads/H2A/`. The chosen `image_url` is the
  LemonSlice `avatar_id`.

## Noise removal (two points, pluggable)

UI dropdown shows neutral labels (no vendor names): **Client** (= Agora AI Denoiser, browser) /
**Server** (= RNNoise) / **Both** / **Off**.

1. **Agora AI Denoiser** (client, browser) — `agora-extension-ai-denoiser@2.0.2` (ES module from
   jsdelivr, `assetsPath` = its `/external` WASM dir); `track.pipe(proc).pipe(track.processorDestination)`.
   Best-effort: wrapped in try/catch, non-fatal if it can't load.
2. **RNNoise** (server) — `denoise=rnnoise` runs the captured PCM through ffmpeg `arnndn` (model
   `web/puppet/std.rnnn`, resample 24k↔48k) inside `puppet_session.py` before LemonSlice.
- **Caveat:** both are speech-noise suppressors — neither removes background **music** (that needs
  source separation, out of scope / not real-time on this CPU-only box).

## nginx (live file `/etc/nginx/sites-enabled/palabra`)

```
location = /h2a { return 301 /h2a/broadcast; }
location = /h2a/broadcast { alias /home/ubuntu/web/h2a/broadcast.html; default_type text/html; }
location = /h2a/watch     { alias /home/ubuntu/web/h2a/watch.html;     default_type text/html; }
location ^~ /h2a/ { alias /home/ubuntu/web/h2a/; }
location = /avatar-overlay/puppet-talk.html  { return 301 /h2a/broadcast; }
location = /avatar-overlay/puppet-watch.html { return 301 /h2a/watch$is_args$args; }
```

## Frontend (`web/h2a/`)

`broadcast.html` (gallery/upload/delete, aspect, noise dropdown, go-live, self-view, share URL, RTM
count, Mute mic / Enable speaker / End — text-only buttons, no icons) + `watch.html` (join, play,
Mute/Unmute speaker, count) + `agora-rtm.js` (RTM 2.2.4). AgoraRTC 4.23.0 from Agora CDN.

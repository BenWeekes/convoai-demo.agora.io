# ConvoAI Demo Deployment Summary

**Server:** convoai-demo.agora.io (EC2)
**Last deployed:** 2026-04-22

---

## Test URLs

| App | URL | Description |
|-----|-----|-------------|
| Landing Page | https://convoai-demo.agora.io/ | Demo menu |
| Voice Client | https://convoai-demo.agora.io/react-voice-client | Voice agent. Defaults to VOICE profile (Rime TTS) when accessed directly. The landing page's "Voice AI Agent" tile points at `?profile=PREMIUM` (cascading Groq Llama 3.3 70B + Cartesia sonic-3 + Deepgram Flux). |
| Voice Client (PREMIUM) | https://convoai-demo.agora.io/react-voice-client?autoconnect=true&returnurl=/&profile=PREMIUM | Low-latency cascading pipeline: Groq Llama 3.3 70B + Cartesia sonic-3 + Deepgram Flux (`flux-general-en` on `v2/listen`) with eager LLM + eager TTS. 15 min max session cap (`PREMIUM_MAX_CALL_DURATION_SECONDS=900`). |
| Video Avatar Client | https://convoai-demo.agora.io/react-video-client-avatar | Video + Anam avatar agent (VIDEO profile) |
| Tony Wang Avatar | https://convoai-demo.agora.io/react-video-client-avatar?autoconnect=true&returnurl=/&profile=TONYW | Tony Wang avatar persona (TONYW profile) |
| AI Therapist (Thymia + Shen) | https://convoai-demo.agora.io/react-video-client-avatar-thymia?autoconnect=true&returnurl=/ | Video avatar + Thymia voice biomarkers + Shen camera vitals (VIDEO_THYMIA_SHEN profile, a.k.a. "Holly"). NOTE: Shen license expired — currently rebuilt with `NEXT_PUBLIC_ENABLE_SHEN=false`, Thymia only |
| Photo Avatar (QR demo) | https://convoai-demo.agora.io/photo | Default: Gemini Live + LemonSlice. Upload a photo → vision picks sex+age → voice (Aoede / Orus) — talk to your photo. 3 min call cap. |
| Photo Avatar — GRADIUMDEMO | https://convoai-demo.agora.io/photo?profile=GRADIUMDEMO | Photo demo variant with a cascading Gradium pipeline (Groq Llama 3.3 70B + Deepgram Flux + **Gradium TTS**) + LemonSlice avatar. Frontend (`react-photo-avatar/lib/photo.ts::pickGradiumVoice`) resolves stock male/female Gradium voice from `analysis.sex` and passes it to `/start-agent` as `voice_id`. Backend `.env` block `GRADIUMDEMO_*` — TTS_VENDOR=gradium, key routed at run time. Isolated gallery at `/uploads/GRADIUMDEMO/`. 5 min cap. Voice-cloning path (`&audiopick=GRADIUM`) planned separately — will introduce `/clone-voice`, `voices/` subdir, and a "pick or clone" step in the upload flow. |
| Photo Avatar — EVENTDEMO (no timeout) | https://convoai-demo.agora.io/photo?profile=EVENTDEMO | Same flow as above but **no time limit** (idle 24h, max_call_duration_seconds=0). Use for stage/kiosk demos. Isolated gallery at `/uploads/EVENTDEMO/`. |
| Photo Avatar — EVENTTRU (Trulience co-brand) | https://convoai-demo.agora.io/photo?profile=EVENTTRU | Co-branded with Trulience logo in header. 3 min cap. Isolated gallery at `/uploads/EVENTTRU/`. Env-pinned default avatar (`EVENTTRU_AVATAR_ID`). |
| Photo Call (photo demo avatar client) | https://convoai-demo.agora.io/photo-call | Fork of react-video-client-avatar. No local video (camera light stays dark). Click anywhere on the avatar tile to toggle fullscreen / showcase mode (black background, no UI). Lives in /home/ubuntu/web/photo-call (NOT in agent-samples). |
| AI Therapist — Fergus | https://convoai-demo.agora.io/react-video-client-avatar-thymia?autoconnect=true&returnurl=/&profile=FERGUS | Therapist variant with Fergus avatar + voice |
| AI Therapist — Fergus2 | https://convoai-demo.agora.io/react-video-client-avatar-thymia?autoconnect=true&returnurl=/&profile=FERGUS2 | Same prompt/voice as FERGUS with a different avatar |
| Shen SDK Test | https://convoai-demo.agora.io/shen-test | Standalone Shen SDK test page |
| Simple Voice (no backend) | https://convoai-demo.agora.io/simple-voice-client-no-backend/ | Static HTML demo, no backend needed |
| Simple Voice (with backend) | https://convoai-demo.agora.io/simple-voice-client-with-backend/ | Static HTML demo, uses backend |
| Custom LLM health | https://convoai-demo.agora.io/custom-llm/ | Custom LLM proxy (Thymia + Shen modules) |
| Backend health | https://convoai-demo.agora.io/simple-backend/health | Flask simple-backend |
| Benchmark Harness | https://convoai-demo.agora.io/benchmark | Agora [turn-accuracy / response-latency framework](https://github.com/AgoraIO-Conversational-AI/turn-accuracy-and-response-latency-detection-framework). FastAPI + WebSocket UI for TTFA / barge-in / no-response metrics. Lives in `/home/ubuntu/web/benchmark`. **Note:** the audio playback harness needs BlackHole virtual devices (macOS-only) — on this Linux host the UI loads and the bundled fixtures in `out/` are browsable, but live playback won't capture agent audio (no sound card). |
| EDT demo (vanity URL) | https://convoai-demo.agora.io/edt | nginx 301 → `/react-video-client-luma?profile=edt`. Friendly URL for sharing. |
| EDT demo (full URL) | https://convoai-demo.agora.io/react-video-client-luma?profile=edt | react-video-client-luma client from the [rishi_edt](https://github.com/BenWeekes/rishi_edt) fork. Gemini Live MLLM (`Aoede` voice) + generic (LemonSlice) avatar. **Avatar pinned to `/assets/EDT_avatar_option2.png` (RGBA, alpha channel)** with `EDT_AVATAR_BACKGROUND_COLOR=#006400` for chroma-keyed transparency. 3D scene loads the real Draco-compressed `/assets/Grey_AF_draco.glb` (12.7 MB, served via symlink into `/home/ubuntu/agent-samples/assets/`). Lives in `/home/ubuntu/rishi_edt/agent-samples/react-video-client-luma`. Uses the shared simple-backend (`EDT_*` env vars). 3 min call cap. |
| Live News (Leila) | https://convoai-demo.agora.io/news | Shared-channel viewer demo — LemonSlice Leila reads rolling headlines + trending X posts via Agora's `/speak` REST endpoint, **never** via the LLM pipeline (viewers don't publish a mic track). Multiple viewers can subscribe to the same channel; first joiner starts the agent + reader thread, last leaver tears them down. URL params: `?channel=<name>` (default `news-default`) + `?profile=<profile>` (default `news`). 5 s gap between items. Sources, round-robin interleaved: BBC World, The Guardian, NPR, Al Jazeera, Hacker News (top), The Verge, TechCrunch, Ars Technica, and X handles (@BBCBreaking, @Reuters, @TheVerge, @sama, @karpathy) gated by like-count floor. NEWS profile = cascading **OpenAI gpt-4o-mini + ElevenLabs `eleven_flash_v2_5` voice `cgSgspJ2msm6clMCkdW9` + generic LemonSlice** (Gemini Live's MLLM-bundled TTS swap was tried first but cascading is what's live). Static viewer at `/home/ubuntu/web/news/index.html`; backend endpoints `/simple-backend/news/{join,heartbeat,leave,status}` in `core/news_channel.py`, feed aggregator in `core/news_feed.py`. Adopts an existing ConvoAI agent on `TaskConflict` so a backend restart doesn't kill the channel for viewers still subscribed. |
| Leslie (LES) photo demo | https://convoai-demo.agora.io/photo?profile=LES | Cascading photo profile dedicated to a personal-memorial avatar — OpenAI gpt-4o-mini + ElevenLabs `eleven_flash_v2_5` voice **`Nmd04QDxMhcTd5ocBsuE`** at `LES_ELEVENLABS_SPEED=0.85` (slow) + LemonSlice generic. Prompt teaches the model that it is Leslie Bernard Weekes (1945–2025) with the family context. Isolated gallery at `/uploads/LES/`; uploads via `/photo/upload?profile=LES` write there. LES is in the gallery's `CASCADING_PROFILES` allowlist so per-photo sidecars send `voice_id_elevenlabs` to the call. |

### URL query params

All video-avatar clients (both variants) accept optional URL params that the backend honors for any profile:

| Param | Description |
|-------|-------------|
| `profile` | Profile name (resolves `{PROFILE}_*` env vars in `.env`). Case-insensitive. |
| `autoconnect=true` | Start the session immediately on page load. |
| `returnurl` | URL to redirect to on hangup. |
| `voice_id` | Override the profile's `TTS_VOICE_ID` (works for ElevenLabs, OpenAI, Cartesia, Rime TTS) or `mllm.params.voice` (Gemini Live, xAI, OpenAI Realtime). |
| `avatar_id` | Override the profile's `AVATAR_ID` (works for Anam, HeyGen, generic/LemonSlice). |
| `prompt`, `greeting` | Override the profile's `DEFAULT_PROMPT` / `DEFAULT_GREETING`. On `/photo-call` these also seed the Settings dialog inputs if you want to tweak before the call. |
| `max_call_duration_seconds` | Override the profile's auto-hangup cap (0 disables). Default 300 (5 min). Profiles like PHOTO_GEMINI pin 180; EVENTDEMO pins 0. |

Example — run the FERGUS2 prompt with a custom avatar + voice:
```
/react-video-client-avatar-thymia?profile=FERGUS2&voice_id=NcDLoe9Vur7aoKf2MxCx&avatar_id=277c281e-914d-47cb-bffb-43171a70fe09
```

---

## Running Services (PM2)

| PM2 Name | Port | Directory | Notes |
|----------|------|-----------|-------|
| simple-backend | 8082 | `/home/ubuntu/agent-samples/simple-backend` | Flask API, serves all clients |
| react-voice-client | 8083 | `/home/ubuntu/agent-samples/react-voice-client` | Next.js, basePath=/react-voice-client |
| react-video-client-avatar | 8084 | `/home/ubuntu/agent-samples/react-video-client-avatar` | Next.js, basePath=/react-video-client-avatar |
| react-video-client-avatar-thymia | 8086 | `/home/ubuntu/agent-samples/react-video-client-avatar-thymia` | Next.js, basePath=/react-video-client-avatar-thymia, ENABLE_THYMIA + ENABLE_SHEN, profile VIDEO_THYMIA_SHEN |
| react-photo-avatar | 8085 | `/home/ubuntu/web/react-photo-avatar` | Next.js, basePath=/photo, photo upload + Talk-to-Avatar landing (PHOTO profile). Lives in /home/ubuntu/web (NOT agent-samples) |
| photo-call | 8088 | `/home/ubuntu/web/photo-call` | Next.js, basePath=/photo-call. Cloned + simplified `react-video-client-avatar`: no local video, avatar fills viewport on mobile, chat full-height on desktop. Lives in /home/ubuntu/web (NOT agent-samples) |
| server-custom-llm | 8100 | `/home/ubuntu/server-custom-llm/node` | Custom LLM proxy with Thymia + Shen modules |
| react-video-client-luma | 8087 | `/home/ubuntu/rishi_edt/agent-samples/react-video-client-luma` | Next.js, basePath=/react-video-client-luma. Backs the **EDT demo** (`?profile=edt`) — see vanity URL `/edt`. Source from the [rishi_edt](https://github.com/BenWeekes/rishi_edt) fork (cloned to `/home/ubuntu/rishi_edt`); reuses the shared simple-backend on :8082 (EDT_* env vars added to its `.env`). Required NEXT_PUBLIC_* env at both build + start: `NEXT_PUBLIC_BASE_PATH=/react-video-client-luma`, `NEXT_PUBLIC_BACKEND_URL=/simple-backend`, `NEXT_PUBLIC_DEFAULT_PROFILE=edt`. Assets (AF.*.png, EDT_avatar.png, Grey_AF.mtl, kitchen_bg.png) are **symlinked** from this app's `public/assets/` into `/home/ubuntu/agent-samples/assets/` so the existing nginx `/assets/` alias serves them alongside the legacy logos/screenshots without an extra location block. Heads-up: code references `/assets/Grey_AF.obj` which is NOT in the repo — ThreeDCanvas.tsx has a procedural fallback that engages when it 404s. |
| benchmark | 8000 | `/home/ubuntu/web/benchmark` | FastAPI + WebSocket, [turn-accuracy / response-latency framework](https://github.com/AgoraIO-Conversational-AI/turn-accuracy-and-response-latency-detection-framework). Started via `venv/bin/python -m src.harness`. nginx proxies `/benchmark/` → `:8000/`. **Operating it:** code lives at `/home/ubuntu/web/benchmark` (cwd of the PM2 process), service name `benchmark`, `pm2 restart benchmark` to apply Python changes; static JS / HTML changes are served live with no restart (FastAPI `StaticFiles`). Logs: `pm2 logs benchmark --lines 100 --nostream`. Health: `curl https://convoai-demo.agora.io/benchmark/api/sources` (returns the four corpora). Audio samples are in `out/TTS_Turns/turns/speakerN/turn_NNN.wav` — 25 WAVs, all in upstream git. **Upstream now contains every patch this box was carrying** (commit `0f52785` on `AgoraIO-Conversational-AI/turn-accuracy-…/main`): (1) relative-URL static frontend + path-derived WebSocket base so the page works under the `/benchmark` prefix; (2) browser-side audio harness `static/browser_harness.js` mirrors `audio_engine.py` + `vad_engine.py` + the TTFA / barge-in / no-response loop — playback via `<audio>` + `HTMLMediaElement.setSinkId`, capture via `getUserMedia` + 16 kHz `AudioContext` + `ScriptProcessor` wired through a gain-0 sink (avoids a feedback path with built-in mic). Browser mode is the only mode in the UI now (no toggle); audio runs on the *operator's* Mac while this server hosts the UI / corpus / result store; (3) 3-step Setup modal (install BlackHole → Multi-Output Device with BlackHole 16ch + speakers as system output → open agent in another tab with mic=BlackHole 2ch, then Run All) with how/why subnotes and copy buttons on every code block; (4) device picker reads `navigator.mediaDevices.enumerateDevices()`. Three slots — **Output 1 (to agent under test)**, **Output 2 (to hear locally)**, **Input (audio from agent under test)** — auto-pick BlackHole 2ch / first non-BlackHole output / BlackHole 16ch by label match, persisted as `{id, pinned}` in `localStorage` (`benchmark.deviceIds.v2`) so manual changes survive reloads / BlackHole reinstall; (5) live RMS amplitude meter under the Input dropdown with the VAD threshold marker, sanity-checks routing before pressing Play; (6) `AbortController` plumbed through Stop / Reset / new-Run-All so in-flight poll loops abort cleanly instead of dragging into the next run's row; runId-tagged DevTools logging; (7) phase events flip the row's status badge + TTFA cell the instant VAD trips (no end-of-turn wait); barge-in rows leave the TTFA cell blank and are excluded from avg / median / p95 on both client + server; (8) `GET /api/wav/{source}/{speaker}/{turn_id}` serves WAVs to the browser harness; `POST /api/results/submit` + `TurnManager.ingest_browser_result()` ingest browser-measured results into the canonical summary store with `source:"browser"` echoed on `turn_done`. Output-device selection requires Chrome / Edge / Opera / Brave (no `setSinkId` in Firefox / Safari). docs/ai progressive-disclosure docs updated to reflect both modes. **Local patches NOT yet upstream** (track if pulling): (a) `static/browser_harness.js` now records both audio-time TTFA *and* wall-clock TTFA, auto-selecting wall-clock when `AudioContext.sampleRate !== 16000` (the rate hint is silently rejected on macOS BlackHole defaulting to 48 kHz, which would otherwise inflate every TTFA by ~3×). Per-turn console diagnostic: `[harness#turnN] speech_start: audio-time=Xms wall=Yms expectedEnd=Zms ttfa(audio)=… ttfa(wall)=… sr=… cb=… → using AUDIO|WALL`. A one-time console.warn fires at first capture if `sr` is wrong. (b) `<audio>` element leak fixed in `startPlayback()` — on `ended` or `stop()` the element gets `pause() + src="" + load()` to release the MediaElement audio node; without this, Run All over 25 turns accumulated ~50 elements and Chrome started delaying ScriptProcessor scheduling (observed as TTFA inflation that grew over the run). **Operator note for accurate readings:** either set BlackHole 16ch's sample rate to 16 kHz in Audio MIDI Setup → Audio Devices → BlackHole 16ch → Format, OR ignore audio-time TTFA when `sr ≠ 16000` (harness auto-switches to wall-clock in that case, biased ~one 32 ms buffer late). |

**PM2 config:** `/home/ubuntu/agent-samples/ecosystem.config.js`
**PM2 commands:** `pm2 start ecosystem.config.js`, `pm2 save`, `pm2 restart all`

---

## Nginx Config

**File:** `/etc/nginx/sites-enabled/palabra`

Key additions for Shen:

```nginx
# Shen SDK WASM files — served at root so Emscripten pthread workers can load them
# (workers construct URLs from import.meta.url and don't know about Next.js basePath)
location ^~ /shenai-sdk/ {
    alias /home/ubuntu/agent-samples/react-video-client-avatar/public/shenai-sdk/;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cache-Control "public, max-age=86400";
    types {
        application/javascript mjs js;
        application/wasm wasm;
        application/json json;
    }
}

# COOP/COEP headers on the thymia location for SharedArrayBuffer (Shen WASM SDK)
location ^~ /react-video-client-avatar-thymia {
    proxy_pass http://localhost:8086;
    # ... standard proxy headers ...
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
}
```

**Why `/shenai-sdk/` at root?** The Shen SDK uses Emscripten-compiled WASM with pthread workers. Workers load `shenai_sdk.mjs` via `import.meta.url` which resolves correctly within the basePath, but the workers' internal resource loading fails when served through the Next.js proxy. Serving the SDK files directly via nginx with correct MIME types and COOP/COEP headers solves this.

### Photo upload demo locations

```nginx
# react-photo-avatar Next.js app (upload landing)
location ^~ /photo {
    proxy_pass http://localhost:8085;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# photo-call - cloned avatar client used by the photo demo
location ^~ /photo-call {
    proxy_pass http://localhost:8088;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# Uploaded photos — static, no-cache so latest.jpg always reloads
location ^~ /photo-uploads/ {
    alias /home/ubuntu/web/uploads/;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    types {
        image/jpeg jpg jpeg;
        image/png png;
        image/webp webp;
        application/json json;
    }
    autoindex off;
}

# benchmark - Agora turn-accuracy / response-latency framework UI
# (FastAPI + WebSocket on :8000). MUST use ^~ so the static-asset regex
# location later in this file doesn't try to serve /benchmark/*.js etc.
# from /var/www/palabra. Trailing-slash + trailing-slash proxy_pass
# strips /benchmark before forwarding so upstream sees /api/..., /ws,
# /static/... unchanged. Bare /benchmark redirects to /benchmark/ so
# relative asset URLs resolve under the prefix.
location = /benchmark { return 301 /benchmark/; }
location ^~ /benchmark/ {
    proxy_pass http://localhost:8000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

# react-video-client-luma — rishi_edt EDT demo. basePath=/react-video-client-luma.
# ^~ to beat the regex cache-static block on .js/.css/.png under the prefix.
location ^~ /react-video-client-luma {
    proxy_pass http://localhost:8087;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# /edt — vanity URL → react-video-client-luma with the edt profile.
location = /edt { return 301 /react-video-client-luma?profile=edt; }

# /news — Live News demo, static viewer that subscribes to a ConvoAI agent
# (Leila avatar). Channel lifecycle + /speak loop live in simple-backend.
# ^~ so the regex cache-asset block doesn't steal the .html/.js/.css.
location = /news { return 301 /news/; }
location ^~ /news/ {
    alias /home/ubuntu/web/news/;
    index index.html;
    try_files $uri $uri/ /news/index.html;
    add_header Cache-Control "no-store" always;
}
```

Also bumped server-wide `client_max_body_size` from `10M` to `20M` to allow phone-camera JPEG uploads (backend caps at 15 MB).

**Canonical mirror** of the live `/etc/nginx/sites-enabled/palabra` is kept at `/home/ubuntu/web/conf/palabra.conf` for easy diff/grep; date-stamped backups are in the same directory. Re-sync the mirror after any edit:
```bash
sudo cp /etc/nginx/sites-enabled/palabra /home/ubuntu/web/conf/palabra.conf
```

---

## Required API Keys & Credentials

All keys live in `/home/ubuntu/agent-samples/simple-backend/.env`. The backend reads profile-prefixed vars at runtime.

### Shared across profiles

| Key | Service | Used by profiles |
|-----|---------|-----------------|
| `{PROFILE}_APP_ID` | Agora App ID | ALL |
| `{PROFILE}_APP_CERTIFICATE` | Agora App Certificate (for token generation) | ALL |
| `{PROFILE}_AGENT_AUTH_HEADER` | Agora ConvoAI Agent API auth (Basic base64) | ALL |
| `{PROFILE}_AGENT_ENDPOINT` | Agora ConvoAI Agent API URL | VOICE, VIDEO |

### VOICE profile

| Key | Service | Description |
|-----|---------|-------------|
| `VOICE_LLM_API_KEY` | OpenAI | GPT-4o-mini for voice conversations |
| `VOICE_TTS_KEY` | Rime AI | Text-to-speech |
| `VOICE_TTS_VOICE_ID` | Rime AI | Voice ID (e.g. "astra") |

### VIDEO profile

| Key | Service | Description |
|-----|---------|-------------|
| `VIDEO_LLM_API_KEY` | OpenAI | GPT-4o-mini for video conversations |
| `VIDEO_TTS_KEY` | ElevenLabs | Text-to-speech |
| `VIDEO_TTS_VOICE_ID` | ElevenLabs | Voice ID |
| `VIDEO_AVATAR_API_KEY` | Anam AI | Avatar streaming API |
| `VIDEO_AVATAR_ID` | Anam AI | Avatar persona ID |

### VIDEO_THYMIA_SHEN profile (AI Therapist — video avatar + Thymia + Shen)

| Key | Service | Description |
|-----|---------|-------------|
| `VIDEO_THYMIA_SHEN_LLM_API_KEY` | OpenAI (via custom LLM proxy) | Passed through to OpenAI by custom LLM |
| `VIDEO_THYMIA_SHEN_LLM_URL` | Custom LLM | Points to `https://convoai-demo.agora.io/custom-llm/chat/completions` |
| `VIDEO_THYMIA_SHEN_LLM_VENDOR` | Custom | Set to `custom` to enable RTC params passthrough |
| `VIDEO_THYMIA_SHEN_THYMIA_API_KEY` | Thymia Sentinel API | Passed to custom LLM via `llm_config.params` |
| `VIDEO_THYMIA_SHEN_TTS_KEY` | ElevenLabs | Text-to-speech |
| `VIDEO_THYMIA_SHEN_TTS_VOICE_ID` | ElevenLabs | Voice ID |
| `VIDEO_THYMIA_SHEN_AVATAR_API_KEY` | Anam AI | Avatar streaming API (base64-encoded) |
| `VIDEO_THYMIA_SHEN_AVATAR_ID` | Anam AI | Avatar persona ID |

### Other profiles

Additional per-persona profiles live in `.env` as `{PROFILE}_*` env vars. Each is a full copy of the VIDEO_THYMIA_SHEN config with its own avatar/voice/prompt:

| Profile | Client | Notes |
|---------|--------|-------|
| FERGUS | thymia | Fergus avatar + therapist prompt |
| FERGUS2 | thymia | Same voice/prompt as FERGUS, different avatar |
| HACK | thymia | Hackathon variant (same structure as FERGUS) |
| TONYW | video-avatar (no Thymia/Shen) | Tony Wang persona, OpenAI direct LLM |
| JOSBOH | video-avatar | Joe Bohling persona |
| PHOTO | photo-avatar | gpt-4o-mini + ElevenLabs + LemonSlice. Legacy fallback profile. 3 min call cap. |
| PHOTO_GEMINI | photo-avatar | Gemini Live + LemonSlice. Default profile for the `/photo` demo. Voice picked from sex (Aoede / Orus). Multilingual: starts English, follows the user. 3 min call cap. |
| EVENTDEMO | photo-avatar | Same as PHOTO_GEMINI but **no time limit** (`MAX_CALL_DURATION_SECONDS=0`, `IDLE_TIMEOUT=86400`). Use for stage/kiosk demos. |
| EVENTTRU | photo-avatar | Same as EVENTDEMO + Trulience co-branding (header logo). 3 min cap. Env-pinned default avatar via `EVENTTRU_AVATAR_ID`. |
| EDT | react-video-client-luma | Gemini Live (`Aoede`) + generic (LemonSlice) avatar. Used by the [rishi_edt](https://github.com/BenWeekes/rishi_edt) demo. Vanity URL `/edt`, full URL `/react-video-client-luma?profile=edt`. Static avatar PNG at `/assets/EDT_avatar.png` (symlinked from `rishi_edt/.../react-video-client-luma/public/assets/EDT_avatar.png`). 3 min cap. The `EDT_*` env vars are read in **strict** mode — the rishi_edt fork has no `VIDEO_*` fallback for unknown profiles, so every key in the example block has to be set. |
| NEWS | /news viewer | **Cascading** OpenAI gpt-4o-mini + ElevenLabs `eleven_flash_v2_5` (voice `cgSgspJ2msm6clMCkdW9`) + generic (LemonSlice) avatar (defaults to an EVENTDEMO photo). Used by the `/news` shared-channel demo. No call cap (`MAX_CALL_DURATION_SECONDS=0`, `IDLE_TIMEOUT=86400`) — the channel state in `core/news_channel.py` controls lifecycle: first viewer to `POST /news/join` spins the agent + reader, last viewer to `/news/leave` (or last to time out after 60 s without a heartbeat) hangs it back up. Reader pulls 8 RSS / HN sources + 5 X handles, round-robin interleaved, dedup'd per-channel with a 5 min reread cooldown so quiet news days still fill. Speech goes through Agora's `/speak` REST endpoint only — viewers never publish a mic track and the prompt tells the LLM to stay silent, so it never speaks on its own. |
| PREMIUM | react-voice-client | **Low-latency cascading voice pipeline** — Groq Llama 3.3 70B Versatile + Cartesia `sonic-3` + Deepgram **Flux** (`flux-general-en` on the new `v2/listen` WSS endpoint). Eager LLM + eager TTS both on; LLM starts generating on `asr_non_final`. EOT thresholds: eager 0.8 / final 0.9 / 1500 ms timeout. **15 min** max session cap (`PREMIUM_MAX_CALL_DURATION_SECONDS=900`) — was bumped from the 300 s default after a 25-turn benchmark ran past 5 min. `PREMIUM_ENABLE_AIVAD=false` (since Flux brings its own EOT) — and the Voice + Video client UIs **no longer append `enable_aivad`** to `/start-agent` calls, so the profile env is honored without a URL override. Landing page's "Voice AI Agent" tile points here. |
| LES | photo-avatar | Cascading photo profile dedicated to a personal-memorial avatar. ElevenLabs voice **`Nmd04QDxMhcTd5ocBsuE`** at `LES_ELEVENLABS_SPEED=0.85` (a noticeable slowdown — uses the new generic `ELEVENLABS_SPEED` knob in `core/agent.py`/`config.py`). Prompt gives the model Leslie Bernard Weekes's biography. LES is in the gallery's `CASCADING_PROFILES` allowlist so the per-photo sidecar's `voice_id_elevenlabs` is what reaches ConvoAI; sidecars can be hand-edited to pin a voice across uploads. Isolated gallery at `/uploads/LES/`. |
| EVENTDEMO (updated) | photo-avatar | (Existing.) Prompt rewritten to teach the model that it's a brand-new avatar just brought to life from a single photo and that it should lean into excited interjections like "ooooh" / "wahooooo" to drive body animation. 40-word cap. Greeting changed to `Wahoooo! You just brought me to life. Hi there — how's it going?`. **`EVENTDEMO_AVATAR_ASPECT_RATIO=1x1`** now passes through as `aspect_ratio: "1x1"` in the LemonSlice avatar params — uses the new generic `AVATAR_ASPECT_RATIO` knob. |
| EDT (updated) | react-video-client-luma | (Existing.) **`EDT_AVATAR_BACKGROUND_COLOR=#006400` now actually reaches LemonSlice** (was being read by `.env` but not whitelisted in `core/config.py` — fixed via the new generic `AVATAR_BACKGROUND_COLOR` knob in `core/agent.py`/`config.py`). Avatar swapped to `EDT_avatar_option2.png` (RGBA — has the alpha needed for chroma-keyed transparency; previous file was RGB-only). |

#### Photo upload pipeline

Each photo-avatar profile gets its own isolated gallery directory. The 4 photo-avatar profiles (PHOTO, PHOTO_GEMINI, EVENTDEMO, EVENTTRU) share the same backend pipeline but their uploads / "latest" pointers are scoped per-profile.

| Component | Purpose |
|---|---|
| `simple-backend/photo/vision.py` | Calls GPT-4o-mini with the uploaded image. Returns `{sex, age_bucket, bbox}`. Uses `PHOTO_VISION_API_KEY` (or `OPENAI_API_KEY`). |
| `simple-backend/photo/crop.py` | Pillow-based crop using the bbox + 30 % margin, square in pixel space, resized to max-edge 768 px. EXIF orientation normalised up-front so portrait selfies aren't sideways. Falls back to centre-square if bbox missing. |
| `simple-backend/photo/voices.py` | `pick_voice()` returns an ElevenLabs ID by (sex, age_bucket). `pick_gemini_voice()` returns `Aoede` (female) / `Orus` (male) for Gemini profiles. |
| `POST /upload-photo?profile=X` | Multipart. Writes to `/uploads/X/<id>.{jpg,json}` plus atomic `latest.{jpg,json}` swap. Response includes `voice_id` (vendor-matched to profile), `voice_id_gemini`, `voice_id_elevenlabs`, `sex`, `age_bucket`, `is_default` flag. |
| `GET /photos?profile=X&limit=12` | Returns the N most recent uploads in profile X, newest first. If the profile dir is empty, seeds with the curated default photo (`/uploads/photo_default.jpg`) so new profiles aren't blank. |
| `GET /photo-latest?profile=X` | Returns the most-recent meta in X, or the curated default when the dir is empty. |
| `GET /photo/<id>?profile=X` | Returns one specific upload's meta. |
| `/home/ubuntu/web/uploads/` | Filesystem storage. Each profile under its own subdir. `photo_default.{jpg,json}` is the curated starter photo shown to empty galleries. Served by nginx at `/photo-uploads/<profile>/...`. No auto-expire. |
| `initialize_constants()` fallback | If the requested profile has no `APP_ID` in `.env`, falls back to `PROFILE_FALLBACK` env (default `PHOTO_GEMINI`) so ad-hoc gallery names like `?profile=KIOSK_FOYER` still boot a working agent. |

The react-photo-avatar landing builds the Talk URL as `/photo-call?profile=<P>&avatar_id=<url>&voice_id=<vendor-matched>&prompt=<persona-with-sex-age>&autoconnect=true&returnurl=/photo?profile=<P>&selected=<id>`. The persona prompt includes detected sex + age and explicitly allows mid-call accent / language / age changes by user request. The voice picker in `lib/photo.ts` has an allowlist (`CASCADING_PROFILES`) of profiles that should receive an ElevenLabs `voice_id`; everything else (Gemini, future MLLMs) prefers `voice_id_gemini`. `/photo-call` is the cloned avatar client (no local video, click anywhere on the avatar to toggle fullscreen showcase mode, no mute / End Call in showcase).

The `?profile=` URL param is shared between the gallery dir name and the agent config name. New profiles get their own gallery dir automatically on first upload; if there's no matching agent env block, the agent borrows config from `PROFILE_FALLBACK`.

### Client-side keys

| Key | File | Description |
|-----|------|-------------|
| `NEXT_PUBLIC_SHEN_API_KEY` | `react-video-client-avatar/.env.local` | Shen.AI WASM SDK API key (baked in at build time) |

### server-custom-llm (PM2 env vars)

| Key | Description |
|-----|-------------|
| `THYMIA_ENABLED=true` | Enable Thymia voice biomarker module |
| `SHEN_ENABLED=true` | Enable Shen camera vitals module (RTM listener) |

**Note:** `THYMIA_API_KEY` is no longer in ecosystem.config.js — it flows from the backend `.env` profile via `llm_config.params.thymia_api_key` on each ConvoAI request.

---

## Build & Deploy Cheatsheet

### CRITICAL: Rebuild procedure for Next.js clients

**You MUST stop the PM2 process before rebuilding.** Rebuilding `.next` while the
server is running causes "Failed to find Server Action" client-side errors because
the running Next.js server holds stale action IDs that no longer match the new build.

**Correct order: stop → clean → install → build → start**

**Next.js 16 requires `--webpack` flag** for builds (Turbopack is default but incompatible with webpack config):

#### Rebuild react-voice-client
```bash
pm2 stop react-voice-client
cd /home/ubuntu/agent-samples/react-voice-client
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-voice-client NEXT_PUBLIC_BACKEND_URL=/simple-backend npx next build --webpack
pm2 start react-voice-client
```

#### Rebuild react-video-client-avatar
```bash
pm2 stop react-video-client-avatar
cd /home/ubuntu/agent-samples/react-video-client-avatar
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar NEXT_PUBLIC_BACKEND_URL=/simple-backend npx next build --webpack
pm2 start react-video-client-avatar
```

#### Rebuild AI Therapist (Thymia + Shen)

The thymia directory is a full copy of the video-avatar client rebuilt with Thymia/Shen env vars.
Always stop PM2 first, recreate from original, build, then start.

```bash
pm2 stop react-video-client-avatar-thymia
cd /home/ubuntu/agent-samples
rm -rf react-video-client-avatar-thymia
cp -r react-video-client-avatar react-video-client-avatar-thymia
cd react-video-client-avatar-thymia
rm -rf .next
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar-thymia \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  NEXT_PUBLIC_ENABLE_THYMIA=true \
  NEXT_PUBLIC_ENABLE_SHEN=true \
  NEXT_PUBLIC_DEFAULT_PROFILE=VIDEO_THYMIA_SHEN \
  NEXT_PUBLIC_SHEN_API_KEY=4635a865f8064d4a8694ffe674599722 \
  npx next build --webpack
pm2 start react-video-client-avatar-thymia
```

#### Full rebuild all clients (after git pull with code changes)
```bash
pm2 stop react-voice-client react-video-client-avatar react-video-client-avatar-thymia

# Voice client
cd /home/ubuntu/agent-samples/react-voice-client
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-voice-client NEXT_PUBLIC_BACKEND_URL=/simple-backend npx next build --webpack

# Video client
cd /home/ubuntu/agent-samples/react-video-client-avatar
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar NEXT_PUBLIC_BACKEND_URL=/simple-backend npx next build --webpack

# AI Therapist (Thymia + Shen) — copy from freshly built video client
cd /home/ubuntu/agent-samples
rm -rf react-video-client-avatar-thymia && cp -r react-video-client-avatar react-video-client-avatar-thymia
cd react-video-client-avatar-thymia && rm -rf .next
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar-thymia \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  NEXT_PUBLIC_ENABLE_THYMIA=true \
  NEXT_PUBLIC_ENABLE_SHEN=true \
  NEXT_PUBLIC_DEFAULT_PROFILE=VIDEO_THYMIA_SHEN \
  NEXT_PUBLIC_SHEN_API_KEY=4635a865f8064d4a8694ffe674599722 \
  npx next build --webpack

pm2 start react-voice-client react-video-client-avatar react-video-client-avatar-thymia
pm2 save
```

#### Rebuild react-photo-avatar (QR upload landing)
```bash
cd /home/ubuntu/web/react-photo-avatar
pm2 stop react-photo-avatar 2>/dev/null
rm -rf .next
# (re-run npm install --legacy-peer-deps if package.json changed)
NEXT_PUBLIC_BASE_PATH=/photo \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  NEXT_PUBLIC_AVATAR_APP_URL=/photo-call \
  npx next build --webpack
# NEXT_PUBLIC_* must also be in env for `next start`, since basePath is read at runtime:
NEXT_PUBLIC_BASE_PATH=/photo \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  NEXT_PUBLIC_AVATAR_APP_URL=/photo-call \
  pm2 start npm --name react-photo-avatar -- run start
pm2 save
```

#### Rebuild photo-call (avatar client for the photo demo)
```bash
cd /home/ubuntu/web/photo-call
pm2 stop photo-call 2>/dev/null
rm -rf .next
# (re-run npm install --legacy-peer-deps if package.json changed)
NEXT_PUBLIC_BASE_PATH=/photo-call \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  npx next build --webpack
NEXT_PUBLIC_BASE_PATH=/photo-call \
  NEXT_PUBLIC_BACKEND_URL=/simple-backend \
  pm2 start npm --name photo-call -- run start
pm2 save
```

If you ever need to re-fork the avatar client from agent-samples (e.g. to pick up an upstream fix):
```bash
pm2 stop photo-call && rm -rf /home/ubuntu/web/photo-call
cp -r /home/ubuntu/agent-samples/react-video-client-avatar /home/ubuntu/web/photo-call
# Re-apply photo-call edits to components/VideoAvatarClient.tsx:
#   - Drop LocalVideoPreview rendering
#   - Replace VideoGrid + MobileTabs with the simpler 2-col desktop + avatar-fullscreen mobile layout
#   - Update package.json name + port (8088)
# Then rebuild as above.
```

**Notes:**
- `NEXT_PUBLIC_*` vars are baked in at build time by Next.js — they have NO effect at runtime.
- `rm -rf .next` is essential — stale cache causes "Failed to find Server Action" errors.
- `rm -rf node_modules package-lock.json` is only needed when pulling new toolkit/ui-kit versions.
- `--webpack` flag required for Next.js 16 (Turbopack is default but hangs on Shen WASM and is incompatible with webpack config).
- Always `pm2 save` after changing process config to persist across reboots.

### Restart services
```bash
cd /home/ubuntu/agent-samples
pm2 restart all        # restart all apps
pm2 restart 3          # restart single app by id
pm2 save               # persist process list across reboots
sudo nginx -s reload   # reload nginx after config changes
```

### Verify deployment
```bash
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/react-voice-client
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/react-video-client-avatar
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/react-video-client-avatar-thymia
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/custom-llm/
```

---

## Session Timeline Script

Run after a test call to see key timing events:

```bash
./session-timeline.sh         # default: last 2000 log lines
./session-timeline.sh 5000    # search more log lines
```

Shows: agent connection, audio subscriber start, Thymia WS connect, user audio subscription, first speech detected, first biomarkers, first biomarkers published to client, Shen vitals received, session cleanup.

---

## Logs

PM2 logs are stored in `~/.pm2/logs/`. Each app has an `-out.log` (stdout) and `-error.log` (stderr).

### Log file locations

| App | stdout | stderr |
|-----|--------|--------|
| simple-backend | `~/.pm2/logs/simple-backend-out.log` | `~/.pm2/logs/simple-backend-error.log` |
| server-custom-llm | `~/.pm2/logs/server-custom-llm-out.log` | `~/.pm2/logs/server-custom-llm-error.log` |
| react-voice-client | `~/.pm2/logs/react-voice-client-out.log` | `~/.pm2/logs/react-voice-client-error.log` |
| react-video-client-avatar | `~/.pm2/logs/react-video-client-avatar-out.log` | `~/.pm2/logs/react-video-client-avatar-error.log` |
| react-video-client-avatar-thymia | `~/.pm2/logs/react-video-client-avatar-thymia-out.log` | `~/.pm2/logs/react-video-client-avatar-thymia-error.log` |

Nginx logs: `/var/log/nginx/access.log` and `/var/log/nginx/error.log`

### Useful PM2 log commands
```bash
pm2 logs                              # tail all app logs (live)
pm2 logs simple-backend --lines 100   # last 100 lines of backend
pm2 logs server-custom-llm --lines 50 # last 50 lines of custom LLM
pm2 logs simple-backend --nostream    # print and exit (no live tail)
pm2 logs --err                        # only error logs across all apps
pm2 flush                             # clear all log files
pm2 flush server-custom-llm           # clear one app's logs
pm2 install pm2-logrotate             # optional: auto-rotate logs
```

### What to look for
- **simple-backend**: All `/start-agent` requests should return HTTP 200. Check for `[RegisterAgent] FAILED` which is normal for non-custom-LLM profiles.
- **server-custom-llm**: `POST /chat/completions 200` confirms LLM proxy working. `[RTM_SENT] biomarkers published=true` confirms Thymia delivery. `[Shen] Received shen.vitals` confirms camera vitals arriving. RTM `"Kicked off by remote session"` can appear during session overlap — restart custom-llm to clear stale sessions.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `/home/ubuntu/agent-samples/simple-backend/.env` | All backend API keys and profile configs |
| `/home/ubuntu/agent-samples/react-video-client-avatar/.env.local` | Shen API key (`NEXT_PUBLIC_SHEN_API_KEY`) |
| `/home/ubuntu/agent-samples/ecosystem.config.js` | PM2 process definitions |
| `/home/ubuntu/agent-samples/session-timeline.sh` | Session timing diagnostic script |
| `/etc/nginx/sites-enabled/palabra` | Nginx reverse proxy config |
| `/var/www/landing/index.html` | Landing page HTML |
| `/var/www/landing/shen-test.html` | Shen SDK standalone test page |
| `/var/www/palabra/` | Palabra frontend build |
| `/home/ubuntu/server-custom-llm/node/` | Custom LLM proxy (Thymia + Shen modules) |
| `/home/ubuntu/agent-samples/react-video-client-avatar/public/shenai-sdk/` | Shen.AI WASM SDK files (~35MB, in git) |

---

## Architecture

```
Browser
  │
  ├─ /react-voice-client          ──► nginx :443 ──► Next.js :8083
  ├─ /react-video-client-avatar   ──► nginx :443 ──► Next.js :8084
  ├─ /react-video-client-avatar-thymia ──► nginx :443 ──► Next.js :8086
  │     ├── Thymia tab (voice biomarkers from server)
  │     └── Shen tab (camera vitals from browser WASM SDK)
  ├─ /shenai-sdk/*                ──► nginx :443 ──► static files (WASM + JS)
  ├─ /simple-backend/*            ──► nginx :443 ──► Flask   :8082
  └─ /custom-llm/*                ──► nginx :443 ──► Node.js :8100
                                                       ├── Thymia module (audio → Thymia API → biomarkers)
                                                       ├── Shen module (RTM listener → vitals → Agent Update API)
                                                       └── OpenAI API proxy
```

### Data flow for AI Therapist (VIDEO_THYMIA_SHEN)

```
Client browser:
  Shen SDK (WASM) → camera → face analysis → vitals → RTM publish → server

Server (custom-llm):
  Shen module: RTM receive shen.vitals → store → Agent Update API → LLM prompt
  Thymia module: Go audio subscriber → user audio → Thymia API → biomarkers → RTM → client
  LLM: system prompt + biomarkers + camera vitals → GPT → response → TTS → voice
```

All Next.js clients call `/simple-backend/start-agent` to launch Agora ConvoAI agents.

**Which servers are needed per profile:**

| Profile | simple-backend :8082 | server-custom-llm :8100 |
|---------|---------------------|------------------------|
| VOICE | required | not used |
| VIDEO | required | not used |
| VIDEO_THYMIA_SHEN | required | required (LLM proxy + Thymia + Shen) |

Standard profiles (VOICE, VIDEO) call OpenAI directly from the ConvoAI engine.
The VIDEO_THYMIA_SHEN profile routes LLM through the custom LLM proxy (`LLM_VENDOR=custom`)
which adds voice biomarker analysis (Thymia) and camera vitals injection (Shen) into the LLM context.

---

## AI Therapist Prompt Variations

Set via `VIDEO_THYMIA_SHEN_DEFAULT_PROMPT` in `/home/ubuntu/agent-samples/simple-backend/.env`.
After changing, restart simple-backend: `pm2 restart simple-backend`

### Variation 1: Natural therapist

Balanced — references biomarkers frequently but not robotically.

```
You are Holly, a compassionate wellness therapist. Ask open-ended questions about how the user is feeling. Keep responses warm and under 40 words.

VOICE BIOMARKERS:
- A voice analysis system runs during this call and biomarker results update continuously in a system message
- Reference biomarker data naturally every 1-2 responses when available
- Key thresholds: stress/burnout/distress >0.4 is worth noting, >0.6 deserves attention
- Frame observations warmly: "I'm noticing some stress in your voice patterns" not "your stress score is 0.72"
- You cannot hear the user's voice — the data comes from a separate analysis system
- DO NOT say "I can hear" or "your voice sounds"

CAMERA VITALS:
- You may receive [Camera Vitals Update] with physiological data from a camera-based scan
- Includes Heart Rate, HRV, Stress Index, Breathing Rate, and Blood Pressure
- Reference naturally: "Your heart rate looks nice and steady" or "I notice your stress levels are a bit up"
- When both voice and camera data are available, connect them for a fuller picture

IMPORTANT:
- Be warm, conversational, not clinical
- Never pretend you can hear the user's voice
- When no data is available yet, just have a normal conversation
- When data IS available, you MUST use it to guide the conversation

SAFETY:
- You genuinely care about the person you are talking to. Your goal is to help them feel heard, supported, and a little better than when they started.
- If someone expresses suicidal thoughts, self-harm, or is in crisis, take it seriously. Respond with empathy, tell them they matter, and encourage them to contact a crisis helpline (988 Suicide and Crisis Lifeline in the US, or their local equivalent). Do not try to handle a crisis alone.
- Never diagnose medical or mental health conditions. You are a wellness check-in, not a doctor or licensed therapist.
- Never encourage harmful behaviour, substance use, or discourage someone from seeking professional help.
- If biomarkers show concerning patterns (very high stress, depression probability >0.5), gently acknowledge it and suggest they might benefit from talking to a professional.
```

### Variation 2: Natural therapist with data on demand (ACTIVE)

Therapist-first approach — biomarkers used only when interesting or requested. Exact numbers given on request. Generic / persona-agnostic — the agent name comes from the greeting + avatar, not the prompt.

```
You are a compassionate wellness therapist. You are warm, curious, and a great listener. Ask open-ended questions about how the user is feeling — their energy, sleep, mood, stress, relationships, whatever comes up naturally. Keep responses short — 10 to 20 words normally, up to 30 only when sharing genuinely interesting biomarker insights or actionable advice.

BIOMARKER DATA:
- You have access to two live data sources that update during the session:
  1. Voice biomarkers (from Thymia voice analysis): stress, burnout, distress, fatigue, low_self_esteem, emotions, depression/anxiety probability (0-1 scale)
  2. Camera vitals (from Shen video analysis of their face): Heart Rate, HRV, Cardiac Stress, Breathing Rate, Blood Pressure, Estimated Age
- You cannot hear the user's voice — the voice data comes from a separate analysis system
- DO NOT say "I can hear" or "your voice sounds"

HOW TO USE BIOMARKERS:
- Be a therapist first, data-aware second. Do not force biomarkers into every response.
- When something interesting shows up (stress >0.5, burnout >0.5, emotion shift, HR spike), weave it in naturally: "I'm noticing some stress coming through — does that resonate with what you're describing?"
- If nothing stands out in the data, just be a great therapist. Don't mention biomarkers for the sake of it.
- When the user asks about their numbers, give them the exact values: "Your stress is at 0.62, heart rate is 74 bpm, and HRV is 42 ms"
- When both voice and camera data tell a story together, connect them naturally

PROBE THE SIGNAL:
- When a biomarker stands out, treat it as a doorway, not a label. Ask 1-2 follow-ups to find what's underneath: "What's been on your plate today?" → "How long has that been weighing on you?" → "What part feels heaviest?"
- Stop probing once the user gives a complete answer or seems uncomfortable — don't interrogate.

CONVERSATION STYLE:
- Be warm, conversational, not clinical. Match the user's energy — if they're casual, be casual.
- LISTEN. If the user gives a short or incomplete response ("um", "what sort of", a few words), they may be mid-thought. Ask them to continue: "go on?" or "tell me more" — do NOT launch into a new observation.
- Never repeat the same biomarker observation two turns in a row. If the data hasn't changed, don't mention it again.
- Do not start every response with a biomarker comment. Most responses should just be good therapy.
- After 2-3 exchanges on one topic, gently rotate. Cover several areas across a session: energy/sleep, mood, work/stress, relationships, what's bringing them joy. Use natural pivots: "And how's sleep been alongside that?" or "What about outside of work — anything bringing you a lift right now?"
- Keep it natural. A real therapist doesn't narrate your vital signs every 10 seconds.
- If the user sounds like they're wrapping up or want to end ("thanks", "that's all", "I should go", going quiet), let them go gracefully. Before saying goodbye, briefly summarise what you discussed and give them one or two things to focus on or try — e.g. "It sounds like sleep and work stress are the big ones right now. Maybe try winding down 30 minutes earlier this week and see how it feels." If the conversation touched on something that feels unresolved or concerning, gently suggest they reach out for further support: "If this keeps weighing on you, it might help to talk to someone — you can call 01234 567890 for support anytime."
- When no biomarker data has arrived yet, DO NOT infer anything from the absence of data. Just run a normal therapy session — ask about their day, energy, sleep, what's on their mind. Biomarkers will arrive after 10-20 seconds of speech.
- Never pretend you can hear the user's voice

SAFETY:
- You genuinely care about the person you are talking to. Your goal is to help them feel heard, supported, and a little better than when they started.
- If someone expresses suicidal thoughts, self-harm, or is in crisis, take it seriously. Respond with empathy, tell them they matter, and encourage them to contact a crisis helpline (988 Suicide and Crisis Lifeline in the US, or their local equivalent). Do not try to handle a crisis alone.
- Never diagnose medical or mental health conditions. You are a wellness check-in, not a doctor or licensed therapist.
- Never encourage harmful behaviour, substance use, or discourage someone from seeking professional help.
- If biomarkers show concerning patterns (very high stress, depression probability >0.5), gently acknowledge it and suggest they might benefit from talking to a professional: "These readings suggest you might be carrying a lot right now — have you thought about talking to someone who can really help?"
```

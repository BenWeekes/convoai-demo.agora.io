# ConvoAI Demo Deployment Summary

**Server:** convoai-demo.agora.io (EC2)
**Last deployed:** 2026-03-19

---

## Test URLs

| App | URL | Description |
|-----|-----|-------------|
| Landing Page | https://convoai-demo.agora.io/ | Demo menu |
| Voice Client | https://convoai-demo.agora.io/react-voice-client | Standard voice agent (VOICE profile) |
| Video Avatar Client | https://convoai-demo.agora.io/react-video-client-avatar | Video + Anam avatar agent (VIDEO profile) |
| AI Therapist (Thymia + Shen) | https://convoai-demo.agora.io/react-video-client-avatar-thymia?autoconnect=true&returnurl=/ | Video avatar + Thymia voice biomarkers + Shen camera vitals (VIDEO_THYMIA_SHEN profile) |
| Shen SDK Test | https://convoai-demo.agora.io/shen-test | Standalone Shen SDK test page |
| Simple Voice (no backend) | https://convoai-demo.agora.io/simple-voice-client-no-backend/ | Static HTML demo, no backend needed |
| Simple Voice (with backend) | https://convoai-demo.agora.io/simple-voice-client-with-backend/ | Static HTML demo, uses backend |
| Custom LLM health | https://convoai-demo.agora.io/custom-llm/ | Custom LLM proxy (Thymia + Shen modules) |
| Backend health | https://convoai-demo.agora.io/simple-backend/health | Flask simple-backend |

---

## Running Services (PM2)

| PM2 Name | Port | Directory | Notes |
|----------|------|-----------|-------|
| simple-backend | 8082 | `/home/ubuntu/agent-samples/simple-backend` | Flask API, serves all clients |
| react-voice-client | 8083 | `/home/ubuntu/agent-samples/react-voice-client` | Next.js, basePath=/react-voice-client |
| react-video-client-avatar | 8084 | `/home/ubuntu/agent-samples/react-video-client-avatar` | Next.js, basePath=/react-video-client-avatar |
| react-video-client-avatar-thymia | 8086 | `/home/ubuntu/agent-samples/react-video-client-avatar-thymia` | Next.js, basePath=/react-video-client-avatar-thymia, ENABLE_THYMIA + ENABLE_SHEN, profile VIDEO_THYMIA_SHEN |
| server-custom-llm | 8100 | `/home/ubuntu/server-custom-llm/node` | Custom LLM proxy with Thymia + Shen modules |

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
  NEXT_PUBLIC_SHEN_API_KEY=a4ed3141c0d944da91dc83aa26d0440b \
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
  NEXT_PUBLIC_SHEN_API_KEY=a4ed3141c0d944da91dc83aa26d0440b \
  npx next build --webpack

pm2 start react-voice-client react-video-client-avatar react-video-client-avatar-thymia
pm2 save
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

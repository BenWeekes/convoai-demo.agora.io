# ConvoAI Demo Deployment Summary

**Server:** convoai-demo.agora.io (EC2)
**Last deployed:** 2026-02-27

---

## Test URLs

| App | URL | Description |
|-----|-----|-------------|
| Landing Page | https://convoai-demo.agora.io/ | Demo menu |
| Voice Client | https://convoai-demo.agora.io/react-voice-client | Standard voice agent (VOICE profile) |
| Video Avatar Client | https://convoai-demo.agora.io/react-video-client-avatar | Video + HeyGen avatar agent (VIDEO profile) |
| Voice Client (Thymia) | https://convoai-demo.agora.io/react-voice-client-thymia | Voice agent + Thymia biomarker tab (THYMIA profile) |
| Video Avatar Client (Thymia) | https://convoai-demo.agora.io/react-video-client-avatar-thymia | Video + Anam avatar + Thymia biomarker tab (THYMIA_VIDEO profile) |
| Simple Voice (no backend) | https://convoai-demo.agora.io/simple-voice-client-no-backend/ | Static HTML demo, no backend needed |
| Simple Voice (with backend) | https://convoai-demo.agora.io/simple-voice-client-with-backend/ | Static HTML demo, uses backend |
| Custom LLM health | https://convoai-demo.agora.io/custom-llm/ | Thymia custom LLM proxy |
| Backend health | https://convoai-demo.agora.io/simple-backend/health | Flask simple-backend |

---

## Running Services (PM2)

| PM2 Name | Port | Directory | Notes |
|----------|------|-----------|-------|
| simple-backend | 8081 | `/home/ubuntu/agent-samples/simple-backend` | Flask API, serves all clients |
| react-voice-client | 8083 | `/home/ubuntu/agent-samples/react-voice-client` | Next.js, basePath=/react-voice-client |
| react-video-client-avatar | 8084 | `/home/ubuntu/agent-samples/react-video-client-avatar` | Next.js, basePath=/react-video-client-avatar |
| react-voice-client-thymia | 8085 | `/home/ubuntu/agent-samples/react-voice-client-thymia` | Next.js, basePath=/react-voice-client-thymia, ENABLE_THYMIA=true |
| react-video-client-avatar-thymia | 8086 | `/home/ubuntu/agent-samples/react-video-client-avatar-thymia` | Next.js, basePath=/react-video-client-avatar-thymia, ENABLE_THYMIA=true |
| server-custom-llm | 8100 | `/home/ubuntu/server-custom-llm/node` | Custom LLM proxy with Thymia integration |

**PM2 config:** `/home/ubuntu/agent-samples/ecosystem.config.js`
**PM2 commands:** `pm2 start ecosystem.config.js`, `pm2 save`, `pm2 restart all`

---

## Nginx Config

**File:** `/etc/nginx/sites-enabled/palabra`

```nginx
# Palabra Frontend + Backend API - Port 7000 (same-origin)
server {
    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    server_name convoai-demo.agora.io;

    ssl_certificate /etc/letsencrypt/live/convoai-demo.agora.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/convoai-demo.agora.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # API requests - proxy to backend Docker container (port 7080)
    location /v1/ {
        proxy_pass http://localhost:7080/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # GraphQL endpoint - proxy to backend
    location /query {
        proxy_pass http://localhost:7080/query;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # OAuth endpoint - proxy to backend
    location /oauth {
        proxy_pass http://localhost:7080/oauth;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # PSTN endpoint - proxy to backend
    location /pstn {
        proxy_pass http://localhost:7080/pstn;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # --- Agent Samples ---

    # Assets folder (images for landing page)
    location ^~ /assets/ {
        alias /home/ubuntu/agent-samples/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # simple-backend Flask API (strip /simple-backend prefix via trailing slash)
    location /simple-backend/ {
        proxy_pass http://localhost:8081/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # react-voice-client-thymia Next.js app (Thymia-enabled voice client)
    location ^~ /react-voice-client-thymia {
        proxy_pass http://localhost:8085;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # react-voice-client Next.js app
    location ^~ /react-voice-client {
        proxy_pass http://localhost:8083;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # react-video-client-avatar-thymia Next.js app (Thymia-enabled video avatar client)
    location ^~ /react-video-client-avatar-thymia {
        proxy_pass http://localhost:8086;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # react-video-client-avatar Next.js app
    location ^~ /react-video-client-avatar {
        proxy_pass http://localhost:8084;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # simple-voice-client-no-backend - static HTML
    location ^~ /simple-voice-client-no-backend/ {
        alias /home/ubuntu/agent-samples/simple-voice-client-no-backend/;
        index index.html;
    }

    # simple-voice-client-with-backend - static HTML
    location ^~ /simple-voice-client-with-backend/ {
        alias /home/ubuntu/agent-samples/simple-voice-client-with-backend/;
        index index.html;
    }

    # server-custom-llm Node.js server (strip /custom-llm prefix via trailing slash)
    location ^~ /custom-llm/ {
        proxy_pass http://localhost:8100/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    # --- Landing Page ---

    # Exact match for root URL only - serves the demo menu landing page
    location = / {
        root /var/www/landing;
        try_files /index.html =404;
    }

    # --- Palabra ---

    # Static files - serve frontend build
    # Falls back to index.html for SPA routing
    location / {
        root /var/www/palabra;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|wasm|mp4|ttf|woff|woff2)$ {
        root /var/www/palabra;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 10M;
}
```

---

## Required API Keys & Credentials

All keys live in `/home/ubuntu/agent-samples/simple-backend/.env`. The backend reads profile-prefixed vars at runtime.

### Shared across profiles

| Key | Service | Used by profiles |
|-----|---------|-----------------|
| `{PROFILE}_APP_ID` | Agora App ID | ALL |
| `{PROFILE}_APP_CERTIFICATE` | Agora App Certificate (optional, for token generation) | ALL |
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
| `VIDEO_LLM_API_KEY` | OpenAI | GPT-4o for video conversations |
| `VIDEO_TTS_KEY` | ElevenLabs | Text-to-speech |
| `VIDEO_TTS_VOICE_ID` | ElevenLabs | Voice ID |
| `VIDEO_AVATAR_API_KEY` | HeyGen | Avatar streaming API |
| `VIDEO_AVATAR_ID` | HeyGen | Avatar character ID |

### THYMIA profile (voice + biomarkers)

| Key | Service | Description |
|-----|---------|-------------|
| `THYMIA_LLM_API_KEY` | OpenAI (via custom LLM proxy) | Passed through to OpenAI by custom LLM |
| `THYMIA_LLM_URL` | Custom LLM | Points to `https://convoai-demo.agora.io/custom-llm/chat/completions` |
| `THYMIA_TTS_KEY` | Rime AI | Text-to-speech |

### THYMIA_VIDEO profile (video avatar + biomarkers)

| Key | Service | Description |
|-----|---------|-------------|
| `THYMIA_VIDEO_LLM_API_KEY` | OpenAI (via custom LLM proxy) | Passed through to OpenAI by custom LLM |
| `THYMIA_VIDEO_LLM_URL` | Custom LLM | Points to `https://convoai-demo.agora.io/custom-llm/chat/completions` |
| `THYMIA_VIDEO_TTS_KEY` | ElevenLabs | Text-to-speech |
| `THYMIA_VIDEO_TTS_VOICE_ID` | ElevenLabs | Voice ID |
| `THYMIA_VIDEO_AVATAR_API_KEY` | Anam AI | Avatar streaming API (base64-encoded) |
| `THYMIA_VIDEO_AVATAR_ID` | Anam AI | Avatar persona ID |

### server-custom-llm (PM2 env, not in .env file)

| Key | Service | Description |
|-----|---------|-------------|
| `THYMIA_API_KEY` | Thymia Sentinel API | Voice biomarker analysis |
| `THYMIA_ENABLED` | Flag | Set to "true" to enable Thymia integration |

---

## Build & Deploy Cheatsheet

### CRITICAL: Rebuild procedure for Next.js clients

**You MUST stop the PM2 process before rebuilding.** Rebuilding `.next` while the
server is running causes "Failed to find Server Action" client-side errors because
the running Next.js server holds stale action IDs that no longer match the new build.

**Correct order: stop → clean → install → build → start**

#### Rebuild react-voice-client
```bash
pm2 stop react-voice-client
cd /home/ubuntu/agent-samples/react-voice-client
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-voice-client NEXT_PUBLIC_BACKEND_URL=/simple-backend npm run build
pm2 start react-voice-client
```

#### Rebuild react-video-client-avatar
```bash
pm2 stop react-video-client-avatar
cd /home/ubuntu/agent-samples/react-video-client-avatar
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar NEXT_PUBLIC_BACKEND_URL=/simple-backend npm run build
pm2 start react-video-client-avatar
```

#### Rebuild Thymia variants

Thymia directories are full copies of the originals rebuilt with Thymia env vars.
Always stop PM2 first, recreate from original, build, then start.

```bash
# Voice Thymia
pm2 stop react-voice-client-thymia
cd /home/ubuntu/agent-samples
rm -rf react-voice-client-thymia
cp -r react-voice-client react-voice-client-thymia
cd react-voice-client-thymia
NEXT_PUBLIC_BASE_PATH=/react-voice-client-thymia NEXT_PUBLIC_BACKEND_URL=/simple-backend NEXT_PUBLIC_ENABLE_THYMIA=true NEXT_PUBLIC_DEFAULT_PROFILE=THYMIA npm run build
pm2 start react-voice-client-thymia

# Video Avatar Thymia
pm2 stop react-video-client-avatar-thymia
cd /home/ubuntu/agent-samples
rm -rf react-video-client-avatar-thymia
cp -r react-video-client-avatar react-video-client-avatar-thymia
cd react-video-client-avatar-thymia
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar-thymia NEXT_PUBLIC_BACKEND_URL=/simple-backend NEXT_PUBLIC_ENABLE_THYMIA=true NEXT_PUBLIC_DEFAULT_PROFILE=THYMIA_VIDEO npm run build
pm2 start react-video-client-avatar-thymia
```

#### Full rebuild all clients (after git pull with code changes)
```bash
pm2 stop react-voice-client react-video-client-avatar react-voice-client-thymia react-video-client-avatar-thymia

# Voice client
cd /home/ubuntu/agent-samples/react-voice-client
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-voice-client NEXT_PUBLIC_BACKEND_URL=/simple-backend npm run build

# Video client
cd /home/ubuntu/agent-samples/react-video-client-avatar
rm -rf node_modules package-lock.json .next
npm install --legacy-peer-deps
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar NEXT_PUBLIC_BACKEND_URL=/simple-backend npm run build

# Thymia variants (copy from freshly built originals)
cd /home/ubuntu/agent-samples
rm -rf react-voice-client-thymia && cp -r react-voice-client react-voice-client-thymia
cd react-voice-client-thymia
NEXT_PUBLIC_BASE_PATH=/react-voice-client-thymia NEXT_PUBLIC_BACKEND_URL=/simple-backend NEXT_PUBLIC_ENABLE_THYMIA=true NEXT_PUBLIC_DEFAULT_PROFILE=THYMIA npm run build

cd /home/ubuntu/agent-samples
rm -rf react-video-client-avatar-thymia && cp -r react-video-client-avatar react-video-client-avatar-thymia
cd react-video-client-avatar-thymia
NEXT_PUBLIC_BASE_PATH=/react-video-client-avatar-thymia NEXT_PUBLIC_BACKEND_URL=/simple-backend NEXT_PUBLIC_ENABLE_THYMIA=true NEXT_PUBLIC_DEFAULT_PROFILE=THYMIA_VIDEO npm run build

pm2 start react-voice-client react-video-client-avatar react-voice-client-thymia react-video-client-avatar-thymia
pm2 save
```

**Notes:**
- `NEXT_PUBLIC_*` vars are baked in at build time by Next.js — they have NO effect at runtime.
- `rm -rf .next` is essential — stale cache causes "Failed to find Server Action" errors.
- `rm -rf node_modules package-lock.json` is only needed when pulling new toolkit/ui-kit versions.
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
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/react-voice-client-thymia
curl -s -o /dev/null -w "%{http_code}" https://convoai-demo.agora.io/react-video-client-avatar-thymia
```

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
| react-voice-client-thymia | `~/.pm2/logs/react-voice-client-thymia-out.log` | `~/.pm2/logs/react-voice-client-thymia-error.log` |
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
pm2 install pm2-logrotate             # optional: auto-rotate logs
```

### What to look for
- **simple-backend**: All `/start-agent` requests should return HTTP 200. Check for `[RegisterAgent] FAILED` which is normal for non-Thymia profiles.
- **server-custom-llm**: RTM Error -10002 ("without login RTM service") can appear during session cleanup — it's a timing race, not a persistent error. Look for `[RTM_SENT]` lines confirming biomarker delivery. `POST /chat/completions 200` confirms the LLM proxy is working.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `/home/ubuntu/agent-samples/simple-backend/.env` | All backend API keys and profile configs |
| `/home/ubuntu/agent-samples/ecosystem.config.js` | PM2 process definitions |
| `/etc/nginx/sites-enabled/palabra` | Nginx reverse proxy config |
| `/var/www/landing/index.html` | Landing page HTML |
| `/var/www/palabra/` | Palabra frontend build |
| `/home/ubuntu/server-custom-llm/node/` | Custom LLM proxy (Thymia integration) |

---

## Architecture

```
Browser
  │
  ├─ /react-voice-client          ──► nginx :443 ──► Next.js :8083
  ├─ /react-video-client-avatar   ──► nginx :443 ──► Next.js :8084
  ├─ /react-voice-client-thymia   ──► nginx :443 ──► Next.js :8085
  ├─ /react-video-client-avatar-thymia ──► nginx :443 ──► Next.js :8086
  ├─ /simple-backend/*             ──► nginx :443 ──► Flask   :8081
  └─ /custom-llm/*                 ──► nginx :443 ──► Node.js :8100 ──► Thymia Sentinel API
                                                                     ──► OpenAI API
```

All Next.js clients call `/simple-backend/start-agent` to launch Agora ConvoAI agents.
Thymia profiles route LLM through the custom LLM proxy which adds real-time voice biomarker analysis.

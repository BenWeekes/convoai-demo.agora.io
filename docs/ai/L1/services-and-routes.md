# Services & routes

pm2 apps → local port → public nginx route (`/etc/nginx/sites-enabled/palabra`) → source.
Full detail per service is in `conf/deploy.md`.

| pm2 app | port | nginx route | source |
|---|---|---|---|
| simple-backend | 8082 | `/simple-backend/` | `agent-samples/simple-backend` (Flask; ConvoAI start/stop, profiles) |
| server-custom-llm | 8100 | (internal) | `server-custom-llm/node` (custom LLM + Shen/Thymia) |
| react-voice-client | 8083 | `^~ /react-voice-client` | `agent-samples/react-voice-client` |
| react-video-client-avatar | 8084 | `^~ /react-video-client-avatar` | `agent-samples/react-video-client-avatar` |
| react-video-client-avatar-thymia | 8086 | `^~ /react-video-client-avatar-thymia` | therapist demo |
| react-video-client-luma | 8087 | `^~ /react-video-client-luma`, `/edt`, `/edt-gemini` | EDT luma |
| edt-mcp (py) | 8111 | `/edt-mcp/` | `web/edt-mcp` |
| edt-mcp-node | 8114 | `/edt-scene/` | `web/edt-mcp-node` |
| avatar-overlay | 8090 | `^~ /avatar-overlay/` | `avatar-overlay` (chroma overlay reference) |
| sign-client | 7090 | `^~ /sign-client` | `sign-video-client` (sign demos + `?overlay=1`) |
| **baccarat-mcp** | **8117** | `/baccarat-mcp/` | **`baccarat/mcp/`** (this repo; `/home/ubuntu/baccarat-mcp` symlink) |
| **baccarat-llm-proxy** | **8118** | `/baccarat-llm/` | **`baccarat/mcp/llm-proxy.mjs`** (grok logging proxy) |
| **baccarat-client** | **3040** | `= /baccarat` → `^~ /baccarat/` | `agora-trulience-sdk/react` (branch `baccarat`) |
| photo-call / react-photo-avatar / cards / benchmark / dealer / news | various | `/photo*`, `/dealer/`, `/benchmark/`, `/news/` | `web/*` |
| — | — | `^~ /assets/` → `agent-samples/assets/` | static assets |

Notes:
- Client apps proxied under a path use `^~` so nginx's regex `.js/.css` cache block (line ~405) doesn't steal their assets.
- `baccarat-mcp` + `baccarat-llm-proxy` share one dir (`baccarat/mcp`, symlinked to `/home/ubuntu/baccarat-mcp`); deps symlink to `edt-mcp-node/node_modules`.

# Repo: convoai-demo.agora.io (server config + docs + demo-specific services)

This **private** repo is the rebuild bible for the `convoai-demo.agora.io` demo server.
It holds the nginx config, the canonical `conf/deploy.md`, and the **demo-specific service
source** that doesn't live in a client repo. Each such demo gets its own root folder (currently
`baccarat/`); `conf/` and `docs/` hold only shared config + docs.

Client apps live in their own repos and are cloned/built per `deploy.md`:
- `github.com/BenWeekes/agora-trulience-sdk` (branch `baccarat`) — the Baccarat casino web client.
- `github.com/BenWeekes/sign-video-client` — the sign-language client + `signer-overlay/` kit.
- `github.com/BenWeekes/avatar-overlay` — chroma-key overlay reference (`public/chroma.js`).
- `github.com/AgoraIO-Conversational-AI/agent-samples` — the base backend (`simple-backend`) + react clients.

## How to load
1. `conf/deploy.md` — the detailed, authoritative reference (services, ports, nginx, profiles, rebuild).
2. `docs/ai/L1/*` — the navigable map:
   - `services-and-routes.md` — every pm2 app → port → nginx route → source.
   - `demos.md` — each user-facing demo → URL → what it is → repo → deploy.md section.
   - `baccarat.md`, `signer-overlay.md` — per-demo deep dives.
   - `rebuild.md` — order of operations to rebuild from scratch.

## Secrets
Never in git. Live in gitignored `.env` files: `agent-samples/simple-backend/.env` (profiles,
LLM/TTS/Agora keys), `sign-video-client/.env.local` (`SIGNAPSE_API_KEY`, base path). Service
API keys (e.g. baccarat RTM app-id/cert) are passed via the pm2 start env, not committed.

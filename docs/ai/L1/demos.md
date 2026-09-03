# User-facing demos

Each demo's URL, what it is, its repo, and where the detail lives.

| Demo | URL | What | Source / deep dive |
|---|---|---|---|
| **Baccarat dealer** | `/baccarat/?profile=baccarat_play&controllerEndpoint=wss://wvc-eu-west-2-dev-01.trulience.com` | Voice-played Baccarat dealt by a ConvoAI (Grok) croupier on a Trulience avatar; MCP tool is source of truth; client plays the deal + shows a balance/side bar | `baccarat.md`; client `agora-trulience-sdk`#baccarat; MCP `baccarat/mcp` |
| **Signer overlay** | `/sign-client?overlay=1` | Chroma-keyed Signapse ASL signer overlaid on a video, signing what's heard | `signer-overlay.md`; `sign-video-client/signer-overlay/README.md` |
| Sign demos | `/sign-client?sign=voiceai` / `?sign=all` | Signapse signer panel for the agent's replies / live conversation | `sign-video-client` |
| Voice AI | `/react-voice-client?profile=VOICE` (or `PREMIUM`) | Cascading voice pipeline | agent-samples |
| Video avatar | `/react-video-client-avatar` | Video avatar + transcription | agent-samples |
| Therapist | `/react-video-client-avatar-thymia` | Avatar + voice/video biomarkers | agent-samples `recipes/therapist.md` |
| EDT luma | `/edt`, `/edt-gemini` | 3D air-fryer viewer via MCP `set_scene` | `web/edt-mcp-node`, luma client |
| Others | `/photo`, `/dealer/`, `/news/`, `/benchmark/`, `/create` (palabra) | see deploy.md | `web/*` |

Landing page (`/`) lists the headline demos: `/var/www/landing/index.html` (root-owned, **not** in git).

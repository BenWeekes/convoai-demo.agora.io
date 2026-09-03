# Baccarat demo

Voice-played Baccarat: a ConvoAI (Grok) croupier "Gee Gee" on a Trulience avatar deals
Baccarat; an MCP tool is the source of truth for cards/winner/balance; the web client plays
the deal video and shows a Player/Banker + balance bar.

- **`mcp/`** — the dealer service (this repo). pm2 `baccarat-mcp` :8117 (`/baccarat-mcp/`) +
  `baccarat-llm-proxy` :8118 (`/baccarat-llm/`). Symlinked to `/home/ubuntu/baccarat-mcp` so
  pm2's cwd + hardcoded log paths keep working; `node_modules` → `../../edt-mcp-node/node_modules`.
- **`baccarat_plan.md`** — full design + test guide.

Client app lives in its own repo: `github.com/BenWeekes/agora-trulience-sdk` (branch `baccarat`),
pm2 `baccarat-client` :3040 (`^~ /baccarat/`).

Deep dive: `docs/ai/L1/baccarat.md`. Rebuild + env: `conf/deploy.md` (Baccarat section).
Profile `baccarat_play` lives in `agent-samples/simple-backend/.env` (gitignored).

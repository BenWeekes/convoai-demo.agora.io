# AI Agent Instructions — convoai-demo.agora.io

This private repo is the rebuild bible for the demo server. To get oriented:

1. Read `docs/ai/L0_repo_card.md`, then load `docs/ai/L1/*`.
2. `conf/deploy.md` is the authoritative, detailed reference (services, ports, nginx, profiles, rebuild).
3. Each demo whose service source lives in this repo has its own root folder (e.g. `baccarat/`,
   `edt-mcp-node/`); `conf/` and `docs/` hold only shared config + docs. Client apps that live in
   their own repos are listed in `docs/ai/L0_repo_card.md`, cloned/built per `conf/deploy.md`.

Secrets are never committed — they live in gitignored `.env`/`.env.local` files and pm2 start-env.

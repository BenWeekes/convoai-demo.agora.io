# Rebuilding the server

`conf/deploy.md` is the authoritative step-by-step. This is the order of operations and where
each piece comes from. Everything runs under **pm2** behind **nginx** (`sites-enabled/palabra`,
a copy is versioned here as `conf/palabra.conf`).

## Order
1. **System:** nginx, node (nvm; note CRA/Next builds — Baccarat client is CRA5, sign-client is
   Next and MUST build with `next build --webpack`), pm2, ffmpeg (for the signer idle composite).
2. **nginx:** install `conf/palabra.conf` → `sites-enabled/palabra`; `nginx -t` + reload. Keep
   backups OUT of `sites-enabled/` (nginx loads every file there). Client path locations need `^~`.
3. **Base backend:** clone `agent-samples`; `simple-backend` (:8082, `/simple-backend/`) with its
   gitignored `.env` (all profiles incl. `baccarat_play`); the react clients per deploy.md.
4. **Baccarat:** `conf/baccarat-mcp` → symlink `/home/ubuntu/baccarat-mcp`, `npm i`, pm2
   `baccarat-mcp` (:8117) + `baccarat-llm-proxy` (:8118); clone `agora-trulience-sdk`#`baccarat`,
   build, pm2 `baccarat-client` (:3040). See `baccarat.md`.
5. **Signer:** clone `sign-video-client`, `.env.local` (`SIGNAPSE_API_KEY`,
   `NEXT_PUBLIC_BASE_PATH=/sign-client`), regenerate idle (`signer-overlay/scripts/make-idle.sh`),
   `next build --webpack`, pm2 `sign-client` (:7090). See `signer-overlay.md`.
6. **Other demos** (edt, photo, dealer, news, benchmark, palabra) per deploy.md.
7. **Landing page:** `/var/www/landing/index.html` (root-owned, NOT in git — back it up separately).
8. `pm2 save` so everything survives reboot.

## Secrets to supply (never in git)
- `agent-samples/simple-backend/.env` — all profile + provider keys.
- `sign-video-client/.env.local` — `SIGNAPSE_API_KEY`, base path, Agora keys.
- pm2 start-env for `baccarat-mcp`/`baccarat-llm-proxy` — `BACCARAT_APP_ID/CERT`, `XAI_API_KEY`.

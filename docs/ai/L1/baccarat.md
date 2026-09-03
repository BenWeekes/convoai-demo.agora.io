# Baccarat demo (deep dive)

Voice-played Baccarat: a ConvoAI **Grok** croupier ("Gee Gee") on a Trulience avatar deals
Baccarat; an **MCP tool** is the source of truth for cards/winner/balance; the **client** plays
the deal video and shows a Player/Banker + balance bar. Full detail: `conf/deploy.md`
("baccarat-mcp" + "How the Baccarat round works").

## Pieces
- **Profile** `baccarat_play` in `agent-samples/simple-backend/.env` (gitignored): Grok 4.3 +
  Ares STT + xAI TTS `carina`; `TTS_SKIP_PATTERNS=5` (don't speak `{…}` tags); 5-min cap
  (`MAX_CALL_DURATION_SECONDS=300`); `MCP_SERVERS` → the dealer tool; `LLM_URL` → the debug proxy.
- **MCP dealer** `conf/baccarat-mcp/` (this repo; symlinked to `/home/ubuntu/baccarat-mcp`,
  pm2 `baccarat-mcp`, :8117, nginx `/baccarat-mcp/`): tools `deal_hand`/`get_balance`/`reset_game`,
  per-channel `{balance,shoe}`, always-6 rules in `play_round.cjs`. On a deal it **fire-and-forget
  publishes** two RTM messages: `baccarat.deal {param}` and `baccarat.balance {…}` (RTM login warmed
  at boot). Rejects a re-deal within 6s.
- **LLM debug proxy** `conf/baccarat-mcp/llm-proxy.mjs` (pm2 `baccarat-llm-proxy`, :8118, `/baccarat-llm/`):
  logs full grok I/O to `client.log`/`llm.log`. `BACCARAT_PLAY_LLM_URL` points at it (revert to
  `api.x.ai` when not debugging).
- **Client** `agora-trulience-sdk`#`baccarat` (pm2 `baccarat-client`, :3040, `/baccarat/`): on
  `baccarat.deal` it plays `<trl-scene content="deal" …>` itself (LLM no longer emits the tag —
  it was unreliable); on `baccarat.balance` it arms the reveal + updates the bar. Reveal fires at
  the `avatar:content-changed{deal}` event + `revealOffsetMs` (13s); the bar result lands ~3.5s
  later (just after the deciding 6th card, ~18.3s in). Bet side shows immediately; result after cards.

## Key learnings baked in
- LLM reliably CALLS the MCP tool but was unreliable at emitting the verbatim `<trl-scene>` tag →
  the **client** drives the deal video from RTM instead.
- WebGL/RTC/cross-origin, TTS tag-speaking (`skip_patterns`), all-in bets, bust wording, balance
  timing — see the deploy.md round-flow section.

## Rebuild
1. This repo's `conf/baccarat-mcp` → symlink `/home/ubuntu/baccarat-mcp`, `npm i`, pm2 start
   `baccarat-mcp` (env `BACCARAT_APP_ID/CERT PORT=8117`) and `baccarat-llm-proxy` (env
   `XAI_API_KEY PORT=8118`).
2. Clone `agora-trulience-sdk`, `git checkout baccarat`, `react/.env` (agent endpoint, staging
   Trulience SDK, avatar id), `homepage=/baccarat`, build `--webpack`? (CRA: `npm run build`),
   pm2 `baccarat-client` :3040.
3. nginx: `/baccarat-mcp/`, `/baccarat-llm/`, `^~ /baccarat/` (see palabra.conf).
4. Add profile `baccarat_play` to `simple-backend/.env` (see deploy.md for the full var list).

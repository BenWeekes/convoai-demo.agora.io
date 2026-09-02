# Playable Baccarat — Agent Dealer Plan

Design + implementation plan for a playable Baccarat game dealt by a ConvoAI voice
agent rendered on a Trulience avatar ("Gee Gee"). Companion to `deploy.md`.

## Goal

The user talks to a digital croupier, places a bet, the agent deals a hand on the
Trulience card table, the cards are revealed by the avatar's dealing video, and the
agent tells the user whether they won and updates a running balance. Pure luck game
(no strategy after the bet).

## Stack

| Piece | What | Status |
|---|---|---|
| LLM | Grok 4.3 (xAI, `https://api.x.ai/v1/chat/completions`) | ✅ working |
| ASR | Ares (Agora built-in) | ✅ |
| TTS | Grok / xAI, voice `carina` | ✅ (added `xai` branch to `build_tts_config`) |
| Agent backend | `simple-backend` `/start-agent` (drop-in for the agora-rtc-lambda) | ✅ |
| Avatar | Trulience `digitalhuman.uk/avatar/7256750693112891460`, controller `wss://wvc-eu-west-2-dev-01.trulience.com` (staging) | provided |
| Game logic | **MCP tool server** (`play_round`, `get_balance`) | ⏳ to build |
| Reveal trigger | Client `avatar:content-changed` event → RTM nudge to agent | ⏳ to wire |

Two profiles:
- **`BACCARAT`** — the base voice+persona profile (already in `simple-backend/.env`),
  Grok + Ares + Grok/carina + the Gee-Gee prompt. No game tool yet.
- **`BACCARAT_PLAY`** (to add) — same pipeline + the MCP game tool wired via
  `BACCARAT_PLAY_MCP_SERVERS`.

## Agent start/stop (drop-in for the lambda)

The tru client passes `agora_agent_endpoint=<url>` and calls it exactly like the
lambda (`AgoraRealtimeProvider.startAgoraAgent`). Our equivalent:

- Start: `https://convoai-demo.agora.io/simple-backend/start-agent?profile=baccarat&connect=true`
- Token-only: `&connect=false`
- Stop (drop-in `hangup`, added to `/start-agent`): `…/start-agent?profile=baccarat&hangup=true&agent_id=<id>`

`/start-agent` returns the fields the client reads: `appid, channel, token/user_token,
uid, agent.uid, agent_rtm_uid, rtm_token`.

## How Baccarat works (the minimum)

- Two hands: **Player** and **Banker** (you bet on either, or **Tie**).
- Card values: A=1, 2–9 face, 10/J/Q/K = 0. Hand value = **total mod 10**.
- Each hand gets 2 cards; a **third** may be drawn by fixed rules. Closest to **9** wins.
- Payouts: Player 1:1, Banker 1:1 (casinos take 5% commission — skip for demo),
  Tie 8:1. On a tie, Player/Banker bets push (stake returned).
- Third-card rules: Player draws on 0–5, stands on 6–7; naturals (8/9) stop.
  Banker's draw depends on its total and the Player's third card (standard table).

## Card ↔ avatar mapping

- **Player = left, Banker = right** (the agent must SAY this — the dealing video
  does not label the hands; the client paints dealt cards over white card faces).
- Deal/appearance order in the clip: 2 on the left (Player's two), 2 on the right
  (Banker's two), then a 3rd to the left of the left pair (Player 3rd), then a 3rd
  to the right of the right pair (Banker 3rd).
- Deal tag: `{<trl-scene content="deal" param="P1,P2,B1,B2,P3,B3"/>}`.
  `param` is positional over the clip's anchors **in ascending slot id**; arity must
  match exactly or the media server rejects the switch (`notify:media-server-param-invalid`).
- **CONFIRMED deal sequence:** cards 1,2,3,4 dealt near the camera left→right
  (= P1,P2,B1,B2), then 5,6 at the back-right (= P3,B3). Cards 1–4 are turned over,
  then card 5 is placed to the **left of card 1** and card 6 to the **right of card 4**.
  So slots are numbered in deal order and `param = "P1,P2,B1,B2,P3,B3"`. Player = left,
  Banker = right (final layout L→R: 5,1,2 … 3,4,6).

## Reveal timing (the crux)

The agent must NOT read the cards or the result until the dealing video reveals them.

- Client fires **`avatar:content-changed` `{ content: 'deal' }`** when the deal clip
  actually starts streaming (re-emitted on the public SDK bus from
  `notify:content-changed`, which comes off the per-frame `tickAgoraRVFC`). This is
  the "dealer video has begun" event — **confirmed implemented** in the tru client.
- App listens, waits the **reveal offset** (user to provide; one value, or per-card
  if they turn sequentially), then sends the agent an RTM `user.transcription` like
  `"[reveal]"` to `agent_rtm_uid` (the same RTM path the client already uses for chat).
- Agent then narrates the result it is holding from the tool call.

## End-to-end round

1. User speaks a bet → agent calls MCP `play_round(side, amount)`.
2. Tool returns `{ cards:[6], player_total, banker_total, winner, user_won, payout, balance }`.
3. Agent emits `{<trl-scene content="deal" param="<cards>"/>}` + a NON-revealing
   filler ("Dealing now, let's see how this falls"); holds the result.
4. Deal clip begins → client fires `avatar:content-changed {content:'deal'}` → app
   waits reveal offset → sends `"[reveal]"` over RTM to the agent.
5. Agent announces: left = Player has X and Y (total N), right = Banker has …,
   winner, user win/lose, new balance.

## The MCP tool

Deterministic source of truth (LLMs are unreliable at the third-card rules,
arithmetic, and balance state):

```
play_round(side: "player"|"banker"|"tie", amount: number) -> {
  cards:        ["P1","P2","B1","B2","P3?","B3?"],   // slot order, empties allowed
  player_total, banker_total,
  winner:       "player"|"banker"|"tie",
  user_won:     bool,
  payout:       number,     // net change (+win / -stake / 0 push)
  balance:      number
}
get_balance() -> { balance }
```

- Per-channel session state: shoe + balance. **Start balance = 100 USD**; min/max bet
  TBD; reject bets over balance.
- **Balance → client over RTM** (like the Thymia/Shen recipe in
  `agent-samples/recipes/therapist.md`): after each round publish an object-typed RTM
  message on the channel, e.g. `{ object: "baccarat.balance", balance, currency: "USD",
  delta, last_result }`, so the client can display the balance. Publisher: the MCP node
  server (RTM publish, `edt-mcp-node/rtm.mjs` pattern) OR `server-custom-llm` if the
  RTM plumbing is easier to start there.
- **MCP vs custom-llm:** MCP for the game tool (also works with MLLM). If the RTM
  send/receive glue (balance out, `[reveal]` in) is easier in `custom-llm` to begin
  with, do that part there — they can coexist.
- The dealer should be able to **explain the rules** on request.
- **OPEN — 6 vs 4 cards:** (a) always deal 6 (simple, always fills the clip) or
  (b) real third-card rules with empty 3rd-card slots (`"AH,7S,KC,3D,,"`). Depends
  on whether the clip renders sensibly with an empty slot.
- Home: an MCP server like `edt-mcp-node`, wired via `BACCARAT_PLAY_MCP_SERVERS`.
  Grok supports tool/function calling, so the agent invokes it.

## Prompt

Base Gee-Gee persona already in `BACCARAT_DEFAULT_PROMPT` (persona, greeting rules,
Trulience `deal`/`smile`/`happy`/`concerned`/`neutral` tags, language + formatting +
safety). Add the game spine: get a valid bet → call `play_round` → deal the tool's
exact cards + a non-revealing filler → wait for `[reveal]` → announce hands
(left=Player, right=Banker), winner, win/lose, new balance — always from the tool's
values, never invented.

## Testing

- Audio round-trip: `server-custom-llm/go-voice-probe/run-voice-probe.sh BACCARAT`
  (Agora Go SDK — start agent, publish a WAV question, confirm it talks back).
  Already ✅ for BACCARAT.
- Deal-tag / text: `server-custom-llm/node/run-rtm-test.sh` (send a text
  `user.transcription` to the agent's RTM uid, capture the reply — confirm the
  `{<trl-scene content="deal" …/>}` tag + 6 codes come out).
- Standalone game maths: `baccarat-mcp/` prototype (rules + settle + balance) to
  sanity-check before wiring to the agent.

## Dev environment

- The tru client (`~/tru/client`, source only, not built here) can be **built/run
  locally pointing at tru staging** if client changes are needed (e.g. the reveal
  listener). Otherwise the hosted `digitalhuman.uk/avatar/7256750693112891460` uses
  the baccarat dealing avatar.
- RTM: the tru client's `AgoraRealtimeProvider` already logs into RTM, subscribes the
  channel, and can send `user.transcription` to `agent_rtm_uid`. The MCP node server
  (`edt-mcp-node/rtm.mjs`) is RTM **publish-only**; full RTM **receive** lives in
  `server-custom-llm` — only needed if the server (not the client) must catch the
  deal-begin event.

## Open decisions

Resolved: anchor order = `P1,P2,B1,B2,P3,B3` ✅ · start balance = 100 USD ✅ ·
balance → client via RTM (Thymia-style) ✅ · MCP for the tool ✅.

Resolved (cont'd): **always-6** ✅ — the dealer clip always shows six cards, so the
tool deals 3 to each hand and counts all three (house variant; not casino third-card
rules — no naturals, forces the third card). `baccarat-mcp/play_round.js` defaults to
this. Real third-card rules remain available in the code if a variable-card (4–6) clip
is ever used.

Still open:
1. **Reveal offset(s)** — ms from `content:'deal'` to when cards 1–4 are turned, and to
   when 5/6 are placed. Agent announces after the final reveal (or in two beats).
2. **Min/max bet**, Banker commission (skip for demo?), Tie payout (8:1?).
3. **Reveal transport** — client sends `[reveal]` RTM straight to the agent
   (recommended) vs a URL endpoint. Balance-out RTM: MCP publisher vs custom-llm.

## Implementation steps

1. ✅ Prototype `baccarat-mcp/play_round.cjs` (deal + rules + settle + balance) — done,
   maths reviewed, defaults to always-6.
2. ✅ MCP server + `BACCARAT_PLAY` profile — done (see "Built" below).
3. ✅ Prompt game spine + `[reveal]` wait + exactly-once deal — done.
4. ⏳ App-side (tru client): listen for `avatar:content-changed {content:'deal'}`, wait
   the reveal offset, send `[reveal]` over RTM to `agent_rtm_uid`. NOT built yet.
5. ⏳ Final live test on the baccarat avatar (spoken narration + reveal-hold).

## Built (2026-09-01)

**baccarat-mcp** — Node streamable-HTTP MCP server, `/home/ubuntu/baccarat-mcp/`:
- `play_round.cjs` — dealer maths (always-6 default; real third-card rules retained).
- `server.mjs` — tools `deal_hand(bet_side,bet_amount)`, `get_balance()`, `reset_game()`.
  Per-channel session state (balance from $100 + shoe). On each deal it publishes a
  `baccarat.balance` object message over RTM to the channel (Thymia-style), and returns
  the ground-truth result + the `deal_tag` for the avatar.
- `rtm.mjs` — dealer-bot RTM publisher (BACCARAT_APP_ID/CERT), 24h token auto-refresh.
- Runs under **pm2 `baccarat-mcp`, port 8117** (`pm2 save`d). nginx: `location
  /baccarat-mcp/` → `127.0.0.1:8117` (SSE: buffering off, 3600s read).
- Public MCP endpoint: `https://convoai-demo.agora.io/baccarat-mcp/mcp` (ConvoAI appends
  `/<channel>` via `append_user_id:true`).

**Profile `BACCARAT_PLAY`** (in `simple-backend/.env`): same Grok 4.3 + Ares + xai/carina
pipeline as `BACCARAT`, plus `BACCARAT_PLAY_MCP_SERVERS` → the baccarat-dealer tool, and a
prompt with the game spine (get side+amount → call `deal_hand` **exactly once** → show
`deal_tag` + non-revealing filler → **wait for `[reveal]`** → narrate left=Player,
right=Banker, winner, win/lose, new balance — always from the tool).

### Verified
- MCP tools + always-6 maths + running balance — direct MCP client (`test-mcp.mjs`).
- Public path through nginx — external MCP call deals + returns.
- ConvoAI accepts `baccarat_play`; **MCP session initializes on every agent join**.
- Agent calls `deal_hand` **exactly once** per decisive bet; `baccarat.balance` reaches
  the client over RTM; `[reveal]` triggers no extra deal (`run-play-test.sh`).
- Audio round-trip (agent speaks: Ares→Grok→xai) — `go-voice-probe baccarat_play` ✅.

### Not yet verifiable here / open
- The agent's **spoken text** (deal_tag emission, holding the reveal, narration) can't be
  read from an RTM client — ConvoAI transcripts ride the **RTC data stream**
  (`decodeStreamMessage`), not RTM. Verify live on the tru client, which shows the agent
  transcript. Casual bets ("ten on tie") sometimes make the agent confirm instead of
  dealing — minor phrasing/prompt tuning, best done live.

### How to test
- Full bet→reveal over RTM (starts agent, sends bet, then `[reveal]`, shows tool log):
  `/home/ubuntu/baccarat-mcp/run-play-test.sh "I bet twenty on the banker, deal." 20`
- MCP tools only: `node /home/ubuntu/baccarat-mcp/test-mcp.mjs <channel>`
- Audio: `~/server-custom-llm/go-voice-probe/run-voice-probe.sh baccarat_play`
- Live avatar (agent text visible): the tru client with
  `agora_agent_endpoint=https://convoai-demo.agora.io/simple-backend/start-agent?profile=baccarat_play`
  on the baccarat dealing avatar.

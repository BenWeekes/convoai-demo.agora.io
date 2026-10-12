# Voice Slot Machine — Agent Host Plan

Design + implementation notes for a voice-driven slot-machine game presented by a
ConvoAI agent rendered as a chroma-keyed LemonSlice avatar ("Lucky Spin"). Companion
to `deploy.md` and modeled on `web/baccarat/baccarat_plan.md`.

## Goal

The user talks to a slot-machine host. They say "spin for me"; the agent calls an MCP
tool that decides the reel outcome (source of truth), the browser animates a 5-reel
machine to that result, the balance (starts at $100) moves up or down, and the host
narrates the win/loss. Pure luck. No transcript or chat UI. The avatar is chroma-keyed
over a casino background with the player's own camera in a small round window.

## Stack

| Piece | What | Status |
|---|---|---|
| MLLM | **Gemini 3.8 live** (realtime, voice `Aoede`) — fires MCP tools | ✅ |
| ASR | Ares (Agora built-in) | ✅ |
| Avatar | **LemonSlice** `generic`, image `aa.png` on a forced **blue** fill (`#004AC6`) for chroma | ✅ |
| Agent backend | `simple-backend` `/start-agent?profile=slot_play` | ✅ |
| Game logic | **MCP tool server** `slot-mcp` (`spin`, `get_balance`, `reset_game`) | ✅ |
| Result → client | Browser **polls** `GET /slot-mcp/state/<channel>` (RTM also published, unused by this client) | ✅ |
| Slot engine | [flixrp/HTML-slot-machine-example](https://github.com/flixrp/HTML-slot-machine-example), `setResult` driven by server | ✅ |
| Chroma | `avatar-overlay/public/chroma.js` (WebGL), key `#004AC6` | ✅ |
| Frontend | static `avatar-overlay/public/slot/index.html` (no build) | ✅ |

## Components / ops

| Piece | Where | Port / route |
|---|---|---|
| slot-mcp (Node) | `web/slot/mcp/` (pm2 `slot-mcp`, `start.sh`) | `127.0.0.1:8119` → nginx `/slot-mcp/` |
| slot_play profile | `simple-backend/.env` (`SLOT_PLAY_*`) | via `/simple-backend/start-agent` |
| Frontend | `avatar-overlay/public/slot/` (served by `avatar-overlay` :8090) | `/avatar-overlay/slot/` |
| Assets | `aa.png` (square blue avatar), `ca.png` (bg), `items/*.png` (fruit) | same dir |

`slot-mcp` reads the Agora App ID + cert for its RTM dealer-bot from the gitignored
`simple-backend/.env` (`EVENTDEMO_APP_ID` / `_CERTIFICATE`) via `start.sh` — no secret
in source. Same shared app the `slot_play` profile uses, so the bot publishes into the
same Agora project the client joins.

## The MCP tool (`web/slot/mcp/server.mjs` + `slot.cjs`)

`spin(bet_amount?)` — decides the outcome **server-side**, settles the stake, mutates the
per-channel balance, stores `lastSpin` on the session (for polling), publishes RTM
(`slot.spin` + `slot.balance`), and returns the ground-truth JSON for the host to narrate.
`get_balance()` and `reset_game()` round it out. The channel comes from the URL path
(`/mcp/<channel>`, appended by ConvoAI via `append_user_id`) and is both the balance key
and the RTM target — exactly the Baccarat pattern.

Outcome model (`slot.cjs`): ~50% of spins win (tunable `SLOT_WIN_PROB`), heavily weighted
to small wins; a 5×3 grid is synthesised to match the chosen outcome (left-aligned run of
3/4/5 on the centre payline). Paytable multiplies the stake: low fruit 3/4/5 = ×2/×10/×40,
`lucky_seven` = ×5/×25/×100, `big_win` = ×10/×50/×250. Default stake `SLOT_STAKE=10`,
start balance `SLOT_START_BALANCE=100`. A plain HTTP `POST /slot-mcp/spin/<channel>` runs
the same logic for testing without voice.

## Profile (`SLOT_PLAY`)

Cloned from `EVENTDEMO` (so: Gemini 3.8 MLLM + Ares ASR + LemonSlice avatar), then:
- `SLOT_PLAY_MCP_SERVERS` → `[{"name":"slot-dealer","endpoint":".../slot-mcp/mcp","transport":"streamable_http","append_user_id":true}]`
- `SLOT_PLAY_AVATAR_ID` = `.../avatar-overlay/slot/aa.png`, `AVATAR_ASPECT_RATIO=1x1`, `AVATAR_EDIT_IMAGE=false`
- `SLOT_PLAY_AVATAR_BACKGROUND_COLOR=#004AC6` — LemonSlice segments the person and fills the
  background with this colour, giving a clean uniform key (same mechanism EVENTDEMO uses with `#000000`).
- Slot-host greeting + prompt (say a build-up line, call `spin`, narrate the result, give the balance).

## Frontend (`avatar-overlay/public/slot/index.html`)

Joins the channel with the ui-kit flow: `GET /simple-backend/start-agent?profile=slot_play&channel=<rand>`
→ join RTC (`mode:"rtc"`), publish mic, subscribe the agent audio + avatar video (uid 102)
→ feed the avatar `<video>` into `ChromaKeyRenderer` (key `#004AC6`) → `<canvas>` over the
`ca.png` background. Local camera is shown (not published) in a round window. Mic mute via
`mic.setMuted`. Poll `/slot-mcp/state/<channel>` every 450 ms; on a new `lastSpin.seq`,
animate the reels to `reels` and set the balance. Client session cap = 180 s (matches the
backend `MAX_CALL_DURATION_SECONDS`). `?debug=1` shows an on-screen event log.

## Gotchas (the ones that bit)

- **Integer uid is mandatory.** Join with a **number**, not a string. Passing `"101"` puts the
  client in string-uid mode (mapped to a random id) and it never sees the integer-uid agent
  (100) / avatar (102) — no video, no audio. Coerce `uid = Number(...)` when `enable_string_uid`
  is false. This was the "no avatar/voice" bug.
- **Avatar is 1×1.** Give the `<canvas>` a square backing store + `aspect-ratio:1/1`, else the
  square video is stretched vertically.
- **This server can't complete a browser RTC session** (Agora SD-RTN edge unreachable from a
  headless browser here — `wss://…sd-rtn.com:<port>` fails). Validate the backend with the
  native Go probe (`vendor_sdk/bin/recv_pcm_stream_rtc <app> <ch> <token> <self> <target>`),
  and validate the client in a real browser. Headless render tests are false negatives for media.

## Testing

- MCP: `curl -XPOST /slot-mcp/spin/<ch>`, `GET /slot-mcp/state/<ch>`, `POST /slot-mcp/reset/<ch>`.
- Backend/agent: `GET /simple-backend/start-agent?profile=slot_play&channel=<ch>` → `agent_response.success`;
  probe the channel with `recv_pcm_stream_rtc` to confirm uid 100 + 102 join and 102 streams audio.
  Always hang up test agents: `GET /simple-backend/hangup-agent?agent_id=<id>&channel=<ch>&profile=slot_play`.
- Client: open `/avatar-overlay/slot/` (add `?debug=1` for the log) in a real browser.

## Built (2026-10-07)

- `slot-mcp` service (tools + HTTP + polling + RTM bot), nginx route, pm2 persisted.
- `slot_play` profile (Gemini 3.8 + LemonSlice `aa.png` blue + MCP).
- Static chroma frontend (slot engine + self-view + mic mute + balance + 180 s cap).

### Verified
Service health; agent + avatar spawn (uid 102) and audio stream (native probe); MCP tool
discovery by the agent; HTTP spin/reset/state; integer-uid join; real-browser avatar + voice + spin.

### Open / possible follow-ups
- Make the manual control work by sending an RTM "spin" to the agent (so the host narrates it) —
  for now the demo is voice-only (manual Spin button removed).
- Home-page card on `/var/www/landing`.
- Chroma / avatar framing tuning per screen.

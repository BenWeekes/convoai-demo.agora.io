# Director — event-driven avatar host/commentator (CloudSlot + chat demos)

A generic server-side **director** turns typed events into avatar speech, in real time, for live
host/commentator demos. Two front-ends ship on it:

- **CloudSlot** (`/cloudslot/`) — a live slots host whose avatar is rendered **server-side by the
  Trulience TMS** (game + avatar composited side-by-side), commentating on live game events + chat.
- **Slickback** (`/slickback/`) — a chat-driven host demo (JSON editor → director), avatar rendered
  by LemonSlice.

Backend lives in `agent-samples/simple-backend` (`core/director.py` + routes in `local_server.py`);
front-ends + the RTM relay live here (`web/cloudslot/`, `web/slickback/`, `web/quiz/mcp/director_rtm.mjs`).

## The director engine (`core/director.py`)

One daemon scheduler thread services every active session. Inbound **typed events** land in a
per-session, thread-safe inbox:

- `{"type":"message","from","text"}` — chat → reply, addressing the sender by name.
- `{"type":"game","text"}` — a live game moment → one punchy commentary line.

**Priority ladder** (high→low): `interrupt` (moderator mic barge-in) → `win` (a real win / bonus) →
`message` (chat) → `game` (ordinary game commentary) → `low`. Each tick, for a **quiet** session (not
speaking, past its busy estimate, debounced, not **gated**): an interrupt-class item (`interrupt` or
`win`) fires immediately via `/speak INTERRUPT`; otherwise the top-ranked item is pushed via
`/speak APPEND`. Empty inbox + sustained quiet → **game-aware filler** (comment on the latest spin,
losses included) if a fresh game snapshot exists, else generic banter (never dead air).

- **Speak-only agents.** The agent's own LLM is a **no-op** (`/simple-backend/noop-llm/chat/completions`,
  returns empty) so it never auto-replies — the director is the single voice. Crafts with `CRAFT_LLM_*`
  (grok-4.3). The ConvoAI greeting is also emptied where speech must wait for readiness (Slickback).
- **Line cleanup.** Every crafted line is stripped of emoji and of a **trailing vocative**
  (`"…locked in, folks!"` → `"…locked in!"`) — mid-sentence vocatives are kept.
- **Per-profile knobs** (config → director session): `FILLER_GAP_S` (quiet seconds before filler; small =
  near-continuous, e.g. Slickback `1`), `ALLOW_INTERRUPT` (`false` → **every** line APPENDs, host never
  cuts itself off — Slickback), `REQUIRE_AVATAR_READY` (`true` → hold all speech until the page POSTs
  `/director/status {avatarReady:true}` on first decoded frame; fallback timer releases).
- **Message fairness + de-dup.** A message answers a given send **once** (a duplicate still *waiting* in
  the inbox is dropped; a genuine re-send after the first was spoken is allowed). A sender just answered
  is de-prioritised, so a different user waiting gets a turn first.
- **Quiet detection** = ConvoAI's RTM `state.speaking`, consumed **server-side** by a per-session node
  RTM relay (`director_rtm.mjs`, retries the transient `-13012`); it also forwards the moderator's
  `user.transcription` (final) as an `interrupt` message. Browser relay is a fallback.
- **Win calling + snapshot** (CloudSlot): `/api/game-events` maps raw Sugar-Rush v1 events → director
  events. **Every** win the player sees is called out, tiered by `winMultiplier`: ≥10× `HUGE WIN`, ≥3×
  `Big win` (both INTERRUPT), 1–3× ordinary and sub-stake "small win, under the bet" (both APPEND, and
  ordinary game commentary coalesces to the latest so fast spins don't pile up). Free-spins bonus →
  announced once. Amounts are spoken in **dollars** (`$2.40`). Scaling uses engine fields **only**
  (`betMinor` + `winMultiplier`) — never inferred. Every `round.settled` also updates a running
  **snapshot** (bet/total/result/streak/tumbles/balance) used for the game-aware filler, so the host is
  aware of losses and cold streaks. Dedup by `id`, drop stale by `observedAt`, ack (2xx) before crafting.

## Routes (`simple-backend`)

| Route | Purpose |
| --- | --- |
| `POST /director/start?profile=&game=&avatar=` | Start a session. For a TMS profile: dual-channel + TMS session create (below). Else single-channel (demo). Returns join creds + `eventsUrl`. |
| `POST /director/events?session=` | Typed events in (`[{type,text,from?,priority?}]`, list / `{events:[]}` / single). |
| `POST /director/speaking?session=` | `state.speaking` relay (accepts `{speaking}` or TMS `{state}`). |
| `POST/GET /director/status?session=` | TMS `rendererReady`/`gameVideoReady` + browser `clientVideoReady` (drives activation); for a non-TMS session `{avatarReady:true}` releases the `REQUIRE_AVATAR_READY` gate. |
| `POST /director/stop?session=&profile=` | TMS `DELETE` even if the in-memory map was lost (restart-safe — the session id **is** the TMS sessionId), hang up the agent, kill the relay. |
| `POST /api/game-events?session=` | Raw game-event receiver (bearer + `Idempotency-Key`, dedupe by `id`). Expects `betMinor` + `winMultiplier` on `round.settled` (doCollect) for win scaling; `[GAMEEV]` logs each event + mapping. |
| `POST /noop-llm/chat/completions` | Empty-completion LLM for speak-only agents. |

## CloudSlot ↔ Trulience TMS (staged behind `TMS_URL`)

When a profile has `TMS_URL` set, `/director/start` runs the full orchestration (contract: the TMS
game-avatar architecture). `TMS_URL` is the **complete sessions endpoint** — POST to it to create;
append `/{sessionId}`, `/{sessionId}/activate` for the rest (no re-appended path).

1. Mint **renderer** tokens (input subscriber `91004`, output publisher `102`, renderer RTM) +
   browser tokens (moderator mic on input, viewer on output); fresh `sessionId`/`runId`.
   **RTM login uid must equal its token's rtm_uid** (channel-scoped) — else the renderer fails.
2. `POST {TMS_URL}` with the start-request (dual channels, `composition` 1920×540 side-by-side
   game-left/avatar-right no-letterbox, `speechPolicy` speak-only, `clientPolicy`, renderer `rtm`,
   `callbacks.status`, `game.eventSink`). → 202.
3. Start the speak-only agent on the **input** channel; register the director **gated**; spawn the RTM
   relay on the input channel.
4. Poll `GET {TMS_URL}/{id}` for `rendererReady`; on `rendererReady` + browser `clientVideoReady`
   → `POST …/{id}/activate`. Release the commentary gate on `gameVideoReady` + `clientVideoReady`.
5. `DELETE {TMS_URL}/{id}` on stop. **No heartbeat** — the TMS watches the agent uid's channel presence.

Browser (`web/cloudslot/`): subscribes the composite on the **output** channel (uid 102), publishes
mic (muted by default) on the **input** channel, POSTs `clientVideoReady` on first decoded frame. The
page offers a **game** dropdown + an **avatar-id** box (passed through as `?game=`/`?avatar=`).

**Profiles:** `CLOUDSLOT` (cascading ares + grok-4.3 + xai/carina, `TMS_URL` set, `TRL_AVATAR_ID`;
interrupts on for wins), `SLICKBACK` (LemonSlice **cartoon** avatar at `AVATAR_ASPECT_RATIO=2x3`,
near-continuous blackjack banter `FILLER_GAP_S=1`, `ALLOW_INTERRUPT=false` so he always APPENDs,
`REQUIRE_AVATAR_READY=true`, empty greeting, loading spinner on the page), `DIRECTOR` (generic,
audio-only). The avatar id/scene must be provisioned on the TMS broker; `CLOUDSLOT_GAME_URL` is
allowlisted broker-side.

**LemonSlice cartoon model:** pass `AVATAR_MODEL=cartoon` (forwarded to the generic provider as
`model`) for animated / non-human characters — it renders **only** at aspect `2x3`, so set
`AVATAR_ASPECT_RATIO=2x3` with it. Same `model`/`2x3` combo is used by the `avatar-direct` grid
pipeline (`build_grid.sh`) for its cartoon cells (top-cropped to square).

## Known gotchas

- Any RTM login (relay, renderer) must use the **channel-scoped rtm_uid the token was built for** — a
  bare uid gives `-10015 NO_AUTHORIZED`; a mismatch silently fails the renderer.
- `/speak` text is capped at 512 bytes; `INTERRUPT` does **not** purge queued `APPEND`s — keep the
  director queue shallow.
- Game events can burst; narrate `round.settled` wins/bonus only (there is no bonus-start event — infer
  from `freeSpins*`), and never narrate raw minor units.

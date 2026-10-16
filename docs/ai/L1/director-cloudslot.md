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
- `priority`: `"interrupt"` (cut in via `/speak INTERRUPT`), `"normal"` (ahead of chat), `"low"` (chat default).

Each tick, for a session that is **quiet** (not speaking, past its busy estimate, debounced, and not
**gated**), the director ranks the inbox (priority → game-over-chat → recency), asks the **craft LLM**
(grok-4.3) for ONE short line, and pushes it via ConvoAI **`/speak`** (`APPEND`; `INTERRUPT` only for a
moderator). Empty inbox + sustained quiet → generic banter (never dead air).

- **Speak-only agents.** The agent's own LLM is pointed at a **no-op** endpoint
  (`/simple-backend/noop-llm/chat/completions`, returns empty) so it never auto-replies/greets — the
  director is the single voice. The director crafts with **`CRAFT_LLM_*`** (grok-4.3), separate from the
  agent LLM. Set per profile: `*_LLM_URL=<noop>`, `*_CRAFT_LLM_URL/MODEL/API_KEY=<grok>`.
- **Quiet detection** = ConvoAI's RTM `state.speaking` (true/false), consumed **server-side** by a per
  session node RTM relay (`director_rtm.mjs`, `rtm-nodejs` + `RtmTokenBuilder`, retries the transient
  `-13012`). The relay also forwards the moderator's `user.transcription` (final) as an
  `interrupt` message. Browser relay is a fallback.
- **Credits/coalescing** (CloudSlot): `/api/game-events` maps raw sstreamer v1 events → director events,
  narrating only notable moments (`round.settled` with a win / free-spins), converting minor units to
  credits (`740` → `7.40`), deduping by `id`, dropping stale by `observedAt`, acking (2xx) before crafting.

## Routes (`simple-backend`)

| Route | Purpose |
| --- | --- |
| `POST /director/start?profile=&game=&avatar=` | Start a session. For a TMS profile: dual-channel + TMS session create (below). Else single-channel (demo). Returns join creds + `eventsUrl`. |
| `POST /director/events?session=` | Typed events in (`[{type,text,from?,priority?}]`, list / `{events:[]}` / single). |
| `POST /director/speaking?session=` | `state.speaking` relay (accepts `{speaking}` or TMS `{state}`). |
| `POST/GET /director/status?session=` | TMS `rendererReady`/`gameVideoReady` + browser `clientVideoReady`; drives activation + commentary gate. |
| `POST /director/stop?session=&profile=` | TMS `DELETE` (or stop), hang up the agent, kill the relay. |
| `POST /api/game-events?session=` | Raw game-event receiver (bearer + `Idempotency-Key`, dedupe, units, coalesce → director). |
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

**Profiles:** `CLOUDSLOT` (cascading ares + grok-4.3 + xai/carina, `TMS_URL` set, `TRL_AVATAR_ID`),
`SLICKBACK` (LemonSlice avatar, ElevenLabs voice), `DIRECTOR` (generic, audio-only). The avatar id and
scene must be provisioned on the TMS broker; `CLOUDSLOT_GAME_URL` is allowlisted broker-side.

## Known gotchas

- Any RTM login (relay, renderer) must use the **channel-scoped rtm_uid the token was built for** — a
  bare uid gives `-10015 NO_AUTHORIZED`; a mismatch silently fails the renderer.
- `/speak` text is capped at 512 bytes; `INTERRUPT` does **not** purge queued `APPEND`s — keep the
  director queue shallow.
- Game events can burst; narrate `round.settled` wins/bonus only (there is no bonus-start event — infer
  from `freeSpins*`), and never narrate raw minor units.

# CloudSlot — demo-backend feedback on the "Cloud Game + Native Avatar" wsd

Feedback from the **demo-backend** side on the Trulience TMS architecture proposal
(`https://agora-pub.trulience.com/game-avatar-architecture/`). Audience: the TMS / game-source
team and their AI. Last updated 2026-10-16.

## Main concerns — please reply to these

1. **Single speech authority + moderator barge-in.** The director owns every utterance (game events +
   chat). The agent is `/speak`-driven only — no autonomous reply to mic. User/moderator speech reaches
   the backend as `user.transcription`; the backend crafts the reply. A **moderator** utterance is
   raised as an **interrupt** → `/speak INTERRUPT` for an immediate barge-in (no dual-authority
   collision). This needs **low-latency transcription delivery** (partial + final) so the barge-in
   feels instant. Confirm the agent profile supports ASR→transcription with no auto-response, and that
   `/speak INTERRUPT`/`APPEND` is the cancel/queue mechanism.
2. **Avatar speaking/idle callback → backend.** We need "is the avatar talking" for turn-taking; the
   browser is on the output channel and can't see it. TMS owns the A2C pacer — please POST speaking
   start/stop to the backend (or expose a status field).
3. **Presentation alignment.** Commentary path and game-frame path differ by seconds. Please expose a
   presentation timestamp (or a fixed compositor delay) so we can align commentary to what the viewer
   sees.
4. **Layout — decided:** side-by-side, game left / avatar right, **no letterboxing**, 30fps (see Decided).
5. **Game-events schema:** confirm it's stable and send the full list of `type` values + which carry
   win/bonus data.

Detail on each below.

## Context (what the demo-backend already provides)

- A generic **director** engine + REST that turns typed events into avatar speech:
  - `POST /simple-backend/director/start?profile=CLOUDSLOT` — starts the voice agent, registers the
    director, makes a server-to-server call to the TMS, returns join creds + `agoraVideoToken` +
    `eventsUrl` + `speakingUrl`.
  - `POST /simple-backend/director/stop?session=<id>&profile=CLOUDSLOT`.
  - `POST /simple-backend/director/events?session=<id>` — typed events `{type:"message"|"game", text,
    from?, priority:"interrupt"|"normal"|"low"}`.
- The agent: cascading **ASR (ares) + grok-4.3 + ElevenLabs TTS**, driven by Agora ConvoAI `/speak`
  (`INTERRUPT` = barge-in/cancel, `APPEND` = queue). `data_channel=rtm`.
- Director behaviour: ranks events (priority, then game-over-chat, then recency), crafts one short line
  per utterance via grok-4.3, pushes via `/speak`; `interrupt` events cut in; fills quiet with banter.
  Message/game mixing + interrupt already work end-to-end.

So the remaining work on our side is **re-plumbing to two channels + a game-events receiver**, not a
redesign. The director/grok/`/speak`/priority model maps straight onto this.

## Channels: we'll go with TWO channels

One channel with different uids would work, but **two channels (input + output) is safer** and is what
we'll build to — it cleanly prevents mic↔avatar feedback and separates "user→agent" from
"composite→viewer". Confirming the contract:
- **input** channel: browser publishes mic; renderer subscribes as `subscriberUid 91004`; agent
  publishes audio as `agentUid 100`. Backend starts the agent on this channel.
- **output** channel: TMS publishes composite video + agent audio as `publisherUid 102`; browser
  subscribes output only (does not play raw agent audio).
- Assumption: **backend mints all tokens/uids** (browser mic-pub + output-sub; renderer input/output).
  Please confirm.

## Confirm

1. The channel/uid contract above (and token ownership).
2. **Single speech authority:** the agent is **`/speak`-driven only** — backend owns every utterance.
   The agent must **not** autonomously LLM-reply to mic; user speech is delivered to backend as
   `user.transcription` and we craft the reply. Please confirm the agent profile supports
   "ASR → transcription, no auto-response," and that `/speak INTERRUPT`/`APPEND` is the
   cancel/queue mechanism.
3. Game-events sink `POST /api/game-events`, session-scoped bearer, `Idempotency-Key: {id}`. Is the
   event schema stable? Please send the full list of `type` values and which carry win/bonus data.
4. Units: integer minor (740 = 7.40), `unitsPerCredit` authoritative, `totalWinMinor` cumulative.

## Decided (by demo-backend owner, 2026-10-16)

- **Layout:** side-by-side, **game left / avatar right**. **No letterboxing** — fill each half; crop
  as needed so each side is roughly 4:3 (or whatever fills best). Exact output dimensions are the
  TMS's call under that fill rule (we are **not** forcing 1280×720/contain). 30fps target.
- **Director never interrupts itself.** Game events and chat are **APPEND only** — including big wins.
  The **only** source of `/speak INTERRUPT` is **moderator voice input** (rare).
- **Mic:** in production only the **moderator** has a mic. The test/operator client may have a mic but
  it is **off by default**.
- **Game URL:** provided by the demo-backend (origin `convoai-demo.agora.io`) in the session-create
  `game.url`, passed through to the TMS and on to sstreamer — same provenance/flow as the director
  `eventsUrl`.
- **Session model:** one private game per user (per-session), not broadcast.

## Please add

1. **Avatar speaking/idle callback → backend.** We need "is the avatar talking" for turn-taking, but
   the browser is on the output channel and can't see it. Since the TMS owns the A2C audio pacer, a
   small POST to the backend on speaking start/stop (or a status field) is the clean source.
2. **Presentation alignment.** The commentary path (event → LLM → `/speak` → A2C → composite →
   encode) and the game-frame path differ by seconds, so the host can call a win before/after the
   viewer sees it. Please expose a **presentation timestamp** (or a known fixed compositor delay) so
   we can align commentary to when the frame is actually shown.
3. **`game.ready` / first-good-frame signal** to the backend so we gate initial commentary (the wsd
   says it precedes narration — please confirm the delivery path).

## Acknowledged / agreed

- S1 bounded shared-memory open; S2 round id/step on progress events (helps us correlate + coalesce);
  S4 delivery — we'll **dedupe by `id`, drop stale by `observedAt`, ignore stopped-run events, watch
  `seq` gaps**.
- Event **coalescing is the backend's job**: we'll narrate notable moments (`round.settled` with
  meaningful wins, bonus/free-spin starts, big multipliers) and summarise bursts (tumbles) rather
  than narrate every event at speech rate.
- 8-min session / 10-min source cap for the demo.

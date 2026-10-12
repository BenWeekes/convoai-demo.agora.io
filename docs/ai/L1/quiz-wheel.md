# Quiz Wheel demos (voice-driven trivia, two avatar stacks)

A LinkedIn-safe trivia variant of the spinning-wheel demo (points, never cash). The player
says "spin"; the host asks a category question; the player answers out loud; score updates.
Two parallel builds share one game server but differ in the avatar stack:

| URL | Avatar | Profile |
|---|---|---|
| `/avatar-overlay/quiz/` | **LemonSlice** (ConvoAI server-side avatar video over Agora) | `QUIZ_PLAY` |
| `/avatar-overlay/quiz-trl/` | **Trulience** VBA (client-side, manual Agora) | `QUIZ_TRL` (voice-only) |

Both profiles are **gemini-3.8-live** MLLM + Ares ASR and share the **quiz-mcp** game server.

## Game server — quiz-mcp (`web/quiz/mcp`, port :8121)

Source of truth for the wheel + score. Tools: `spin` (lands a segment, applies special-slice
points), `score_answer(correct)` (+100/0 after a category question), `get_score`, `reset_game`.
HTTP: `POST /spin/:ch`, `POST /reveal/:ch`, `GET /state/:ch`, `POST /reset/:ch`. Publishes
`quiz.spin` / `quiz.score` over RTM **and** exposes `/state` for polling clients. `/state` returns
`{ score, lastSpin, lastScore }` — `lastScore {correct, score, ssml, seq}` lets a poll-only client
(quiz-trl) play the right gesture even though a wrong answer adds 0 points (so score alone can't
tell right from wrong). Each message carries an `ssml` field (spin: extra→thumbup, lose→concerned,
category→smile; answer: correct→thumbup, wrong→shrug) that the Trulience client forwards to the avatar.

## LemonSlice build (`avatar-overlay/public/quiz/`)

Our own Agora client joins, subscribes the agent's avatar **video** (uid 102, green bg baked in via
ConvoAI `background_color`), and chroma-keys it with **`public/chroma.js`** (UV-distance shader) onto
the wheel scene. Local camera self-view in a circle (`createCameraVideoTrack`, preview only). Chroma
is URL-tunable: `?sim=&smooth=&spill=&key=` — **defaults sim 0.20 / smooth 0.12 / spill 0.34**
(raise `spill` to kill a green halo). Debug log panel: `?debug`.

## Trulience build (`avatar-overlay/public/quiz-trl/`) — MANUAL Agora integration

Does **NOT** use the Trulience SDK's `agoraAgent` mode (one SDK-owned client did mic + agent-audio
under a 30s `AGENT_AUDIO_TIMEOUT` that tore down BOTH when gemini was slow to greet → intermittent
"no audio AND no mic"). Instead, mirrors `github.com/BenWeekes/agora-trulience-sdk`
(`react/src/hooks/useAgoraRTC.jsx`):

1. `start-agent?connect=false` → our rtc creds (uid 101 + token), no agent yet.
2. Build the avatar with `useAgoraVideo:false` → Trulience renders the VBA from **its own** media
   server (avatar video is NOT on the agent channel); `authenticate()` → on `auth-success` call
   `connectGateway()`.
3. **Our** AgoraRTC client joins (uid 101); on `user-published` from uid 100 →
   `trl.setMediaStream(agentAudio)`; publish **our** mic (`createMicrophoneAudioTrack`).
4. `start-agent?connect=true` LAST — ConvoAI greets on user-join, into our already-subscribed client.

Mic is ours (`micTrack.setMuted` for mute); ConvoAI only greets once a user is in the channel, so
join must precede `connect=true`. No own RTM (it collides with Trulience's on `101-<channel>`) — the
wheel/score is driven by polling `/state`. Local camera self-view circle, same as LemonSlice.

**Chroma = Trulience's OWN VBA keyer**, enabled client-side (avatar `2908248967865453157` =
`sasha-presenter`, which ships no ChromaKey and an olive video backdrop ~`#86A65F`). Injected via
`setAvatarParams({ Scenes:{ default:{ ChromaKey:{ Enable:true, PostProcess:true, Color:'#86A65F',
Similarity, Smoothness, Threshold, Blur } } } })` — deep-merged into the scene config; the engine
(`tru/client/engine/src/vba/effects.ts`) keys it in its own render pass (needs BOTH Enable &&
PostProcess). **Defaults: Color #86A65F, Similarity 0.10, Smoothness 0.1, Blur 2** — Similarity is a
match WIDTH (0.35 keyed the whole video; 0.10 keys just the olive). URL-tunable:
`?key=&sim=&smooth=&thr=&blur=` (`key=off` disables). The SDK sizes its canvas 1280x720, so the page
wraps it in a sized `#avatarbox` (58% height, 1:1, clip) and forces the canvas with `!important`.
Gestures fire from polled `/state` (`lastScore.correct` → thumbup/shrug; spin ssml for
extra/lose/category). Debug log panel: **`?hud`** (NOT `?debug` — that was handed out in tuning URLs).

## Backend (`simple-backend`, private)

`QUIZ_PLAY_*` / `QUIZ_TRL_*` profiles in `.env`. `start-agent?connect=false` = token-only (no agent).
`/hangup-channel?channel=&profile=` stops the ConvoAI agent by channel on Leave (the SDK never does).

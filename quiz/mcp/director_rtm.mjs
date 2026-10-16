// Director RTM consumer — one per session. Joins the agent's channel over RTM and relays the
// IN-SESSION signals to the backend director:
//   - state.speaking  -> POST /director/speaking { speaking }   (turn-taking)
//   - user.transcription (FINAL) -> POST /director/events [{type:message, from:"Moderator",
//       text, priority:"interrupt"}]   (moderator barge-in)
// External inputs (chat, game events) do NOT come here — they hit the director's HTTP URLs.
//
// Env: APP_ID, APP_CERT, CHANNEL, RTM_UID, SESSION, BACKEND, MODERATOR_NAME(optional)
import AgoraRTM from "rtm-nodejs";
import pkg from "agora-token";
const { RtmTokenBuilder } = pkg;

const { APP_ID, APP_CERT, CHANNEL, RTM_UID, SESSION, BACKEND } = process.env;
const mintToken = () => RtmTokenBuilder.buildToken(APP_ID, APP_CERT, RTM_UID, 7200);
const MOD = process.env.MODERATOR_NAME || "Moderator";
const log = (...a) => console.log("[director-rtm]", SESSION, ...a);

const chunks = new Map();
function reassemble(raw) {
  if (typeof raw !== "string") { try { raw = Buffer.from(raw).toString("utf8"); } catch { return null; } }
  const t = raw.trim();
  if (t[0] === "{") { try { return JSON.parse(t); } catch { return null; } }
  const m = t.match(/^([^|]+)\|(\d+)\|(\d+)\|([\s\S]*)$/);
  if (!m) { try { return JSON.parse(t); } catch { return null; } }
  const id = m[1], idx = +m[2], total = +m[3], pay = m[4];
  let r = chunks.get(id); if (!r) { r = { parts: new Array(total), total }; chunks.set(id, r); }
  r.parts[idx] = pay;
  if (r.parts.filter(Boolean).length !== total) return null;
  chunks.delete(id);
  let j = r.parts.join(""); try { j = Buffer.from(j, "base64").toString("utf8"); } catch {}
  try { return JSON.parse(j); } catch { return null; }
}

async function post(path, body) {
  try {
    await fetch(`${BACKEND}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) { log("post err", path, e.message); }
}

const rtm = new AgoraRTM.RTM(APP_ID, String(RTM_UID), { token: mintToken() });
rtm.addEventListener("message", (ev) => {
  const o = reassemble(ev.message); if (!o) return;
  const et = String(o.event_type || o.object || o.type || "");
  // 1) agent speaking state -> turn-taking
  if (/(^|\.)speaking$/i.test(et) && o.payload && typeof o.payload.value === "boolean") {
    post(`/director/speaking?session=${encodeURIComponent(SESSION)}`, { speaking: o.payload.value });
    return;
  }
  // 2) moderator's own speech (final) -> interrupt the host for an immediate reply
  if (/user.*transcription|user\.transcription/i.test(et)) {
    const isFinal = o.turn_status === 1 || o.final === true || o.is_final === true;
    const text = (o.text || o.transcript || "").trim();
    if (isFinal && text) {
      post(`/director/events?session=${encodeURIComponent(SESSION)}`,
        [{ type: "message", from: MOD, text, priority: "interrupt" }]);
    }
  }
});

let loggedIn = false;
async function connect() {
  for (let a = 1; a <= 8; a++) {
    try {
      if (!loggedIn) { await rtm.login(); loggedIn = true; }
      await rtm.subscribe(CHANNEL, { withMessage: true, withPresence: false, withMetadata: false, withLock: false });
      log("subscribed", CHANNEL, "uid", RTM_UID, "(attempt " + a + ")");
      return;
    } catch (e) {
      log("connect attempt", a, "failed:", e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  log("giving up after retries"); process.exit(1);
}
connect();
process.on("SIGTERM", () => { try { rtm.logout(); } catch {} process.exit(0); });
process.on("SIGINT", () => { try { rtm.logout(); } catch {} process.exit(0); });

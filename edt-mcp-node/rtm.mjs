// RTM publisher for EDT scene commands. Maintains one persistent login as a
// scene-bot and publishes channel messages that the luma client receives.
//
// Durability: the RTM token is 24h, so we proactively re-login every 20h, and
// any publish failure (expired token, dropped connection) triggers a re-login
// and one retry. This keeps the service publishing indefinitely without manual
// restarts.
import AgoraRTM from "rtm-nodejs";
import pkg from "agora-token";
const { RtmTokenBuilder } = pkg;

const APP_ID = process.env.EDT_APP_ID;
const APP_CERT = process.env.EDT_APP_CERT;
const BOT_UID = process.env.EDT_BOT_UID || "edt-scene-bot";
const TOKEN_TTL_SEC = 24 * 3600;
const REFRESH_MS = 20 * 60 * 60 * 1000; // re-login well before the 24h expiry

let client = null;
let loginP = null;

function mintToken() {
  return RtmTokenBuilder.buildToken(APP_ID, APP_CERT, BOT_UID, TOKEN_TTL_SEC);
}

async function doLogin() {
  const rtm = new AgoraRTM.RTM(APP_ID, BOT_UID, { token: mintToken() });
  await rtm.login();
  console.log(`[rtm] scene-bot logged in as ${BOT_UID}`);
  return rtm;
}

export async function ensureClient() {
  if (client) return client;
  if (!loginP) {
    loginP = doLogin()
      .then((c) => { client = c; loginP = null; return c; })
      .catch((e) => { loginP = null; throw e; });
  }
  return loginP;
}

async function reset() {
  const old = client;
  client = null;
  loginP = null;
  try { await old?.logout?.(); } catch {}
}

export async function publishScene(channel, payload) {
  const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
  try {
    const rtm = await ensureClient();
    await rtm.publish(channel, msg, { channelType: "MESSAGE" });
    return true;
  } catch (e) {
    console.log(`[rtm] publish failed (${e?.message}); re-logging in and retrying`);
    await reset();
    const rtm = await ensureClient();
    await rtm.publish(channel, msg, { channelType: "MESSAGE" });
    return true;
  }
}

// Proactive token refresh: only if we have an active login, cycle it before the
// 24h token can expire. Keeps the connection valid indefinitely.
setInterval(async () => {
  if (!client) return;
  try {
    await reset();
    await ensureClient();
    console.log("[rtm] proactive re-login (24h token refresh)");
  } catch (e) {
    console.log(`[rtm] re-login error: ${e?.message}`);
  }
}, REFRESH_MS);

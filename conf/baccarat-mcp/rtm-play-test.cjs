// Two-step Baccarat RTM test: talk to the baccarat_play agent like the tru client.
//  1) send a bet -> expect the agent to emit the deal tag and NOT reveal cards yet
//  2) send "[reveal]" -> expect the agent to narrate cards/totals/winner/balance
// Also logs any baccarat.balance object message published on the channel.
//
// Usage: node rtm-play-test.js <appId> <userRtmUid> <token> <channel> <agentRtmUid> "<bet>" [waitSec]
const AgoraRTM = require("rtm-nodejs");
const [, , appId, userRtmUid, token, channel, agentRtmUid, bet, waitArg] = process.argv;
const waitSec = parseInt(waitArg || "14", 10);
const ts = () => new Date().toISOString().slice(11, 23);
const asText = (m) => { try { return typeof m === "string" ? m : Buffer.from(m).toString("utf8"); } catch { return String(m); } };

function send(rtm, text) {
  const payload = JSON.stringify({ priority: "interrupted", interruptable: true, message: text });
  return rtm.publish(agentRtmUid, payload, { channelType: "USER", customType: "user.transcription" });
}
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

(async () => {
  const rtm = new AgoraRTM.RTM(appId, userRtmUid, token ? { token } : {});
  rtm.addEventListener("message", (e) => {
    const t = asText(e.message);
    const tag = t.includes("baccarat.balance") ? "  <== BALANCE" : "";
    console.log(`[recv ${ts()}] from=${e.publisher} custom=${e.customType || ""} :: ${t}${tag}`);
  });
  await rtm.login();
  await rtm.subscribe(channel, { withMessage: true, withPresence: true, withMetadata: false });
  console.log(`[${ts()}] user ${userRtmUid} subscribed to ${channel}`);

  console.log(`\n===== STEP 1: place bet =====\n[send ${ts()}] -> ${bet}`);
  await send(rtm, bet);
  await sleep(waitSec);

  console.log(`\n===== STEP 2: reveal =====\n[send ${ts()}] -> [reveal]`);
  await send(rtm, "[reveal]");
  await sleep(waitSec);

  console.log(`\n[${ts()}] done`);
  process.exit(0);
})().catch((e) => { console.error("ERROR", e?.message || e); process.exit(1); });

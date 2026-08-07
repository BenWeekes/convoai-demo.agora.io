import AgoraRTM from "rtm-nodejs";
import pkg from "agora-token";
import { publishScene } from "./rtm.mjs";
const { RtmTokenBuilder } = pkg;
const APP_ID = process.env.EDT_APP_ID, APP_CERT = process.env.EDT_APP_CERT;
const chan = "rtmtest_" + Math.floor(Date.now() / 1000);

const subTok = RtmTokenBuilder.buildToken(APP_ID, APP_CERT, "viewer1", 3600);
const sub = new AgoraRTM.RTM(APP_ID, "viewer1", { token: subTok });
let got = null;
sub.addEventListener("message", (e) => {
  got = typeof e.message === "string" ? e.message : Buffer.from(e.message).toString();
  console.log(`[sub] RECEIVED on ${e.channelName} from ${e.publisher}: ${got}`);
});
await sub.login();
await sub.subscribe(chan, { withMessage: true });
console.log(`[sub] subscribed to ${chan}`);

await new Promise((r) => setTimeout(r, 800));
await publishScene(chan, { object: "scene.command", command: "VIEW_TOP" });
console.log(`[pub] published scene.command VIEW_TOP to ${chan}`);

await new Promise((r) => setTimeout(r, 2500));
console.log(got ? "RESULT: ✅ subscriber received the channel message" : "RESULT: ❌ nothing received");
process.exit(got ? 0 : 1);

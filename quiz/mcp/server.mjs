// Node MCP server for the voice-avatar Quiz-Wheel demo. Streamable-HTTP MCP at
// /mcp/<channel>; the channel is the per-session key (score) and the RTM target.
// Same pattern as the wheel-mcp, but points-based trivia instead of cash.
//
// Tools:
//   spin()              -> spins the wheel (segment decided server-side), applies any
//                          special-slice points, publishes quiz.spin + quiz.score.
//   score_answer(ok)    -> after the player answers a CATEGORY question, award +100/0.
//   get_score()         -> current points.
//   reset_game()        -> score back to zero.
import express from "express";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs";
import { publish, publishToUser, ensureClient } from "./rtm.mjs";

const require = createRequire(import.meta.url);
const { spinWheel, scoreAnswer, SEGMENTS } = require("./quiz.cjs");

const PORT = process.env.PORT || 8121;
const START_SCORE = Number(process.env.QUIZ_START_SCORE || 0);
// Trulience expression scene/sequence tags (forwarded over RTM; the LemonSlice
// client ignores the `ssml` field, the Trulience client sends it to the avatar).
// single quotes only — double quotes get escaped in transit and break the SSML parser
const SSML = {
  thumbup: "<trl-scene content='thumbup'/>",
  shrug: "<trl-scene content='shrug'/>",
  smile: "<trl-sequence id='smile' level='0.4' duration='3' final='1'/>",
  concerned: "<trl-sequence id='concerned' level='1.0' duration='4' final='1'/>",
};
const AGENT_UID = process.env.QUIZ_AGENT_UID || "100";
const LOG = process.env.QUIZ_LOG || "/home/ubuntu/web/quiz/mcp/calls.log";
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

const sessions = new Map();
function getSession(channel) {
  let s = sessions.get(channel);
  if (!s) { s = { score: START_SCORE }; sessions.set(channel, s); }
  return s;
}

// One spin used by BOTH the MCP tool and the HTTP endpoint. Stores the result so the
// browser can poll /state (fallback), and publishes it over RTM (primary).
function doSpin(channel) {
  const s = getSession(channel);
  const nowMs = Date.now();
  if (s.lastSpinAt && nowMs - s.lastSpinAt < 4000) return { error: "spinning" };
  s.lastSpinAt = nowMs;
  const firstSpin = !s.spun; s.spun = true;
  const r = spinWheel(s, { categoryOnly: firstSpin });
  s.pendingCategory = r.type === "category" ? r.category : null;   // a question is now owed
  const ssml = r.type === "extra" ? SSML.thumbup : r.type === "lose" ? SSML.concerned : SSML.smile;
  const spin = { seg: r.seg, label: r.label, type: r.type, category: r.category,
    delta: r.delta, prevScore: r.prevScore, score: r.score, ssml, seq: nowMs };
  s.lastSpin = spin;
  // Only quiz.spin here (it carries the score, shown when the wheel stops). The
  // score pill is updated at stop / by score_answer — avoids a premature bump.
  publish(channel, { object: "quiz.spin", ...spin }).catch(() => {});
  log(`[${channel}] spin -> seg${r.seg} ${r.label} (${r.type}) score ${r.prevScore} -> ${r.score}`);
  return spin;
}

function buildServer(channel) {
  const server = new McpServer({ name: "quiz-host", version: "1.0.0" });

  server.tool(
    "spin",
    "Spin the quiz wheel for the player. Call this WHENEVER the player asks you to spin "
    + "(e.g. 'spin', 'spin the wheel', 'go', 'again', 'next question'). It decides the "
    + "segment server-side and returns. Do NOT announce where it landed here — you will be "
    + "sent a '[Wheel stopped]' message the moment the wheel stops; act only then.",
    {},
    async () => {
      const out = doSpin(channel);
      if (out.error === "spinning") {
        return { content: [{ type: "text", text: JSON.stringify({ error: "spinning",
          message: "The wheel is still spinning — wait for it to stop." }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({
        status: "spinning",
        instruction: "The wheel is now spinning. Say ONE short upbeat line like 'Round we go, good luck!' "
          + "then stay SILENT. The instant it stops you'll receive a '[Wheel stopped]' message telling you "
          + "the category or special slice - react only then. Never speak before you call the tool.",
      }) }] };
    }
  );

  server.tool(
    "score_answer",
    "Call this AFTER the player has spoken their answer to a CATEGORY quiz question, to "
    + "record whether they were right. Judge generously - accept reasonable, close, or "
    + "partial answers as correct. Pass correct=true if right, false otherwise.",
    { correct: z.boolean().describe("true if the player's answer was correct, false if not") },
    async ({ correct }) => {
      const s = getSession(channel);
      if (!s.pendingCategory) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_pending_question",
          message: "No question is awaiting an answer. Invite the player to spin the wheel." }) }] };
      }
      const cat = s.pendingCategory; s.pendingCategory = null;
      const r = scoreAnswer(s, correct);
      const ssml = r.correct ? SSML.thumbup : SSML.shrug;
      const seq = Date.now();
      // record the outcome so a polling client (quiz-trl, no RTM) can play the right/wrong gesture —
      // a wrong answer awards 0 points, so the score alone doesn't reveal it.
      s.lastScore = { score: r.score, delta: r.delta, correct: r.correct, ssml, seq };
      publish(channel, { object: "quiz.score", score: r.score, delta: r.delta, ssml, seq }).catch(() => {});
      log(`[${channel}] score_answer correct=${correct} +${r.delta} -> ${r.score}`);
      const instruction = r.correct
        ? `Correct! You just awarded ${r.delta} points. Tell them they nailed it and call out their new score of ${r.score}, then invite another spin - one or two lively sentences.`
        : `Not quite. No points this time. Kindly tell them the right answer, mention their score is still ${r.score}, and encourage them to spin again - one or two warm sentences.`;
      return { content: [{ type: "text", text: JSON.stringify({ correct: r.correct, awarded: r.delta, score: r.score, category: cat, instruction }) }] };
    }
  );

  server.tool(
    "get_score",
    "Return the player's current points. Use when they ask how many points they have.",
    {},
    async () => {
      const s = getSession(channel);
      return { content: [{ type: "text", text: JSON.stringify({ score: s.score }) }] };
    }
  );

  server.tool(
    "reset_game",
    "Start fresh: score back to zero.",
    {},
    async () => {
      const s = getSession(channel);
      s.score = START_SCORE; s.spun = false; s.pendingCategory = null; s.lastSpin = null; s.lastScore = null;
      try { await publish(channel, { object: "quiz.score", score: s.score, delta: 0, reset: true }); } catch {}
      log(`[${channel}] reset_game -> score ${s.score}`);
      return { content: [{ type: "text", text: JSON.stringify({ score: s.score, reset: true }) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());
const transports = {};

app.get("/health", (_req, res) => res.json({ ok: true, segments: SEGMENTS }));

app.post("/spin/:channel", (req, res) => res.json(doSpin(req.params.channel)));
app.post("/reset/:channel", async (req, res) => {
  const s = getSession(req.params.channel); s.score = START_SCORE; s.spun = false; s.pendingCategory = null; s.lastSpin = null; s.lastScore = null;
  try { await publish(req.params.channel, { object: "quiz.score", score: s.score, delta: 0, reset: true }); } catch {}
  res.json({ score: s.score, reset: true });
});
app.get("/state/:channel", (req, res) => {
  const s = getSession(req.params.channel);
  res.json({ score: s.score, lastSpin: s.lastSpin || null, lastScore: s.lastScore || null });
});

// Called by the page the MOMENT the wheel stops. Sends the result to the agent over RTM
// so it narrates/asks then, timed to the stop.
app.post("/reveal/:channel", async (req, res) => {
  const channel = req.params.channel;
  const sp = getSession(channel).lastSpin;
  if (!sp) return res.json({ ok: false, reason: "no spin" });
  if (sp.revealed) return res.json({ ok: true, already: true });
  let msg;
  if (sp.type === "category")
    msg = `[Wheel stopped] The category is ${sp.category}! Ask the player ONE clear, fun, single-answer quiz question in ${sp.category} now, then wait for their spoken answer. Do NOT reveal the answer or call any tool yet.`;
  else if (sp.type === "extra")
    msg = `[Wheel stopped] EXTRA POINTS! The player wins ${sp.delta} bonus points - new score ${sp.score}. Celebrate in one energetic sentence, call out the new score, and invite them to spin again.`;
  else
    msg = `[Wheel stopped] LOSE POINTS - ${Math.abs(sp.delta)} points docked, new score ${sp.score}. Commiserate lightly in one sentence and tell them to spin again to win it back.`;
  try {
    await publishToUser(`${AGENT_UID}-${channel}`, { priority: "interrupted", interruptable: true, message: msg });
  } catch (e) {
    log(`[${channel}] reveal publish ERROR: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
  sp.revealed = true;
  log(`[${channel}] reveal -> agent (${sp.label})`);
  res.json({ ok: true });
});

async function handlePost(req, res) {
  const channel = req.params.channel || "unknown";
  const sid = req.headers["mcp-session-id"];
  let transport;
  if (sid && transports[sid]) {
    transport = transports[sid];
  } else if (!sid && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports[id] = transport; log(`[${channel}] session ${id} initialized`); },
    });
    transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
    await buildServer(channel).connect(transport);
  } else {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session" }, id: null });
    return;
  }
  await transport.handleRequest(req, res, req.body);
}
async function handleSession(req, res) {
  const sid = req.headers["mcp-session-id"];
  if (!sid || !transports[sid]) { res.status(400).send("Invalid session"); return; }
  await transports[sid].handleRequest(req, res);
}

app.post("/mcp/:channel", handlePost);
app.get("/mcp/:channel", handleSession);
app.delete("/mcp/:channel", handleSession);
app.post("/mcp", (req, res) => { req.params.channel = "unknown"; handlePost(req, res); });

app.listen(PORT, "127.0.0.1", () => log(`quiz-mcp listening on ${PORT}`));
ensureClient().then(() => log("rtm warmed")).catch((e) => log(`rtm warm failed: ${e.message}`));

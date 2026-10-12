// Node MCP server for the voice-avatar Wheel-of-Fortune demo. Streamable-HTTP MCP at
// /mcp/<channel>; the channel is the per-session key (balance) and the RTM target.
// Same pattern as the slot-mcp. The whole balance rides each spin ("let it ride").
//
// Tools:
//   spin()        -> spins the wheel (outcome decided server-side), applies it to the
//                    balance, publishes wheel.spin + wheel.balance over RTM.
//   get_balance() -> current balance.
//   reset_game()  -> balance back to the starting stake.
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
const { spinWheel, SEGMENTS } = require("./wheel.cjs");

const PORT = process.env.PORT || 8120;
const START_BALANCE = Number(process.env.WHEEL_START_BALANCE || 100);
const STAKE = Number(process.env.WHEEL_STAKE || 10);          // default bet
const CURRENCY = process.env.WHEEL_CURRENCY || "USD";
const AGENT_UID = process.env.WHEEL_AGENT_UID || "100";
const LOG = process.env.WHEEL_LOG || "/home/ubuntu/web/wheel/mcp/calls.log";
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

const sessions = new Map();
function getSession(channel) {
  let s = sessions.get(channel);
  if (!s) { s = { balance: START_BALANCE }; sessions.set(channel, s); }
  return s;
}

// Single spin used by BOTH the MCP tool and the HTTP endpoint. Stores the result so
// the browser can poll /state (fallback), and publishes it over RTM (primary).
function doSpin(channel, bet) {
  const s = getSession(channel);
  if (s.balance < 1) return { error: "insufficient_balance", balance: s.balance, currency: CURRENCY };
  // Default $10 bet, or the amount the player named — capped to the balance.
  let stake = bet && bet > 0 ? Math.round(bet) : STAKE;
  stake = Math.max(1, Math.min(stake, s.balance));
  const nowMs = Date.now();
  if (s.lastSpinAt && nowMs - s.lastSpinAt < 4000) return { error: "spinning" };
  s.lastSpinAt = nowMs;
  const firstSpin = !s.spun; s.spun = true;
  const r = spinWheel(s, { bet: stake, firstSpin });
  const spin = { seg: r.seg, label: r.label, effect: r.effect, mult: r.mult, bet: r.bet,
    payout: r.payout, net: r.net, prevBalance: r.prevBalance, balance: r.balance, currency: CURRENCY, seq: nowMs };
  s.lastSpin = spin;
  publish(channel, { object: "wheel.spin", ...spin }).catch(() => {});
  publish(channel, { object: "wheel.balance", balance: r.balance, currency: CURRENCY, seq: nowMs }).catch(() => {});
  log(`[${channel}] wheel bet$${r.bet} -> seg${r.seg} ${r.label} net${r.net} (${r.prevBalance} -> ${r.balance})`);
  return { seg: r.seg, label: r.label, effect: r.effect, mult: r.mult, bet: r.bet,
    payout: r.payout, net: r.net, prevBalance: r.prevBalance, balance: r.balance, currency: CURRENCY };
}

function buildServer(channel) {
  const server = new McpServer({ name: "wheel-dealer", version: "1.0.0" });

  server.tool(
    "spin",
    "Spin the fortune wheel for the player. Call this WHENEVER the player asks you to spin "
    + "(e.g. 'spin', 'spin the wheel', 'go', 'again'). Each spin stakes a bet (default $10, or "
    + "the amount the player names, up to their balance). It decides the segment and returns. "
    + "Do NOT announce the result here — you will be sent a '[Wheel stopped]' message the moment "
    + "the wheel stops; narrate it only then.",
    { bet_amount: z.number().positive().optional().describe(`Stake in ${CURRENCY}; defaults to ${STAKE} if the player didn't name one.`) },
    async ({ bet_amount }) => {
      const out = doSpin(channel, bet_amount);
      if (out.error === "insufficient_balance") {
        out.message = `The player is out of money (balance ${out.balance} ${CURRENCY}). Warmly thank them for playing and tell them to come back soon. Do NOT offer to reset, spin again or lend money - just a friendly goodbye.`;
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      }
      if (out.error === "spinning") {
        out.message = "The wheel is still spinning — wait for it to stop.";
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      }
      // Success: the wheel is turning. Don't give the result to the LLM yet.
      return { content: [{ type: "text", text: JSON.stringify({
        status: "spinning",
        bet: out.bet,
        instruction: `The wheel is now spinning with the player's $${out.bet} bet on it. Say ONE short line that NAMES the bet - e.g. '$${out.bet} on the wheel, here we go!' or 'Round and round goes your $${out.bet}!' - then stay SILENT. The result will be sent to you the moment the wheel stops; do not announce where it landed until you receive it.`,
      }) }] };
    }
  );

  server.tool(
    "get_balance",
    "Return the player's current balance. Use when they ask how much they have.",
    {},
    async () => {
      const s = getSession(channel);
      return { content: [{ type: "text", text: JSON.stringify({ balance: s.balance, currency: CURRENCY }) }] };
    }
  );

  server.tool(
    "reset_game",
    "Start fresh: balance back to the starting stake.",
    {},
    async () => {
      const s = getSession(channel);
      s.balance = START_BALANCE; s.spun = false; s.lastSpin = null;
      try { await publish(channel, { object: "wheel.balance", balance: s.balance, currency: CURRENCY, reset: true }); } catch {}
      log(`[${channel}] reset_game -> balance ${s.balance}`);
      return { content: [{ type: "text", text: JSON.stringify({ balance: s.balance, currency: CURRENCY, reset: true }) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());
const transports = {};

app.get("/health", (_req, res) => res.json({ ok: true, segments: SEGMENTS }));

app.post("/spin/:channel", (req, res) => res.json(doSpin(req.params.channel, Number(req.body?.bet_amount))));
app.post("/reset/:channel", async (req, res) => {
  const s = getSession(req.params.channel); s.balance = START_BALANCE; s.spun = false; s.lastSpin = null;
  try { await publish(req.params.channel, { object: "wheel.balance", balance: s.balance, currency: CURRENCY, reset: true }); } catch {}
  res.json({ balance: s.balance, currency: CURRENCY, reset: true });
});
app.get("/state/:channel", (req, res) => {
  const s = getSession(req.params.channel);
  res.json({ balance: s.balance, currency: CURRENCY, lastSpin: s.lastSpin || null });
});

// Called by the page the MOMENT the wheel stops. Sends the result to the agent over RTM
// so it narrates then, timed to the stop.
app.post("/reveal/:channel", async (req, res) => {
  const channel = req.params.channel;
  const sp = getSession(channel).lastSpin;
  if (!sp) return res.json({ ok: false, reason: "no spin" });
  if (sp.revealed) return res.json({ ok: true, already: true });
  const broke = sp.balance < 1;
  let msg;
  if (sp.effect === "mult")
    msg = `[Wheel stopped] It landed on ${sp.mult}x! The $${sp.bet} bet pays $${sp.payout} - balance now $${sp.balance}. Celebrate and call out the new balance, one lively sentence.`;
  else if (sp.effect === "lose_all")
    msg = broke
      ? `[Wheel stopped] It landed on LOSE ALL and that was the player's last money - balance is now $0. Commiserate warmly, then thank them for playing and tell them to come back soon. Do NOT offer a re-spin or reset.`
      : `[Wheel stopped] It landed on LOSE ALL - the player lost their $${sp.bet} bet, balance now $${sp.balance}. Commiserate briefly and encourage another spin, one short sentence.`;
  else
    msg = `[Wheel stopped] It landed on NEW GAME - the balance resets to $${sp.balance} for a fresh start. React with a surprised, upbeat line, one sentence.`;
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

app.listen(PORT, "127.0.0.1", () => log(`wheel-mcp listening on ${PORT}`));
ensureClient().then(() => log("rtm warmed")).catch((e) => log(`rtm warm failed: ${e.message}`));

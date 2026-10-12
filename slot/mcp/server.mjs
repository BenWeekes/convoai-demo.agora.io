// Node MCP server for the voice-avatar slot-machine demo. Streamable-HTTP MCP
// endpoint at /mcp/<channel>; the channel is captured from the path (Agora appends
// it via append_user_id) and is used both as the per-session key (balance) and as
// the RTM target for spin/balance updates. Modeled on the Baccarat dealer MCP.
//
// Tools:
//   spin(bet_amount?) -> spins the reels (outcome decided server-side), settles the
//     bet, updates the channel balance, publishes slot.spin + slot.balance over RTM,
//     and returns the ground-truth outcome for the avatar to narrate.
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
const { playSpin } = require("./slot.cjs");

const PORT = process.env.PORT || 8119;
const START_BALANCE = Number(process.env.SLOT_START_BALANCE || 100);
const STAKE = Number(process.env.SLOT_STAKE || 10);
const MIN_BET = Number(process.env.SLOT_MIN_BET || 1);
const MAX_BET = Number(process.env.SLOT_MAX_BET || 50);
const CURRENCY = process.env.SLOT_CURRENCY || "USD";
// Agent RTM uid = `${AGENT_UID}-${channel}` — where we send the "reels stopped,
// narrate the result" cue once the page's animation finishes.
const AGENT_UID = process.env.SLOT_AGENT_UID || "100";
const LOG = process.env.SLOT_LOG || "/home/ubuntu/web/slot/mcp/calls.log";
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

// Per-channel session state: { balance }. Created lazily on first use.
const sessions = new Map();
function getSession(channel) {
  let s = sessions.get(channel);
  if (!s) { s = { balance: START_BALANCE }; sessions.set(channel, s); }
  return s;
}

function buildServer(channel) {
  const server = new McpServer({ name: "slot-dealer", version: "1.0.0" });

  server.tool(
    "spin",
    "Spin the slot machine for the player. Call this WHENEVER the player asks you to "
    + "spin (e.g. 'spin', 'spin for me', 'go', 'again'). It deducts the stake, decides "
    + "the reels, settles the bet and updates the balance. It returns the true outcome. "
    + "HOW TO NARRATE: first say a short excited line like 'Here we go, spinning now!' "
    + "(the reels take a few seconds), THEN announce the result from the returned JSON — "
    + "if win is true, call out the winning symbols and the amount won; if false, "
    + "commiserate briefly. Always tell them their new balance. Keep it to one or two "
    + "lively sentences.",
    {
      bet_amount: z.number().positive().optional()
        .describe(`Stake in ${CURRENCY} for this spin. Defaults to ${STAKE} if the player didn't name one.`),
    },
    async ({ bet_amount }) => {
      const out = doSpin(channel, bet_amount);
      if (out.error === "insufficient_balance") {
        out.message = `The player is out of money (balance ${out.balance} ${CURRENCY}). Warmly thank them for playing and tell them to come back soon. Do NOT offer to reset, spin again or lend money - just a friendly goodbye.`;
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      }
      if (out.error === "spinning") {
        out.message = "The reels are still spinning — wait for them to stop.";
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      }
      // Success: reels are now turning on the player's screen. Do NOT hand the result
      // to the LLM yet — it is sent as a cue the instant the reels stop, so the host
      // can't reveal early or talk over itself.
      return { content: [{ type: "text", text: JSON.stringify({
        status: "spinning",
        stake: out.stake,
        currency: out.currency,
        instruction: `The reels are now turning. Say ONE short line that NAMES THE STAKE of ${out.stake} dollars - e.g. 'Spinning for ${out.stake} dollars!' or 'Here we go, ${out.stake} on the line!' (if it's their whole balance, call it 'all in!'). Then stay SILENT. The result will be sent to you the moment the reels stop; do not announce any symbols, win, loss or balance until you receive it.`,
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
      s.balance = START_BALANCE; s.spun = false;
      try { await publish(channel, { object: "slot.balance", balance: s.balance, currency: CURRENCY, delta: 0, reset: true }); } catch {}
      log(`[${channel}] reset_game -> balance ${s.balance}`);
      return { content: [{ type: "text", text: JSON.stringify({ balance: s.balance, currency: CURRENCY, reset: true }) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());
const transports = {};

app.get("/health", (_req, res) => res.json({ ok: true }));

// Direct HTTP spin/reset — same logic + RTM publish as the MCP tools, but callable
// without the LLM. Powers the machine's manual Spin button and end-to-end testing.
// Single spin implementation used by BOTH the MCP tool and the HTTP endpoint.
// Stores the result on the session so the browser can poll /state for it (the
// client's transport is polling, not RTM — simpler for a static page). RTM is
// still published for any future RTM-based client.
function doSpin(channel, bet) {
  const s = getSession(channel);
  if (s.balance < MIN_BET) return { error: "insufficient_balance", balance: s.balance, currency: CURRENCY };
  // Fixed stake (SLOT_STAKE, default 10) unless the player named a bet amount.
  // Honor the named bet, capped only to the available balance (so a big bet the
  // player explicitly asked for goes through; it can't exceed what they have).
  let stake = bet && bet > 0 ? Math.round(bet) : STAKE;
  stake = Math.max(MIN_BET, Math.min(stake, s.balance));
  const nowMs = Date.now();
  if (s.lastSpinAt && nowMs - s.lastSpinAt < 3500) return { error: "spinning" };
  s.lastSpinAt = nowMs;
  const forceWin = !s.spun;   // first spin of a session always wins (good onboarding)
  s.spun = true;
  const r = playSpin(s, { stake, forceWin });
  const spin = { reels: r.reels, payline: r.payline, win: r.win, payout: r.payout,
    stake: r.stake, net: r.net, symbol: r.symbol, count: r.count, balance: r.balance,
    currency: CURRENCY, seq: nowMs };
  s.lastSpin = spin;
  publish(channel, { object: "slot.spin", reels: r.reels, payline: r.payline,
    win: r.win, payout: r.payout, net: r.net, stake: r.stake, symbol: r.symbol,
    count: r.count, balance: r.balance, currency: CURRENCY, seq: nowMs }).catch(() => {});
  publish(channel, { object: "slot.balance", balance: r.balance, currency: CURRENCY, delta: r.net,
    win: r.win, payout: r.payout, stake: r.stake, symbol: r.symbol, count: r.count, seq: nowMs }).catch(() => {});
  log(`[${channel}] spin(${stake}) -> ${r.win ? `WIN ${r.count}x ${r.symbol} +${r.payout}` : "loss"} bal=${r.balance}`);
  return { win: r.win, symbol: r.symbol, count: r.count, payline: r.payline, stake: r.stake,
    payout: r.payout, net: r.net, balance: r.balance, currency: CURRENCY };
}
app.post("/spin/:channel", (req, res) => res.json(doSpin(req.params.channel, Number(req.body?.bet_amount))));
app.post("/reset/:channel", async (req, res) => {
  const s = getSession(req.params.channel); s.balance = START_BALANCE; s.lastSpin = null; s.spun = false;
  try { await publish(req.params.channel, { object: "slot.balance", balance: s.balance, currency: CURRENCY, delta: 0, reset: true }); } catch {}
  res.json({ balance: s.balance, currency: CURRENCY, reset: true });
});
// Browser polls this: current balance + the most recent spin (client animates
// when `lastSpin.seq` changes).
app.get("/state/:channel", (req, res) => {
  const s = getSession(req.params.channel);
  res.json({ balance: s.balance, currency: CURRENCY, lastSpin: s.lastSpin || null });
});

// Called by the page the MOMENT the reels stop. Sends the stored result to the agent
// over RTM (point-to-point user-transcription cue) so it narrates the outcome then,
// as one clean utterance timed to the stop.
app.post("/reveal/:channel", async (req, res) => {
  const channel = req.params.channel;
  const sp = getSession(channel).lastSpin;
  if (!sp) return res.json({ ok: false, reason: "no spin" });
  if (sp.revealed) return res.json({ ok: true, already: true });
  const symName = sp.symbol === "big_win" ? "BIG WIN symbols"
    : sp.symbol === "lucky_seven" ? "lucky sevens" : `${sp.symbol}s`;
  const broke = sp.balance < MIN_BET;
  const msg = sp.win
    ? `[Reels stopped] WIN — ${sp.count} ${symName} on the line, pays $${sp.payout}. New balance $${sp.balance}. React and announce it to the player now, one short lively sentence.`
    : broke
      ? `[Reels stopped] No win - and that was the player's last money, they're now out (balance $0). Commiserate warmly, then thank them for playing and tell them to come back soon. Do NOT encourage another spin and do NOT offer to reset.`
      : `[Reels stopped] No win this time (staked $${sp.stake}). New balance $${sp.balance}. Commiserate briefly and encourage another spin, one short sentence.`;
  try {
    await publishToUser(`${AGENT_UID}-${channel}`, { priority: "interrupted", interruptable: true, message: msg });
  } catch (e) {
    log(`[${channel}] reveal publish ERROR: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
  sp.revealed = true;
  log(`[${channel}] reveal -> agent (${sp.win ? "WIN" : "loss"})`);
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

app.listen(PORT, "127.0.0.1", () => log(`slot-mcp listening on ${PORT}`));

// Warm the RTM login on boot so the first spin's publish isn't delayed by login.
ensureClient().then(() => log("rtm warmed")).catch((e) => log(`rtm warm failed: ${e.message}`));

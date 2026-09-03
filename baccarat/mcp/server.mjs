// Node MCP server for the Baccarat dealer game. Streamable-HTTP MCP endpoint at
// /mcp/<channel>; the channel is captured from the path (Agora appends it via
// append_user_id) and is used both as the per-session key (balance + shoe) and as
// the RTM target for balance updates. Modeled on edt-mcp-node.
//
// Tools:
//   deal_hand(bet_side, bet_amount) -> deals a round (always-6), settles the bet,
//     updates the channel balance, publishes baccarat.balance over RTM, and returns
//     the ground-truth outcome + the avatar deal tag. The AGENT must emit the deal
//     tag, then WAIT for a "[reveal]" nudge before narrating the cards/result.
//   get_balance() -> current balance.
//   reset_game() -> new shoe + balance back to the starting stake.
import express from "express";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs";
import { publish, ensureClient } from "./rtm.mjs";

const require = createRequire(import.meta.url);
const { playRound, freshShoe } = require("./play_round.cjs");

const PORT = process.env.PORT || 8117;
const START_BALANCE = Number(process.env.BACCARAT_START_BALANCE || 100);
const MIN_BET = Number(process.env.BACCARAT_MIN_BET || 1);
const CURRENCY = process.env.BACCARAT_CURRENCY || "USD";
const LOG = "/home/ubuntu/baccarat-mcp/calls.log";
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

// Per-channel session state: { balance, shoe }. Created lazily on first use.
const sessions = new Map();
function getSession(channel) {
  let s = sessions.get(channel);
  if (!s) { s = { balance: START_BALANCE, shoe: freshShoe() }; sessions.set(channel, s); }
  return s;
}

function buildServer(channel) {
  const server = new McpServer({ name: "baccarat-dealer", version: "1.0.0" });

  server.tool(
    "deal_hand",
    "Deal one round of Baccarat. Call this AFTER the player has named a bet side and a "
    + "valid stake. It deals the cards, decides the winner, settles the bet and updates "
    + "the balance. It returns the deal tag to display and the true result. IMPORTANT: "
    + "emit the returned deal_tag verbatim, then WAIT for a '[reveal]' message before you "
    + "say any card values or who won — the cards are not face-up until then.",
    {
      bet_side: z.string().describe("Which hand the player bet on: player, banker, or tie (case-insensitive)."),
      bet_amount: z.number().positive().describe(`Stake in ${CURRENCY}. Min ${MIN_BET}, cannot exceed balance.`),
    },
    async ({ bet_side, bet_amount }) => {
      const s = getSession(channel);
      // Normalize the side: grok sometimes sends "Banker"/"PLAYER"/"p" etc.
      const SIDES = { player: "player", banker: "banker", tie: "tie", p: "player", b: "banker", t: "tie" };
      const side = SIDES[String(bet_side || "").trim().toLowerCase()];
      if (!side)
        return { content: [{ type: "text", text: `Invalid bet side "${bet_side}". The player must bet on Player, Banker or Tie.` }] };
      bet_side = side;
      const amount = Math.round(bet_amount);
      if (amount < MIN_BET)
        return { content: [{ type: "text", text: `Minimum bet is ${MIN_BET} ${CURRENCY}. Ask the player for a larger stake.` }] };
      if (amount > s.balance)
        return { content: [{ type: "text", text: `Bet ${amount} exceeds the balance of ${s.balance} ${CURRENCY}. Ask for a smaller stake.` }] };

      // Guard against a rapid re-deal loop: one hand takes ~20s to play out, so
      // ignore a second deal_hand within a few seconds for the same channel.
      const nowMs = Date.now();
      if (s.lastDealAt && nowMs - s.lastDealAt < 6000) {
        log(`[${channel}] deal_hand ignored (re-deal ${nowMs - s.lastDealAt}ms after last)`);
        return { content: [{ type: "text", text: "A hand is already being dealt — wait for it to finish before dealing again." }] };
      }
      s.lastDealAt = nowMs;

      const r = playRound(s, { side: bet_side, amount });  // always-6 by default
      const dealTag = `{<trl-scene content="deal" param="${r.cards}"/>}`;
      const result = {
        deal_tag: dealTag,
        param: r.cards,
        player_cards: r.player, player_total: r.playerTotal,   // Player = LEFT
        banker_cards: r.banker, banker_total: r.bankerTotal,   // Banker = RIGHT
        winner: r.winner,
        bet_side, bet_amount: amount,
        user_won: r.userWon, net: r.net,
        balance: r.balance, currency: CURRENCY,
      };

      // Tell the client to PLAY the deal clip directly (deterministic — no longer
      // relies on the LLM echoing the scene tag) and push the new balance. FIRE-AND-
      // FORGET: don't block the tool return on RTM, so the agent can speak sooner.
      publish(channel, { object: "baccarat.deal", param: r.cards, seq: nowMs })
        .catch((e) => log(`[${channel}] deal publish ERROR: ${e.message}`));
      publish(channel, {
        object: "baccarat.balance",
        balance: r.balance, currency: CURRENCY,
        delta: r.net, bet_side, bet_amount: amount,
        winner: r.winner, user_won: r.userWon,
      }).catch((e) => log(`[${channel}] balance publish ERROR: ${e.message}`));

      log(`[${channel}] deal_hand(${bet_side},${amount}) -> P${r.playerTotal} B${r.bankerTotal} `
        + `win=${r.winner} net=${r.net} bal=${r.balance} param="${r.cards}"`);

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "get_balance",
    "Return the player's current Baccarat balance. Use when they ask how much they have.",
    {},
    async () => {
      const s = getSession(channel);
      return { content: [{ type: "text", text: JSON.stringify({ balance: s.balance, currency: CURRENCY }) }] };
    }
  );

  server.tool(
    "reset_game",
    "Start a fresh game: new shuffled shoe and balance back to the starting stake.",
    {},
    async () => {
      const s = getSession(channel);
      s.balance = START_BALANCE; s.shoe = freshShoe();
      try { await publish(channel, { object: "baccarat.balance", balance: s.balance, currency: CURRENCY, delta: 0, reset: true }); } catch {}
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

// Client diagnostics beacon — the web client POSTs reveal/content-changed events
// here so they can be read server-side (the browser console is too noisy to paste).
const CLIENTLOG = "/home/ubuntu/baccarat-mcp/client.log";
app.post("/clientlog", (req, res) => {
  try {
    const line = `${new Date().toISOString()}  ${JSON.stringify(req.body).slice(0, 800)}`;
    fs.appendFileSync(CLIENTLOG, line + "\n");
  } catch {}
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
// also accept without channel (defensive)
app.post("/mcp", (req, res) => { req.params.channel = "unknown"; handlePost(req, res); });

app.listen(PORT, "127.0.0.1", () => log(`baccarat-mcp listening on ${PORT}`));

// Warm the RTM login on boot so the first deal's publish isn't delayed by login.
ensureClient().then(() => log("rtm warmed")).catch((e) => log(`rtm warm failed: ${e.message}`));

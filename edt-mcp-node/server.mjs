// Node MCP server for EDT scene control. Streamable-HTTP MCP endpoint at
// /mcp/<channel>; the channel is captured from the path (Agora appends it via
// append_user_id). set_scene publishes an RTM scene_command to that channel so
// the luma client moves the 3D view — no spoken tags, no chat proxy.
import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs";
import { publishScene } from "./rtm.mjs";

const PORT = process.env.PORT || 8114;
const LOG = "/home/ubuntu/web/edt-mcp-node/calls.log";
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

const VIEW_MAP = {
  front: "VIEW_FRONT", front_iso: "VIEW_FRONT_ISO", top: "VIEW_TOP",
  side: "VIEW_SIDE", back: "VIEW_BACK", bottom: "VIEW_BOTTOM", exploded: "VIEW_EXPLODED",
};
function toCommands({ view, zoom, spin }) {
  const cmds = [];
  if (view && VIEW_MAP[view]) cmds.push(VIEW_MAP[view]);
  if (zoom === "in") cmds.push("ZOOM_IN");
  if (zoom === "out") cmds.push("ZOOM_OUT");
  if (spin === true) cmds.push("SPIN");
  if (spin === false) cmds.push("STOP");
  return cmds;
}

function buildServer(channel) {
  const server = new McpServer({ name: "edt-scene", version: "1.0.0" });
  server.tool(
    "set_scene",
    "Control the on-screen 3D view of the EDT Luma air fryer. Call whenever a visual angle helps; never mention the tool aloud.",
    {
      view: z.enum(["front", "front_iso", "top", "side", "back", "bottom", "exploded"]).optional(),
      zoom: z.enum(["in", "out"]).optional(),
      spin: z.boolean().optional(),
    },
    async ({ view, zoom, spin }) => {
      const cmds = toCommands({ view, zoom, spin });
      let published = 0;
      for (const c of cmds) {
        try { await publishScene(channel, { object: "scene.command", command: c }); published++; }
        catch (e) { log(`[${channel}] publish ERROR ${c}: ${e.message}`); }
      }
      log(`[${channel}] set_scene(view=${view||""} zoom=${zoom||""} spin=${spin}) -> ${cmds.join(",")||"none"} (published ${published})`);
      return { content: [{ type: "text", text: "Scene updated: " + (cmds.join(", ") || "no change") + "." }] };
    }
  );
  return server;
}

const app = express();
app.use(express.json());
const transports = {};

app.get("/health", (_req, res) => res.json({ ok: true }));

async function handlePost(req, res) {
  const channel = req.params.channel;
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

app.listen(PORT, "127.0.0.1", () => log(`edt-mcp-node listening on ${PORT}`));

// Transparent logging proxy in front of grok (xAI), for debugging the Baccarat
// agent. ConvoAI -> this proxy -> https://api.x.ai/v1/chat/completions. It forwards
// the request verbatim (streaming included) and logs BOTH sides: the latest turn's
// messages + tool results the model saw, and the assistant text (with Trulience
// tags) + any tool calls the model produced. MCP is unaffected (ConvoAI still
// executes tools); this only sits on the LLM leg.
import express from "express";
import fs from "fs";

const PORT = process.env.PORT || 8118;
const UPSTREAM = process.env.LLM_UPSTREAM || "https://api.x.ai/v1/chat/completions";
const FALLBACK_KEY = process.env.XAI_API_KEY || "";
const LOG = "/home/ubuntu/baccarat-mcp/llm.log";

function log(s) {
  const line = `${new Date().toISOString()}  ${s}`;
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}
const trunc = (s, n = 300) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + `…(${s.length})` : s; };

function logRequest(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const tools = (body?.tools || []).map((t) => t?.function?.name).filter(Boolean);
  log(`>>> REQUEST model=${body?.model} stream=${!!body?.stream} msgs=${msgs.length} tools=[${tools.join(",")}]`);
  // TEMP: discover how ConvoAI passes the channel/context so the proxy can correlate rounds.
  const nonMsg = Object.keys(body).filter((k) => k !== "messages" && k !== "tools");
  log(`    [body keys] ${nonMsg.map((k) => `${k}=${JSON.stringify(body[k]).slice(0, 40)}`).join("  ")}`);
  // Log the tail of the conversation (skip the giant system prompt body).
  const tail = msgs.slice(-6);
  for (const m of tail) {
    if (m.role === "system") { log(`    [system] ${trunc(m.content, 60)}`); continue; }
    if (m.role === "tool") { log(`    [tool_result${m.name ? " " + m.name : ""}] ${trunc(m.content, 400)}`); continue; }
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) log(`    [assistant->tool_call ${tc.function?.name}] ${trunc(tc.function?.arguments, 200)}`);
      if (m.content) log(`    [assistant] ${trunc(m.content)}`);
      continue;
    }
    log(`    [${m.role}] ${trunc(m.content)}`);
  }
}

// Reconstruct assistant output from a streamed SSE body (OpenAI delta format).
function logStreamedResponse(raw) {
  let content = "";
  const toolCalls = {}; // index -> {name, args}
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const d = j?.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) content += d.content;
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? 0;
      toolCalls[i] = toolCalls[i] || { name: "", args: "" };
      if (tc.function?.name) toolCalls[i].name = tc.function.name;
      if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
    }
  }
  if (content) log(`<<< assistant TEXT: ${trunc(content, 800)}`);
  for (const i of Object.keys(toolCalls)) log(`<<< assistant TOOL_CALL ${toolCalls[i].name}(${trunc(toolCalls[i].args, 200)})`);
  if (!content && !Object.keys(toolCalls).length) log(`<<< (no content/tool_calls parsed; raw ${raw.length}b)`);
}

const app = express();
app.use(express.json({ limit: "5mb" }));
app.get("/health", (_q, r) => r.json({ ok: true }));

app.post(/.*/, async (req, res) => {
  const body = req.body || {};
  try {
    const hk = ["x-agora-channel", "x-channel", "x-agent-id", "channel"].filter((h) => req.headers[h]);
    if (hk.length) log(`    [headers] ${hk.map((h) => `${h}=${req.headers[h]}`).join("  ")}`);
  } catch {}
  try { logRequest(body); } catch (e) { log(`req-log err ${e.message}`); }

  const auth = req.headers["authorization"] || (FALLBACK_KEY ? `Bearer ${FALLBACK_KEY}` : "");
  let up;
  try {
    up = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: auth },
      body: JSON.stringify(body),
    });
  } catch (e) { log(`UPSTREAM fetch error: ${e.message}`); res.status(502).json({ error: "upstream fetch failed" }); return; }

  res.status(up.status);
  const ct = up.headers.get("content-type") || "application/json";
  res.setHeader("Content-Type", ct);

  if (!up.body) { const txt = await up.text(); log(`<<< non-stream body ${trunc(txt, 800)}`); res.send(txt); return; }

  // Stream pass-through + tee for logging.
  const reader = up.body.getReader();
  const dec = new TextDecoder();
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      raw += chunk;
      res.write(chunk);
    }
  } catch (e) { log(`stream error: ${e.message}`); }
  res.end();
  try {
    if (ct.includes("event-stream")) logStreamedResponse(raw);
    else log(`<<< resp ${trunc(raw, 800)}`);
  } catch (e) { log(`resp-log err ${e.message}`); }
});

app.listen(PORT, "127.0.0.1", () => log(`llm-proxy listening on ${PORT} -> ${UPSTREAM}`));

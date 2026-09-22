"""
EDT custom-LLM tool service — OpenAI-compatible /chat/completions proxy that
injects a `set_scene` function tool and executes it IN-PROCESS (no Agora MCP
round-trip). Used to benchmark custom-LLM tool-call latency vs MCP.

Routes upstream by request model prefix:
  gpt*   -> OpenAI     (https://api.openai.com/v1)
  grok*  -> xAI        (https://api.x.ai/v1)
  gemini*-> Gemini     (OpenAI-compat endpoint)

Logs every set_scene invocation with a UTC timestamp to calls.log (same format
as the MCP server's log) so both paths are measured identically.

Run: uvicorn server:app --host 127.0.0.1 --port 8112
"""
import os, json, time, datetime, asyncio
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

LOG = "/home/ubuntu/web/edt-tool/calls.log"

UPSTREAMS = {
    "gpt":    ("https://api.openai.com/v1/chat/completions", os.getenv("OPENAI_API_KEY", "")),
    "grok":   ("https://api.x.ai/v1/chat/completions",       os.getenv("XAI_API_KEY", "")),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
               os.getenv("GEMINI_API_KEY", "")),
}

SET_SCENE_TOOL = {
    "type": "function",
    "function": {
        "name": "set_scene",
        "description": ("Control the on-screen 3D view of the EDT Luma air fryer. Call whenever a "
                        "visual angle helps. Never mention the tool aloud."),
        "parameters": {
            "type": "object",
            "properties": {
                "view": {"type": "string", "enum": ["front","front_iso","top","side","back","bottom","exploded"]},
                "zoom": {"type": "string", "enum": ["in","out"]},
                "spin": {"type": "boolean"},
            },
        },
    },
}

def _log(msg: str) -> None:
    line = f"{datetime.datetime.utcnow().isoformat()}Z  {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass

def route(model: str):
    m = (model or "").lower()
    for prefix, up in UPSTREAMS.items():
        if m.startswith(prefix):
            return up
    return UPSTREAMS["gpt"]

def exec_set_scene(args: dict) -> str:
    _log(f"set_scene(view={args.get('view','')!r} zoom={args.get('zoom','')!r} spin={args.get('spin', False)})")
    parts = []
    if args.get("view"): parts.append(f"{args['view']} view")
    if args.get("zoom"): parts.append(f"zoom {args['zoom']}")
    if args.get("spin"): parts.append("spinning")
    return "Scene updated: " + (", ".join(parts) if parts else "no change") + "."

app = FastAPI()

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "gpt-4o")
    messages = body.get("messages", [])
    url, key = route(model)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    # Multi-pass tool loop (non-streaming upstream) — resolves set_scene in-process.
    convo = list(messages)
    final_text = ""
    async with httpx.AsyncClient(timeout=60) as client:
        for _ in range(5):
            payload = {"model": model, "messages": convo, "tools": [SET_SCENE_TOOL], "stream": False}
            # xAI Grok reasoning models: disable reasoning for a fair latency test.
            if model.lower().startswith("grok"):
                payload["reasoning_effort"] = "none"
            r = await client.post(url, headers=headers, json=payload)
            if r.status_code != 200:
                _log(f"upstream {model} error {r.status_code}: {r.text[:200]}")
                final_text = "Sorry, upstream error."
                break
            choice = r.json()["choices"][0]["message"]
            tcs = choice.get("tool_calls") or []
            if not tcs:
                final_text = choice.get("content") or ""
                break
            convo.append(choice)
            for tc in tcs:
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except Exception:
                    args = {}
                result = exec_set_scene(args) if tc["function"]["name"] == "set_scene" else "unknown tool"
                convo.append({"role": "tool", "tool_call_id": tc["id"], "content": result})

    # Stream the final text back to ConvoAI as OpenAI-style SSE deltas.
    created = int(time.time())
    def sse():
        head = {"id": "edt-tool", "object": "chat.completion.chunk", "created": created,
                "model": model, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
        yield f"data: {json.dumps(head)}\n\n"
        # chunk the text so downstream TTS starts early
        words = final_text.split(" ")
        for i in range(0, len(words), 6):
            piece = " ".join(words[i:i+6])
            if i + 6 < len(words):
                piece += " "
            ch = {"id": "edt-tool", "object": "chat.completion.chunk", "created": created, "model": model,
                  "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]}
            yield f"data: {json.dumps(ch)}\n\n"
        tail = {"id": "edt-tool", "object": "chat.completion.chunk", "created": created, "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {json.dumps(tail)}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream")

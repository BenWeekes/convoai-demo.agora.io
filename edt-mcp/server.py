"""
EDT MCP test server — exposes a `set_scene` tool over MCP (streamable-http).

Phase 1 (this file): a mock tool that logs every invocation and returns a
short confirmation. Purpose: prove that Agora ConvoAI accepts MLLM + mcp_servers
and that the realtime model actually calls the tool. Once validated, the tool
body will publish an RTM `scene_command` to the channel so the luma client
moves the 3D scene.

Run:  uvicorn server:app --host 127.0.0.1 --port 8111
Public path (nginx):  https://convoai-demo.agora.io/edt-mcp/mcp
"""
import datetime
import json
from fastmcp import FastMCP

LOG = "/home/ubuntu/web/edt-mcp/calls.log"

def _log(msg: str) -> None:
    line = f"{datetime.datetime.utcnow().isoformat()}Z  {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass

mcp = FastMCP("edt-scene")

VIEWS = "front, front_iso, top, side, back, bottom, exploded"

@mcp.tool()
def set_scene(view: str = "", zoom: str = "", spin: bool = False) -> str:
    """Control the on-screen 3D view of the EDT Luma air fryer.

    Call this whenever a visual angle helps the user. Never mention the tool
    aloud — just call it and keep talking naturally.

    Args:
        view: one of front, front_iso, top, side, back, bottom, exploded (optional)
        zoom: "in" or "out" (optional)
        spin: true to slowly rotate the product, false to stop (optional)
    """
    # Introspect what the tool actually receives from Agora.
    try:
        from fastmcp.server.dependencies import get_http_request
        req = get_http_request()
        interesting = {k: v for k, v in dict(req.headers).items()
                       if k.lower() not in ("accept", "content-type", "content-length",
                                             "accept-encoding", "host", "connection", "user-agent")}
        _log(f"[ctx] path={req.url.path!r} query={str(req.url.query)!r} extra_headers={json.dumps(interesting)}")
    except Exception as e:
        _log(f"[ctx] unavailable: {e}")
    _log(f"set_scene(view={view!r} zoom={zoom!r} spin={spin})")
    parts = []
    if view:
        parts.append(f"{view} view")
    if zoom:
        parts.append(f"zoom {zoom}")
    if spin:
        parts.append("spinning")
    return "Scene updated: " + (", ".join(parts) if parts else "no change") + "."

# ASGI app serving MCP streamable-http at /mcp
_mcp_app = mcp.http_app(path="/mcp")

# --- TEMP request logger: capture exactly what Agora sends (headers + JSON-RPC
# body) so we can see whether the channel/session context is already passed. ---
REQLOG = "/home/ubuntu/web/edt-mcp/requests.log"

class LogASGI:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break
        headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}
        try:
            with open(REQLOG, "a") as f:
                f.write("\n===== %s %s =====\n" % (scope.get("method"), scope.get("path")))
                f.write("QUERY: %s\n" % scope.get("query_string", b"").decode())
                f.write("HEADERS: %s\n" % json.dumps(headers))
                f.write("BODY: %s\n" % body[:4000].decode("utf-8", "replace"))
        except Exception:
            pass
        replayed = False
        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}
        await self.app(scope, replay, send)

app = LogASGI(_mcp_app)

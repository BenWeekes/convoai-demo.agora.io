#!/usr/bin/env python3
"""Puppet bridge service (port 8095). Isolated from simple-backend.
POST /start           -> {sessionId, channel, appId, publisher:{uid,token}, avatarUid, watchPath}
POST /stop {sessionId}-> terminate a session
GET  /token?channel=&role=viewer -> {appId, channel, uid, token, avatarUid}
GET  /health
Each session spawns puppet_session.py (LemonSlice drive from live Agora audio).
A hard MAX_SESSION_SECONDS cap kills any session so LemonSlice spend/processes never leak.
"""
import os, sys, uuid, subprocess, signal, threading, time, re
from flask import Flask, request, jsonify

sys.path.insert(0, "/home/ubuntu/agent-samples/simple-backend")
from core.tokens import build_token_with_rtm

_ENV_FILE = "/home/ubuntu/agent-samples/simple-backend/.env"
def _env_val(key, default=""):
    """Read a value from env, else the gitignored simple-backend/.env.
    Keeps secrets (Agora cert, LemonSlice key) OUT of source."""
    v = os.environ.get(key)
    if v:
        return v
    try:
        for ln in open(_ENV_FILE):
            if ln.startswith(key + "="):
                return ln.split("=", 1)[1].strip()
    except Exception:
        pass
    return default

# Agora app for the demo (shared across the EVENTDEMO profiles). The certificate
# is a secret -> never hardcode it; read from env or the gitignored .env.
APP  = _env_val("PUPPET_APP_ID") or _env_val("EVENTDEMO_APP_ID")
CERT = _env_val("PUPPET_APP_CERTIFICATE") or _env_val("EVENTDEMO_APP_CERTIFICATE")
API_BASE = os.environ.get("API_BASE", "https://lemonslice.com/api/liveai/agora")
_UP = "https://convoai-demo.agora.io/photo-uploads/EVENTDEMO/"
AVATARS = {   # selectable avatar images (viewer can switch)
    "a": _UP + "0786d134d8d747d89df9e210ae4aa15e.jpg",
    "b": _UP + "5f812d0546f745bfb2c59db322d9ab6d.jpg",
    "c": _UP + "c63d63f4082049dfbb04392a87198d82.jpg",
}
DEFAULT_IMG = "a"
AVATAR_ID = os.environ.get("PUPPET_AVATAR_ID", AVATARS[DEFAULT_IMG])
ASPECT = os.environ.get("PUPPET_ASPECT", "2x3")
AVATAR_UID, CAP_UID, HUMAN_UID = "102", "100", "101"
MAX_SESSION_SECONDS = int(os.environ.get("PUPPET_MAX_SECONDS", "300"))
HERE = os.path.dirname(os.path.abspath(__file__))

def lemon_key():
    return _env_val("LSDUB_AVATAR_API_KEY") or os.environ.get("LEMON_KEY", "")

def mint(channel, uid):
    return build_token_with_rtm(channel, uid, {"APP_ID": APP, "APP_CERTIFICATE": CERT,
        "PRIVILEGE_EXPIRE": 7200, "TOKEN_EXPIRE": 7200})["token"]

app = Flask(__name__)
SESSIONS = {}  # sid -> {proc, channel, timer}
LOCK = threading.Lock()

def _kill(sid):
    with LOCK:
        s = SESSIONS.pop(sid, None)
    if not s: return
    try: s["timer"].cancel()
    except Exception: pass
    p = s["proc"]
    try:
        p.send_signal(signal.SIGTERM)
        for _ in range(30):
            if p.poll() is not None: break
            time.sleep(0.1)
        if p.poll() is None: p.kill()
    except Exception: pass

@app.get("/health")
def health():
    return jsonify({"ok": True, "active": len(SESSIONS)})

@app.get("/avatars")
def avatars():
    return jsonify({"avatars": [{"key": k, "url": u} for k, u in AVATARS.items()], "default": DEFAULT_IMG})

@app.post("/start")
def start():
    # Optional fixed room -> deterministic channels (shareable URLs up front).
    body = request.get_json(silent=True) or {}
    room = (request.args.get("room") or body.get("room") or "").strip().lower()
    room = re.sub(r"[^a-z0-9]", "", room)[:20]
    img_param = (request.args.get("img") or body.get("img") or "").strip().lower() or None
    suf = room if room else uuid.uuid4().hex[:10]
    channel_in  = "ppti" + suf   # human publishes mic here (capturer subscribes)
    channel_out = "ppto" + suf   # LemonSlice publishes A/V here (viewer subscribes)

    # Idempotent so broadcaster + viewer can join in ANY order:
    #  - no img given (broadcaster "Go live")  -> reuse the running session if any
    #  - img given + same as running           -> reuse (no restart)
    #  - img given + different / no session     -> (re)create with that image
    with LOCK:
        ex_sid = next((k for k, v in SESSIONS.items() if v["channel"] == channel_out), None)
        ex = dict(SESSIONS[ex_sid]) if ex_sid else None
    want_switch = bool(img_param and img_param in AVATARS and ex and ex.get("img") != img_param)
    if ex and not want_switch:
        sid, img = ex_sid, ex.get("img", DEFAULT_IMG)      # reuse, no restart
    else:
        if ex_sid: _kill(ex_sid)
        img = img_param if (img_param in AVATARS) else DEFAULT_IMG
        sid = uuid.uuid4().hex[:12]
        env = dict(os.environ, APP=APP, CERT=CERT, API_BASE=API_BASE, API_KEY=lemon_key(),
                   AVATAR_ID=AVATARS[img], ASPECT=ASPECT,
                   CHANNEL_IN=channel_in, CHANNEL_OUT=channel_out,
                   AVATAR_UID=AVATAR_UID, CAP_UID=CAP_UID, HUMAN_UID=HUMAN_UID)
        py = "/home/ubuntu/agent-samples/simple-backend/venv/bin/python"
        log = open(f"/tmp/puppet_{sid}.log", "w")
        proc = subprocess.Popen([py, f"{HERE}/puppet_session.py"], env=env, stdout=log, stderr=log)
        timer = threading.Timer(MAX_SESSION_SECONDS, _kill, args=(sid,))
        timer.daemon = True; timer.start()
        with LOCK:
            SESSIONS[sid] = {"proc": proc, "channel": channel_out, "channel_in": channel_in,
                             "img": img, "timer": timer}
    return jsonify({
        "sessionId": sid, "channel": channel_in, "appId": APP,
        "publisher": {"uid": int(HUMAN_UID), "token": mint(channel_in, HUMAN_UID)},
        "avatarUid": int(AVATAR_UID),
        "img": img,
        "maxSeconds": MAX_SESSION_SECONDS,
        "watchPath": f"/avatar-overlay/puppet-watch.html?channel={channel_out}",
    })

@app.post("/start-mic")
def start_mic():
    """Single-channel 'Mic' mode for the /photo demo: the ONE web client publishes
    its mic AND subscribes to the avatar on the same channel (ui-kit, rtc profile).
    We run the bridge on that same channel with the RTC-profile capturer (filtered
    to the user's uid) so it never picks up the avatar, and drive LemonSlice with
    the user's chosen photo. No ConvoAI (no ASR/LLM/TTS)."""
    body = request.get_json(silent=True) or {}
    avatar_id = (request.args.get("avatar_id") or body.get("avatar_id") or "").strip()
    aspect = (request.args.get("avatar_aspect_ratio") or body.get("avatar_aspect_ratio") or ASPECT).strip()
    # optional SERVER-SIDE denoise of the captured mic (RNNoise via ffmpeg arnndn). The browser's
    # Agora AI Denoiser is the primary; pass denoise=rnnoise to also/instead run it server-side.
    denoise = (request.args.get("denoise") or body.get("denoise") or "").strip().lower()
    if not avatar_id or not avatar_id.lower().startswith("http"):
        return jsonify({"error": "avatar_id (image URL) required"}), 400
    channel = "pmic" + uuid.uuid4().hex[:10]   # one rtc channel: user + avatar + capturer
    sid = uuid.uuid4().hex[:12]
    env = dict(os.environ, APP=APP, CERT=CERT, API_BASE=API_BASE, API_KEY=lemon_key(),
               AVATAR_ID=avatar_id, ASPECT=aspect, DENOISE=denoise,
               CHANNEL_IN=channel, CHANNEL_OUT=channel,          # same channel
               AVATAR_UID=AVATAR_UID, CAP_UID=CAP_UID, HUMAN_UID=HUMAN_UID,
               RECV_BIN="/home/ubuntu/palabra/server/vendor_sdk/bin/recv_pcm_stream_rtc")
    py = "/home/ubuntu/agent-samples/simple-backend/venv/bin/python"
    log = open(f"/tmp/puppet_{sid}.log", "w")
    proc = subprocess.Popen([py, f"{HERE}/puppet_session.py"], env=env, stdout=log, stderr=log)
    timer = threading.Timer(MAX_SESSION_SECONDS, _kill, args=(sid,))
    timer.daemon = True; timer.start()
    with LOCK:
        SESSIONS[sid] = {"proc": proc, "channel": channel, "channel_in": channel,
                         "img": None, "timer": timer}
    return jsonify({
        "sessionId": sid, "appId": APP, "channel": channel,
        "token": mint(channel, HUMAN_UID), "uid": int(HUMAN_UID),
        "avatarUid": int(AVATAR_UID), "maxSeconds": MAX_SESSION_SECONDS,
        "denoise": denoise or None,
        "watchPath": f"/h2a/watch?channel={channel}",
    })

@app.post("/stop")
def stop():
    b = request.get_json(silent=True) or {}
    sid = b.get("sessionId") or request.args.get("sessionId") or request.form.get("sessionId")
    room = (b.get("room") or request.args.get("room") or request.form.get("room") or "").strip().lower()
    room = re.sub(r"[^a-z0-9]", "", room)[:20]
    if room:
        chout = "ppto" + room
        with LOCK:
            dup = [k for k, v in SESSIONS.items() if v["channel"] == chout]
        for k in dup: _kill(k)
        # Orphan fallback (e.g. after a service restart lost the handle): kill any
        # capturer still on this room's IN channel -> its session cleans up + ends
        # the LemonSlice session.
        try: subprocess.run(["pkill", "-f", f"recv_pcm_stream {APP} ppti{room} "], timeout=5)
        except Exception: pass
        return jsonify({"ok": True, "stopped": len(dup)})
    if sid:
        _kill(sid); return jsonify({"ok": True})
    return jsonify({"error": "sessionId or room required"}), 400

@app.get("/token")
def token():
    channel = (request.args.get("channel") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", channel or ""):
        return jsonify({"error": "bad channel"}), 400
    uid = str(200 + (uuid.uuid4().int % 9000))  # viewer uid 200..9199
    return jsonify({"appId": APP, "channel": channel, "uid": int(uid),
                    "token": mint(channel, uid), "avatarUid": int(AVATAR_UID)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8095")))

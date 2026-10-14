#!/usr/bin/env python3
"""One live puppet session: capture a human's mic audio off an Agora channel and
drive a LemonSlice avatar with it in real time (no LLM/TTS — direct voice→avatar).

- LemonSlice joins the channel (uid AVATAR_UID) and publishes lip-synced A/V.
- recv_pcm_stream (Go) subscribes to the channel and streams the HUMAN uid's raw
  PCM16 16k mono to stdout (no disk).
- We forward that audio to LemonSlice as `voice` chunks, and send `voice_end`
  after the audio stays below a volume threshold for SILENCE_MS (default 300ms).

Env: APP, CERT, API_BASE, API_KEY, AVATAR_ID, ASPECT, CHANNEL,
     AVATAR_UID(=102), CAP_UID(=100), HUMAN_UID(=101),
     SDK (vendor_sdk dir), RECV_BIN, SILENCE_MS, RMS_THR
Runs until SIGTERM/SIGINT; cleans up LemonSlice session + capturer.
"""
import asyncio, base64, json, os, signal, subprocess, sys, time, uuid, wave, audioop, threading
from collections import deque
import requests, websockets

APP   = os.environ["APP"]; CERT = os.environ["CERT"]
API_BASE = os.environ["API_BASE"].rstrip("/"); API_KEY = os.environ["API_KEY"]
AVATAR = os.environ["AVATAR_ID"]; ASPECT = os.environ.get("ASPECT", "2x3")
# Two channels so the capturer can NEVER hear the avatar (no feedback):
#   CHANNEL_IN  = where the human publishes mic (capturer subscribes here)
#   CHANNEL_OUT = where LemonSlice publishes A/V (viewer subscribes here)
CHANNEL_IN  = os.environ["CHANNEL_IN"]
CHANNEL_OUT = os.environ["CHANNEL_OUT"]
AVATAR_UID = os.environ.get("AVATAR_UID", "102")
CAP_UID = os.environ.get("CAP_UID", "100")
HUMAN_UID = os.environ.get("HUMAN_UID", "101")
SDK = os.environ.get("SDK", "/home/ubuntu/palabra/server/vendor_sdk")
RECV_BIN = os.environ.get("RECV_BIN", SDK + "/bin/recv_pcm_stream")
SILENCE_MS = int(os.environ.get("SILENCE_MS", "100"))
RMS_THR = int(os.environ.get("RMS_THR", "900"))   # on the smoothed level; ignores bg noise
SR = 24000
# Optional SERVER-SIDE denoise of the captured mic before it drives LemonSlice (and thus
# what viewers hear). DENOISE=rnnoise pipes the PCM through ffmpeg arnndn (RNNoise, 48k).
# The primary denoise is the Agora AI Denoiser on the broadcaster's browser mic; this is the
# pluggable comparison/stack. (Neither removes background MUSIC — that needs source separation.)
DENOISE = os.environ.get("DENOISE", "").strip().lower()
RNNN_MODEL = os.environ.get("RNNN_MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "std.rnnn"))

sys.path.insert(0, "/home/ubuntu/agent-samples/simple-backend")
from core.tokens import build_token_with_rtm

def mint(channel, uid):
    return build_token_with_rtm(channel, uid, {"APP_ID": APP, "APP_CERTIFICATE": CERT,
                                               "PRIVILEGE_EXPIRE": 7200, "TOKEN_EXPIRE": 7200})["token"]

def elog(*a): print(*a, file=sys.stderr, flush=True)

def agora_settings():
    return {"app_id": APP, "token": mint(CHANNEL_OUT, AVATAR_UID), "channel": CHANNEL_OUT,
            "uid": AVATAR_UID, "enable_string_uid": False}

def start_session():
    body = {"avatar_id": AVATAR, "quality": "high", "version": "v1", "video_encoding": "H264",
            "activity_idle_timeout": 300, "area": "NORTH_AMERICA", "agora_settings": agora_settings()}
    if ASPECT: body["aspect_ratio"] = ASPECT
    r = requests.post(f"{API_BASE}/session/start",
                      headers={"x-api-key": API_KEY, "content-type": "application/json"},
                      json=body, timeout=60)
    r.raise_for_status(); d = r.json()
    return d["session_id"], d["websocket_address"], d.get("session_token", "")

def stop_session(sid):
    try:
        requests.delete(f"{API_BASE}/session/stop",
                        headers={"x-api-key": API_KEY, "content-type": "application/json"},
                        json={"session_id": sid}, timeout=15)
    except Exception as e: elog("stop_session err", e)

async def main():
    sid, ws_addr, stok = start_session()
    elog(f"lemonslice session {sid} ws {ws_addr[:50]}")
    hdr = {"authorization": f"Bearer {stok}"} if stok else {}
    ws = await websockets.connect(ws_addr, additional_headers=hdr, open_timeout=30, max_size=None)
    init = {"command": "init", "session_id": sid, "avatar_id": AVATAR, "quality": "high",
            "version": "v1", "video_encoding": "H264", "activity_idle_timeout": 300,
            "area": "NORTH_AMERICA", "agora_settings": agora_settings()}
    if ASPECT: init["aspect_ratio"] = ASPECT
    await ws.send(json.dumps(init)); elog("init sent")

    async def listen():
        try:
            async for m in ws:
                try: elog("  <=", json.dumps(json.loads(m))[:120])
                except Exception: pass
        except Exception: pass
    lt = asyncio.create_task(listen())

    # capturer: stream HUMAN uid PCM16 16k mono to stdout
    env = dict(os.environ, LD_LIBRARY_PATH=SDK + "/agora_sdk")
    cap = subprocess.Popen([RECV_BIN, APP, CHANNEL_IN, mint(CHANNEL_IN, CAP_UID), CAP_UID, HUMAN_UID],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, bufsize=0)
    def cap_err():
        for line in iter(cap.stderr.readline, b""): elog("[cap]", line.decode(errors="ignore").rstrip())
    threading.Thread(target=cap_err, daemon=True).start()

    # optional server-side RNNoise: pipe captured PCM -> ffmpeg arnndn -> denoised PCM. RNNoise
    # runs at 48k so resample up, denoise, resample back. The reader then consumes the denoised
    # stream instead of the raw capturer stdout. Killing cap EOFs ffmpeg -> clean shutdown.
    src_out = cap.stdout
    dn = None
    if DENOISE in ("rnnoise", "arnndn", "server") and os.path.exists(RNNN_MODEL):
        dn = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error",
             "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
             "-af", f"aresample=48000,arnndn=m={RNNN_MODEL},aresample={SR}",
             "-f", "s16le", "-ar", str(SR), "-ac", "1", "pipe:1"],
            stdin=cap.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        src_out = dn.stdout
        elog(f"server denoise ON: rnnoise (arnndn m={RNNN_MODEL})")
    elif DENOISE:
        elog(f"server denoise requested ({DENOISE}) but not applied (model missing?) — passthrough")

    # on SIGTERM/SIGINT: kill capturer -> stdout EOF -> loop breaks -> cleanup runs
    loop0 = asyncio.get_event_loop()
    for s in (signal.SIGTERM, signal.SIGINT):
        try: loop0.add_signal_handler(s, lambda: cap.kill())
        except Exception: pass

    # reader thread: blocking read of capturer stdout -> asyncio queue.
    # Bounded, DROP-OLDEST, enqueued via call_soon_threadsafe. Real-time audio
    # must never accumulate latency: if a ws.send to LemonSlice lags, we drop the
    # oldest 10ms frames instead of buffering them. (The old code scheduled a
    # blocking q.put() coroutine per frame; when the queue filled those piled up
    # unboundedly -> lip-sync drifted seconds behind and "stopped working" after
    # a few minutes.)
    loop = asyncio.get_event_loop()
    FRAME = 480  # 10ms @24k mono 16-bit
    QMAX = int(os.environ.get("QMAX_FRAMES", "100"))  # ~1s hard latency cap
    q = asyncio.Queue(maxsize=QMAX)
    dropped = 0
    def _enqueue(frame):              # runs on the loop thread
        nonlocal dropped
        if q.full():
            try: q.get_nowait(); dropped += 1   # drop oldest -> bound latency
            except asyncio.QueueEmpty: pass
        try: q.put_nowait(frame)
        except asyncio.QueueFull: pass
    def reader():
        buf = b""
        while True:
            d = src_out.read(FRAME)
            if not d: break
            buf += d
            while len(buf) >= FRAME:
                frame, buf = buf[:FRAME], buf[FRAME:]
                loop.call_soon_threadsafe(_enqueue, frame)
    threading.Thread(target=reader, daemon=True).start()

    # Forward the human's REAL audio to LemonSlice as `voice` chunks (24k PCM16,
    # per the convoai_to_video spec) continuously so it lip-syncs the whole
    # stream; inject ONE voice_end only after a SUSTAINED pause (HANG_MS) so we
    # don't reset lip-sync on inter-word gaps. We send only captured audio — no
    # synthetic silence padding (that spliced in timing jitter/clicks); the Agora
    # capturer already delivers a continuous 100fps while the mic is published.
    SMOOTH = max(1, int(os.environ.get("SMOOTH_MS", "60")) // 10)
    HANG_MS = int(os.environ.get("HANG_MS", "600"))
    CHUNK = int(SR * 2 * 0.06)        # flush ~every 60ms
    win = deque(maxlen=SMOOTH)
    speaking = False; low_ms = 0; pending = b""
    peak = 0; last_diag = time.time()
    async def flush_voice():
        nonlocal pending
        if pending:
            await ws.send(json.dumps({"command": "voice",
                "audio": base64.b64encode(pending).decode(), "sampleRate": SR,
                "encoding": "PCM16", "event_id": uuid.uuid4().hex}))
            pending = b""
    async def end_utterance(reason):
        nonlocal speaking
        await flush_voice()
        await ws.send(json.dumps({"command": "voice_end", "event_id": uuid.uuid4().hex}))
        elog(f"voice_end ({reason})"); speaking = False
    elog(f"bridging: thr={RMS_THR} smooth={SMOOTH}f hang={HANG_MS}ms sr={SR} qmax={QMAX} (drop-oldest, real-audio-only)")
    while True:
        try:
            frame = await asyncio.wait_for(q.get(), timeout=0.5)
        except asyncio.TimeoutError:
            if cap.poll() is not None: elog("capturer exited"); break
            if speaking: await end_utterance("starve")  # e.g. mic muted mid-word
            continue
        rms = audioop.rms(frame, 2)
        win.append(rms)
        wrms = sum(win) / len(win)
        peak = max(peak, wrms)
        pending += frame                # ALL captured audio goes through
        if wrms >= RMS_THR:
            if not speaking: speaking = True; elog("speech start")
            low_ms = 0
        else:
            low_ms += 10
            if speaking and low_ms >= HANG_MS:   # sustained pause -> one voice_end
                await end_utterance("pause")
        if len(pending) >= CHUNK:        # flush ~every 60ms
            await flush_voice()
        if time.time() - last_diag > 2.0:
            elog(f"level peak_wrms={int(peak)} thr={RMS_THR} speaking={speaking} q={q.qsize()} dropped={dropped}")
            peak = 0; dropped = 0; last_diag = time.time()

    # cleanup
    try: lt.cancel(); await ws.close()
    except Exception: pass
    try: cap.send_signal(signal.SIGINT); time.sleep(1); cap.kill()
    except Exception: pass
    try:
        if dn: dn.kill()
    except Exception: pass
    stop_session(sid)
    elog("session done")

if __name__ == "__main__":
    stop_evt = asyncio.get_event_loop().create_future() if False else None
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

#!/usr/bin/env python3
"""Drive a HeyGen "Live Avatar" directly via the LiveAvatar API, publishing straight to an Agora
channel, recorded by recv_av — same capture path as the other vendors.

Modelled on TEN-framework's heygen_avatar_python (the CURRENT HeyGen streaming = LiveAvatar API, NOT
the old api.heygen.com/v1/streaming.*):

  POST https://api.liveavatar.com/v1/sessions/token   headers x-api-key:<KEY>
       {mode:"CUSTOM", avatar_id, video_settings:{quality}, agora_config:{agora_app_id,agora_token,
        agora_channel,agora_uid}}                              -> data.session_id, data.session_token
  POST https://api.liveavatar.com/v1/sessions/start   headers Bearer <session_token>  {}  -> data.ws_url
  WS ws_url:  {"type":"agent.speak","audio":<b64 24k mono PCM16>} (repeat, ~60ms)
              {"type":"session.keep_alive"} every 10s      ;  {"type":"agent.speak_end","event_id":…} at end
  POST https://api.liveavatar.com/v1/sessions/stop    headers x-api-key:<KEY>  {session_id}

The avatar publishes A/V to the Agora channel at agora_uid; recv_av records it. Audio MUST be 24 kHz.

Env (required): HEYGEN_API_KEY, AVATAR_ID, AGORA_APP_ID[/AGORA_APP_CERTIFICATE]
Env (optional): WAV (24k mono PCM16), WORK, UID (default 102), RECV_AV, SDK_LIB, WARMUP (12), DUR, QUALITY
"""
import asyncio, base64, json, os, signal, subprocess, sys, time, uuid, wave
import requests, websockets
from agora_token import build_token_with_rtm

BASE   = "https://api.liveavatar.com/v1"
KEY    = os.environ["HEYGEN_API_KEY"]
AVATAR = os.environ["AVATAR_ID"]
QUALITY = os.environ.get("QUALITY", "high")
HERE = os.path.dirname(os.path.abspath(__file__))
WAV  = os.environ.get("WAV", os.path.join(HERE, "input_24k.wav"))
WORK = os.environ.get("WORK", os.path.join(HERE, "work")); os.makedirs(WORK, exist_ok=True)
UID  = os.environ.get("UID", "102")
APP  = os.environ.get("AGORA_APP_ID", "")
CERT = os.environ.get("AGORA_APP_CERTIFICATE", "")
RECV_AV = os.environ.get("RECV_AV", os.path.join(HERE, "recv_av"))
SDK_LIB = os.environ.get("SDK_LIB", "")
if not APP:
    sys.exit("Set AGORA_APP_ID (and AGORA_APP_CERTIFICATE if your project uses tokens).")

_wf = wave.open(WAV, "rb"); _SR = _wf.getframerate(); _AUDIO_S = _wf.getnframes()/_SR; _wf.close()
if _SR != 24000:
    sys.exit(f"LiveAvatar requires 24000 Hz PCM16; WAV is {_SR} Hz. Re-encode: ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le out.wav")
DUR = float(os.environ.get("DUR", str(_AUDIO_S + 6)))
CH  = "hg" + uuid.uuid4().hex[:8]
TOKEN = build_token_with_rtm(CH, UID, {"APP_ID": APP, "APP_CERTIFICATE": CERT,
                                       "PRIVILEGE_EXPIRE": 7200, "TOKEN_EXPIRE": 7200})["token"]
HDR  = {"accept": "application/json", "content-type": "application/json", "x-api-key": KEY}


def _create_token():
    body = {"mode": "CUSTOM", "avatar_id": AVATAR, "video_settings": {"quality": QUALITY},
            "agora_config": {"agora_app_id": APP, "agora_token": TOKEN, "agora_channel": CH, "agora_uid": UID}}
    r = requests.post(f"{BASE}/sessions/token", headers=HDR, json=body, timeout=30)
    if r.status_code >= 300:
        print("sessions/token error", r.status_code, r.text[:300])
    r.raise_for_status(); d = r.json()["data"]; return d["session_id"], d["session_token"]


def _start(session_token):
    sh = {"accept": "application/json", "content-type": "application/json",
          "authorization": f"Bearer {session_token}"}
    r = requests.post(f"{BASE}/sessions/start", headers=sh, json={}, timeout=30)
    if r.status_code >= 300:
        print("sessions/start error", r.status_code, r.text[:300])
    r.raise_for_status(); return r.json()["data"]["ws_url"]


def _stop(sid):
    try:
        requests.post(f"{BASE}/sessions/stop", headers=HDR, json={"session_id": sid}, timeout=15)
    except Exception as e:
        print("stop err", e)


async def main():
    sid, stok = _create_token(); print("session", sid)
    ws_url = _start(stok); print("ws", ws_url[:70])
    ws = await websockets.connect(ws_url, max_size=None, open_timeout=30)
    async def listen():
        try:
            async for _ in ws:
                pass
        except Exception:
            pass
    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(10)
                await ws.send(json.dumps({"type": "session.keep_alive"}))
        except Exception:
            pass
    lt = asyncio.create_task(listen()); hb = asyncio.create_task(heartbeat())
    warm = float(os.environ.get("WARMUP", "12")); print(f"warmup {warm}s before recorder joins..."); await asyncio.sleep(warm)
    env = dict(os.environ, AGORA_APP_ID=APP, AGORA_APP_CERTIFICATE=CERT)
    if SDK_LIB:
        env["LD_LIBRARY_PATH"] = SDK_LIB
    rec = subprocess.Popen([RECV_AV, APP, CH, UID], cwd=WORK, env=env,
                           stdout=open(WORK + "/rec.log", "w"), stderr=subprocess.STDOUT)
    try:
        await asyncio.sleep(2.0)
        wf = wave.open(WAV, "rb"); frames = wf.readframes(wf.getnframes()); wf.close()
        STEP = 0.06; chunk = int(_SR * STEP) * 2; i = 0; t0 = time.time(); sent = 0.0
        while i < len(frames):
            c = frames[i:i + chunk]; i += chunk
            await ws.send(json.dumps({"type": "agent.speak", "audio": base64.b64encode(c).decode()}))
            sent += STEP
            d = t0 + sent - time.time()
            if d > 0:
                await asyncio.sleep(d)
        await ws.send(json.dumps({"type": "agent.speak_end", "event_id": uuid.uuid4().hex}))
        print(f"audio streamed {sent:.1f}s")
        await asyncio.sleep(max(0, DUR - _AUDIO_S))
        lt.cancel(); hb.cancel(); await ws.close()
    finally:
        rec.send_signal(signal.SIGINT); time.sleep(2)
        if rec.poll() is None:
            rec.kill()
        _stop(sid)
    print("done; recording in", WORK)


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Drive a HeyGen STREAMING avatar directly via HeyGen's public API, publishing straight to an Agora
channel (version="agora_v1"), recorded by recv_av — the same capture path as the other vendors.

Modelled on TEN-framework's heygen_avatar_python extension
(github.com/TEN-framework/ten-framework .../extension/heygen_avatar_python):

  POST /v1/streaming.create_token   headers: x-api-key:<KEY>          -> data.token
  POST /v1/streaming.new  (Bearer <token>)  {avatar_name, quality:"high", version:"agora_v1",
       video_encoding:"H264", source:"app", disable_idle_timeout:false, namespace:"demo",
       agora_settings:{app_id, token, channel, uid}}                  -> data.session_id, data.realtime_endpoint
  POST /v1/streaming.start  (Bearer)  {session_id}
  WS  realtime_endpoint:  {"type":"agent.speak","audio":<b64 24k mono PCM16>,"event_id":…} (repeat, ~60ms)
                          {"type":"agent.speak_end","event_id":…}
  POST /v1/streaming.stop  (Bearer)  {session_id}

HeyGen publishes the avatar A/V to the Agora channel at `uid`; recv_av records it (-> recv.264 / audio.wav).

Env (required): HEYGEN_API_KEY, AVATAR_ID (= HeyGen avatar_name/id), AGORA_APP_ID[/AGORA_APP_CERTIFICATE]
Env (optional): WAV (24k mono PCM16, default ./input_24k.wav), WORK, UID (default 102),
                RECV_AV, SDK_LIB, WARMUP (sec before recorder joins, default 12), DUR
"""
import asyncio, base64, json, os, signal, subprocess, sys, time, uuid, wave
import requests, websockets
from agora_token import build_token_with_rtm

API     = "https://api.heygen.com/v1"
KEY     = os.environ["HEYGEN_API_KEY"]
AVATAR  = os.environ["AVATAR_ID"]
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

_wf = wave.open(WAV, "rb"); _AUDIO_S = _wf.getnframes()/_wf.getframerate(); _wf.close()
DUR = float(os.environ.get("DUR", str(_AUDIO_S + 6)))
CH  = "hg" + uuid.uuid4().hex[:8]
TOKEN = build_token_with_rtm(CH, UID, {"APP_ID": APP, "APP_CERTIFICATE": CERT,
                                       "PRIVILEGE_EXPIRE": 7200, "TOKEN_EXPIRE": 7200})["token"]


def _create_token():
    r = requests.post(f"{API}/streaming.create_token", headers={"x-api-key": KEY}, json={}, timeout=30)
    r.raise_for_status(); return r.json()["data"]["token"]


def _new_session(bearer):
    body = {"avatar_name": AVATAR, "quality": "high", "version": "agora_v1", "video_encoding": "H264",
            "source": "app", "disable_idle_timeout": False, "namespace": "demo",
            "agora_settings": {"app_id": APP, "token": TOKEN, "channel": CH, "uid": int(UID)}}
    r = requests.post(f"{API}/streaming.new", headers={"authorization": f"Bearer {bearer}"}, json=body, timeout=60)
    if r.status_code >= 300:
        print("streaming.new error", r.status_code, r.text[:300])
    r.raise_for_status(); d = r.json()["data"]; return d["session_id"], d["realtime_endpoint"]


def _start(bearer, sid):
    r = requests.post(f"{API}/streaming.start", headers={"authorization": f"Bearer {bearer}"},
                      json={"session_id": sid}, timeout=30)
    r.raise_for_status()


def _stop(bearer, sid):
    try:
        requests.post(f"{API}/streaming.stop", headers={"authorization": f"Bearer {bearer}"},
                      json={"session_id": sid}, timeout=15)
    except Exception as e:
        print("stop err", e)


async def main():
    bearer = _create_token(); print("token ok")
    sid, rt = _new_session(bearer); print("session", sid, "rt", rt[:70])
    _start(bearer, sid); print("started")
    ws = await websockets.connect(rt, max_size=None, open_timeout=30)
    async def listen():
        try:
            async for _ in ws:   # consume server messages so HeyGen's buffer doesn't stall
                pass
        except Exception:
            pass
    lt = asyncio.create_task(listen())
    # warm up before the recorder joins — HeyGen cold-starts video a few seconds after the first audio,
    # so joining late keeps audio_offset ≈ 0 (same reasoning as drive_generic).
    warm = float(os.environ.get("WARMUP", "12")); print(f"warmup {warm}s before recorder joins..."); await asyncio.sleep(warm)
    env = dict(os.environ, AGORA_APP_ID=APP, AGORA_APP_CERTIFICATE=CERT)
    if SDK_LIB:
        env["LD_LIBRARY_PATH"] = SDK_LIB
    rec = subprocess.Popen([RECV_AV, APP, CH, UID], cwd=WORK, env=env,
                           stdout=open(WORK + "/rec.log", "w"), stderr=subprocess.STDOUT)
    try:
        await asyncio.sleep(2.0)
        wf = wave.open(WAV, "rb"); sr = wf.getframerate(); frames = wf.readframes(wf.getnframes()); wf.close()
        STEP = 0.06; chunk = int(sr * STEP) * 2; i = 0; t0 = time.time(); sent = 0.0
        while i < len(frames):
            c = frames[i:i + chunk]; i += chunk
            await ws.send(json.dumps({"type": "agent.speak", "audio": base64.b64encode(c).decode(),
                                      "event_id": uuid.uuid4().hex}))
            sent += STEP
            d = t0 + sent - time.time()
            if d > 0:
                await asyncio.sleep(d)
        await ws.send(json.dumps({"type": "agent.speak_end", "event_id": uuid.uuid4().hex}))
        print(f"audio streamed {sent:.1f}s")
        await asyncio.sleep(max(0, DUR - _AUDIO_S))
        lt.cancel(); await ws.close()
    finally:
        rec.send_signal(signal.SIGINT); time.sleep(2)
        if rec.poll() is None:
            rec.kill()
        _stop(bearer, sid)
    print("done; recording in", WORK)


if __name__ == "__main__":
    asyncio.run(main())

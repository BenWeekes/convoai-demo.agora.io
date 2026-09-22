#!/usr/bin/env python3
"""Drive ANY generic avatar provider directly (LemonSlice / Tavus / Protoface / …)
with a fixed WAV, using the unified convoai_to_video protocol
(github.com/AgoraIO-Solutions/convoai_to_video):

  POST {API_BASE}/session/start   (header x-api-key)
      -> {session_id, websocket_address, session_token}
  WS (header Authorization: Bearer session_token):
      init  -> voice(PCM16 base64 chunks) -> voice_end
  The provider joins the Agora channel at `uid` and publishes lip-synced A/V,
  which you capture with the Go recorder (recv_av) in this folder.

This is the "Agora side" of the protocol — i.e. we play the role ConvoAI plays,
but stream a byte-identical WAV instead of live TTS, so every provider lip-syncs
to the exact same audio (useful for side-by-side comparisons).

Env (required):
  API_BASE      provider base, e.g. https://tavusapi.com/v2/conversations/agora
  API_KEY       provider api key (x-api-key)
  AVATAR_ID     avatar / persona / image id for that provider
Env (optional):
  WAV           24k mono PCM16 source (default ./input_24k.wav)
  WORK          recording output dir (default ./work)
  UID           avatar uid (default 102)
  AGORA_APP_ID / AGORA_APP_CERTIFICATE   (default: demo app id, no cert)
  RECV_AV       path to the built recv_av binary (default ./recv_av)
  SDK_LIB       dir containing agora_sdk shared libs (for LD_LIBRARY_PATH)
  DUR           seconds to record (default: audio length + 6)

Anam uses a different two-step auth (see drive_anam.py).
"""
import asyncio, base64, json, os, signal, subprocess, sys, time, uuid, wave
import requests, websockets
from agora_token import build_token_with_rtm

API_BASE = os.environ["API_BASE"].rstrip("/")
API_KEY  = os.environ["API_KEY"]
AVATAR   = os.environ["AVATAR_ID"]
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
CH  = "gen" + uuid.uuid4().hex[:8]
TOKEN = build_token_with_rtm(CH, UID, {"APP_ID":APP,"APP_CERTIFICATE":CERT,
                                       "PRIVILEGE_EXPIRE":7200,"TOKEN_EXPIRE":7200})["token"]
SESSION_TOKEN = ""

def agora_settings():
    return {"app_id":APP,"token":TOKEN,"channel":CH,"uid":UID,"enable_string_uid":False}

def start_session():
    body={"avatar_id":AVATAR,"quality":"high","version":"v1","video_encoding":"H264",
          "activity_idle_timeout":120,"area":"NORTH_AMERICA","agora_settings":agora_settings()}
    r=requests.post(f"{API_BASE}/session/start",
                    headers={"x-api-key":API_KEY,"content-type":"application/json"},
                    json=body, timeout=90)
    r.raise_for_status(); d=r.json()
    return d["session_id"], d["websocket_address"], d.get("session_token","")

def stop_session(sid):
    try:
        requests.delete(f"{API_BASE}/session/stop",
                        headers={"x-api-key":API_KEY,"content-type":"application/json"},
                        json={"session_id":sid}, timeout=15)
    except Exception as e: print("stop err", e)

async def run_ws(ws_addr, sid):
    hdr={"authorization": f"Bearer {SESSION_TOKEN}"} if SESSION_TOKEN else {}
    ws=await websockets.connect(ws_addr, additional_headers=hdr, open_timeout=30, max_size=None)
    init={"command":"init","session_id":sid,"avatar_id":AVATAR,"quality":"high","version":"v1",
          "video_encoding":"H264","activity_idle_timeout":120,"area":"NORTH_AMERICA",
          "agora_settings":agora_settings()}
    await ws.send(json.dumps(init)); print("init sent")
    async def listen():
        try:
            async for m in ws:
                try: print("  <=", json.dumps(json.loads(m))[:120])
                except Exception: pass
        except Exception: pass
    return ws, asyncio.create_task(listen())

async def stream_audio(ws):
    wf=wave.open(WAV,"rb"); sr=wf.getframerate(); frames=wf.readframes(wf.getnframes()); wf.close()
    chunk=int(sr*0.5)*2; i=0; t0=time.time(); sent=0.0
    while i<len(frames):
        c=frames[i:i+chunk]; i+=chunk
        await ws.send(json.dumps({"command":"voice","audio":base64.b64encode(c).decode(),
                                  "sampleRate":sr,"encoding":"PCM16","event_id":uuid.uuid4().hex}))
        sent+=0.5
        d=t0+sent-time.time()          # pace ~realtime
        if d>0: await asyncio.sleep(d)
    await ws.send(json.dumps({"command":"voice_end","event_id":uuid.uuid4().hex}))
    print(f"audio streamed {sent:.1f}s")

async def main():
    global SESSION_TOKEN
    sid, ws_addr, SESSION_TOKEN = start_session()
    print("session", sid, "ws", ws_addr[:70])
    env=dict(os.environ, AGORA_APP_ID=APP, AGORA_APP_CERTIFICATE=CERT)
    if SDK_LIB: env["LD_LIBRARY_PATH"]=SDK_LIB
    rec=subprocess.Popen([RECV_AV, APP, CH, UID], cwd=WORK, env=env,
                         stdout=open(WORK+"/rec.log","w"), stderr=subprocess.STDOUT)
    try:
        ws, lt = await run_ws(ws_addr, sid)
        await asyncio.sleep(2.0)
        await stream_audio(ws)
        await asyncio.sleep(max(0, DUR-_AUDIO_S))
        lt.cancel(); await ws.close()
    finally:
        rec.send_signal(signal.SIGINT); time.sleep(2)
        if rec.poll() is None: rec.kill()
        stop_session(sid)
    print("done; recording in", WORK)

if __name__ == "__main__":
    asyncio.run(main())

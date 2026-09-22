#!/usr/bin/env python3
"""Drive Anam directly. Anam predates the unified /session/start protocol and uses
a TWO-STEP auth against api.anam.ai, but the WebSocket voice streaming is the same
shape as drive_generic.py.

  1. POST {BASE}/auth/session-token   (Bearer API_KEY)  -> sessionToken
       body: {personaConfig:{avatarId, avatarModel}, environment:{agoraSettings:{...}}}
  2. POST {BASE}/engine/session       (Bearer sessionToken) -> {sessionId, websocketAddress}
  3. WS: init -> voice(PCM16 chunks) -> voice_end   (+ heartbeat every 5s)

Env: API_KEY, AVATAR_ID, WAV, WORK, UID, AGORA_APP_ID/AGORA_APP_CERTIFICATE,
     ANAM_MODEL (default cara-4), ANAM_W/ANAM_H (optional output size),
     RECV_AV, SDK_LIB, DUR, BASE (default https://api.anam.ai/v1).
"""
import asyncio, base64, json, os, signal, subprocess, sys, time, uuid, wave
import requests, websockets
from agora_token import build_token_with_rtm

BASE   = os.environ.get("BASE", "https://api.anam.ai/v1")
API_KEY= os.environ["API_KEY"]
AVATAR = os.environ["AVATAR_ID"]
MODEL  = os.environ.get("ANAM_MODEL", "cara-4")
HERE = os.path.dirname(os.path.abspath(__file__))
WAV  = os.environ.get("WAV", os.path.join(HERE, "input_24k.wav"))
WORK = os.environ.get("WORK", os.path.join(HERE, "work")); os.makedirs(WORK, exist_ok=True)
UID  = os.environ.get("UID", "102")
APP  = os.environ.get("AGORA_APP_ID", ""); CERT = os.environ.get("AGORA_APP_CERTIFICATE", "")
RECV_AV = os.environ.get("RECV_AV", os.path.join(HERE, "recv_av")); SDK_LIB=os.environ.get("SDK_LIB","")
W=int(os.environ.get("ANAM_W","0")); H=int(os.environ.get("ANAM_H","0"))
_wf=wave.open(WAV,"rb"); _AS=_wf.getnframes()/_wf.getframerate(); _wf.close()
DUR=float(os.environ.get("DUR", str(_AS+6)))
CH="anam"+uuid.uuid4().hex[:8]
TOKEN=build_token_with_rtm(CH,UID,{"APP_ID":APP,"APP_CERTIFICATE":CERT,"PRIVILEGE_EXPIRE":7200,"TOKEN_EXPIRE":7200})["token"]
HDR={"content-type":"application/json","Authorization":f"Bearer {API_KEY}"}

def auth():
    ag={"appId":APP,"token":TOKEN,"channel":CH,"uid":UID,"quality":"high","videoEncoding":"H264",
        "enableStringUids":False,"activityIdleTimeout":600,"audioSampleRate":24000}
    if W>0 and H>0: ag["width"]=W; ag["height"]=H
    body={"personaConfig":{"avatarId":AVATAR,"avatarModel":MODEL},"environment":{"agoraSettings":ag}}
    r=requests.post(f"{BASE}/auth/session-token",headers=HDR,json=body,timeout=30); r.raise_for_status()
    return r.json()["sessionToken"]

def start(stoken):
    h=dict(HDR); h["Authorization"]=f"Bearer {stoken}"
    r=requests.post(f"{BASE}/engine/session",headers=h,json={},timeout=30); r.raise_for_status()
    d=r.json(); return d["sessionId"], d["websocketAddress"]

def kill(sid):
    try: requests.post(f"{BASE}/engine/session/{sid}/kill",headers=HDR,json={"sessionId":sid},timeout=15)
    except Exception: pass

async def run(ws_addr, sid):
    ws=await websockets.connect(ws_addr, additional_headers={}, open_timeout=30, max_size=None)
    await ws.send(json.dumps({"command":"init","sessionId":sid,"event_id":uuid.uuid4().hex}))
    async def hb():
        try:
            while True:
                await ws.send(json.dumps({"command":"heartbeat","event_id":uuid.uuid4().hex,"timestamp":int(time.time()*1000)}))
                await asyncio.sleep(5)
        except Exception: pass
    return ws, asyncio.create_task(hb())

async def stream(ws):
    wf=wave.open(WAV,"rb"); sr=wf.getframerate(); frames=wf.readframes(wf.getnframes()); wf.close()
    chunk=int(sr*0.5)*2; i=0; t0=time.time(); sent=0.0
    while i<len(frames):
        c=frames[i:i+chunk]; i+=chunk
        await ws.send(json.dumps({"command":"voice","audio":base64.b64encode(c).decode(),
                                  "sample_rate":sr,"encoding":"PCM16","event_id":uuid.uuid4().hex}))
        sent+=0.5; d=t0+sent-time.time()
        if d>0: await asyncio.sleep(d)
    await ws.send(json.dumps({"command":"voice_end","event_id":uuid.uuid4().hex}))
    print(f"audio streamed {sent:.1f}s")

async def main():
    st=auth(); sid,ws_addr=start(st); print("session",sid)
    ws,hb=await run(ws_addr,sid)
    # See drive_generic.py: warm up (provider publishing A/V in sync) before the
    # recorder joins, so audio_offset_ms ≈ 0 and clips record identically.
    warm=float(os.environ.get("WARMUP","15")); print(f"warmup {warm}s before recorder joins channel...")
    await asyncio.sleep(warm)
    env=dict(os.environ, AGORA_APP_ID=APP, AGORA_APP_CERTIFICATE=CERT)
    if SDK_LIB: env["LD_LIBRARY_PATH"]=SDK_LIB
    rec=subprocess.Popen([RECV_AV,APP,CH,UID],cwd=WORK,env=env,stdout=open(WORK+"/rec.log","w"),stderr=subprocess.STDOUT)
    try:
        await asyncio.sleep(2.0)
        await stream(ws); await asyncio.sleep(max(0,DUR-_AS)); hb.cancel(); await ws.close()
    finally:
        rec.send_signal(signal.SIGINT); time.sleep(2)
        if rec.poll() is None: rec.kill()
        kill(sid)
    print("done; recording in",WORK)

if __name__=="__main__": asyncio.run(main())

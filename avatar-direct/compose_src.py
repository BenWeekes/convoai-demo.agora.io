#!/usr/bin/env python3
"""Like compose_native, but mux the PRISTINE SOURCE wav (what drove the lipsync)
instead of the provider's band-limited echo — cleaner audio, same lipsync.
Video speech position is derived from the recorded echo (+ captured offset); the
source is aligned by its own speech onset so both share an identical LEAD.

Usage: WORK=<dir> SRC=<clean_source.wav> compose_src.py <out.mp4> [out_height]
Env: LEAD (default 0.5), DUR (default 20.0)
"""
import os, subprocess, sys, wave, numpy as np
WORK=os.environ["WORK"]; SRC=os.environ["SRC"]; OUT=sys.argv[1]; OH=int(sys.argv[2]) if len(sys.argv)>2 else 512
LEAD=float(os.environ.get("LEAD","0.5")); DUR=float(os.environ.get("DUR","20.0"))
MKV=f"{WORK}/v.mkv"
subprocess.run(["mkvmerge","-o",MKV,"--timestamps","0:"+f"{WORK}/video.timestamps",f"{WORK}/recv.264"],check=True,stdout=subprocess.DEVNULL)
off_ms=0
for ln in open(f"{WORK}/meta.txt"):
    if ln.startswith("audio_offset_ms="): off_ms=int(ln.split("=")[1])
off=off_ms/1000.0
def onset(path):
    w=wave.open(path);sr=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float);w.close()
    win=int(0.05*sr);rms=np.array([np.sqrt(np.mean(a[i:i+win]**2)) for i in range(0,len(a)-win,win)])
    thr=max(150,rms.max()*0.06);return np.where(rms>thr)[0][0]*0.05
def wav_len(path):
    w=wave.open(path);n=w.getnframes()/w.getframerate();w.close();return n
onset_echo=onset(f"{WORK}/audio.wav")   # audio-time in the recording
onset_src =onset(SRC)                   # speech onset in the clean source (may be ~0)
eff_lead=min(LEAD, onset_src)           # can't lead-in more than the source actually has
vstart=max(0.0, off+onset_echo-eff_lead)  # video-time: eff_lead before the avatar speaks
astart=max(0.0, onset_src-eff_lead)       # source: same eff_lead before the same speech
DUR=min(DUR, wav_len(SRC)-astart)         # never overrun the source
print(f"{OUT}: off={off:.3f} onset_echo={onset_echo:.2f} onset_src={onset_src:.2f} eff_lead={eff_lead:.2f} -> vstart={vstart:.3f} astart={astart:.3f} dur={DUR:.2f}")
vf=(f"[0:v]trim=start={vstart:.3f}:duration={DUR:.3f},setpts=PTS-STARTPTS,scale=-2:{OH}[v];"
    f"[1:a]atrim=start={astart:.3f}:duration={DUR:.3f},asetpts=PTS-STARTPTS,aresample=48000[a]")
subprocess.run(["ffmpeg","-y","-v","error","-i",MKV,"-i",SRC,"-filter_complex",vf,
    "-map","[v]","-map","[a]","-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","192k","-movflags","+faststart", OUT],check=True)
print("WROTE",OUT)

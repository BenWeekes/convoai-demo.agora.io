#!/usr/bin/env python3
"""Mux the recording's OWN captured audio (A/V already RTP-synced from the channel)
onto its video, aligned only by the recorder's captured audio_offset (no cross-corr),
then trim so every clip has an identical lead before speech and identical duration.

Usage: WORK=<dir> compose_native.py <out.mp4> [out_height]
Env: LEAD (s before speech, default 0.5), DUR (total s, default 20.0)
"""
import os, subprocess, sys, wave, numpy as np
WORK=os.environ["WORK"]; OUT=sys.argv[1]; OH=int(sys.argv[2]) if len(sys.argv)>2 else 480
LEAD=float(os.environ.get("LEAD","0.5")); DUR=float(os.environ.get("DUR","20.0"))
MKV=f"{WORK}/v.mkv"
subprocess.run(["mkvmerge","-o",MKV,"--timestamps","0:"+f"{WORK}/video.timestamps",f"{WORK}/recv.264"],check=True,stdout=subprocess.DEVNULL)
off_ms=0
for ln in open(f"{WORK}/meta.txt"):
    if ln.startswith("audio_offset_ms="): off_ms=int(ln.split("=")[1])
off=off_ms/1000.0   # audio.wav[0] sits at video-time `off`

# speech onset in audio.wav (audio-time), then to video-time
w=wave.open(f"{WORK}/audio.wav");sr=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float);w.close()
win=int(0.05*sr);rms=np.array([np.sqrt(np.mean(a[i:i+win]**2)) for i in range(0,len(a)-win,win)])
thr=max(150,rms.max()*0.06);v=np.where(rms>thr)[0]; onset_a=v[0]*0.05
# audio.wav[t] sits at video-time (off+t). Keep A/V locked: video[vstart] <-> audio[vstart-off].
vstart=max(0.0, off+onset_a-LEAD)      # aim for LEAD before speech; can't go before the video exists
astart=max(0.0, vstart-off)            # the audio sample that lines up with video[vstart]
print(f"{OUT}: audio_offset={off:.3f}s onset_a={onset_a:.2f}s -> vstart={vstart:.3f} astart={astart:.3f}")

vf=(f"[0:v]trim=start={vstart:.3f}:duration={DUR:.3f},setpts=PTS-STARTPTS,scale=-2:{OH}[v];"
    f"[1:a]atrim=start={astart:.3f}:duration={DUR:.3f},asetpts=PTS-STARTPTS,aresample=48000[a]")
subprocess.run(["ffmpeg","-y","-v","error","-i",MKV,"-i",f"{WORK}/audio.wav","-filter_complex",vf,
    "-map","[v]","-map","[a]","-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","160k","-movflags","+faststart", OUT],check=True)
print("WROTE",OUT)

#!/usr/bin/env python3
"""Compose one avatar recording into an MP4 with the ORIGINAL source audio muxed
on (byte-identical across providers), aligned to that avatar's lips.

Each provider lip-syncs to the same input WAV, so we align by cross-correlating the
recorded (echoed) uid-audio against the source, then mux the source audio onto the
recorded video. Reconstructs true per-frame timing via mkvmerge (needs mkvtoolnix).

Usage: WORK=<dir> SRC=<source.wav|.m4a> compose_grid.py <out.mp4> [out_height]
"""
import os, subprocess, sys, wave
import numpy as np

WORK=os.environ["WORK"]; OUT=sys.argv[1]; OH=int(sys.argv[2]) if len(sys.argv)>2 else 480
SRC=os.environ.get("SRC", os.path.join(WORK,"..","input.m4a"))
H264=os.path.join(WORK,"recv.264"); TS=os.path.join(WORK,"video.timestamps")
AWAV=os.path.join(WORK,"audio.wav"); MKV=os.path.join(WORK,"v.mkv"); TAIL=0.6

subprocess.run(["mkvmerge","-o",MKV,"--timestamps","0:"+TS,H264],check=True,stdout=subprocess.DEVNULL)

def load16k(path):
    # decode anything to 16k mono via ffmpeg
    raw=subprocess.check_output(["ffmpeg","-v","error","-i",path,"-f","s16le","-ac","1","-ar","16000","-"])
    return np.frombuffer(raw,dtype=np.int16).astype(np.float32)
rec=load16k(AWAV); src=load16k(SRC); srclen=len(src)/16000.0
n=1
while n<len(rec)+len(src): n<<=1
cc=np.fft.irfft(np.fft.rfft(rec,n)*np.conj(np.fft.rfft(src,n)),n)
D=int(np.argmax(cc[:len(rec)]))/16000.0
print(f"source starts in recording at D={D:.3f}s (src {srclen:.2f}s)")

dur=srclen+TAIL
vf=(f"[0:v]trim=start={max(0,D):.3f}:duration={dur:.3f},setpts=PTS-STARTPTS,scale=-2:{OH}[v];"
    f"[1:a]atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,aresample=48000[a]")
subprocess.run(["ffmpeg","-y","-v","error","-i",MKV,"-i",SRC,"-filter_complex",vf,
    "-map","[v]","-map","[a]","-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","160k","-movflags","+faststart", OUT],check=True)
print("WROTE",OUT)

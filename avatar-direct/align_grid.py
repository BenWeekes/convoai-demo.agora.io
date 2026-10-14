#!/usr/bin/env python3
"""Cross-correlate each avatar's captured audio envelope against benb3's audio
(the reference) to find a per-avatar time offset (delay to apply so the avatar's
speech lands on benb3's speech), plus a windowed (early/mid/late) drift check.
numpy only."""
import subprocess, sys, numpy as np

SR=16000; HOP=160; WIN=400  # 100 fps envelope

def load(path):
    raw=subprocess.run(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(SR),
                        "-f","f32le","-"],capture_output=True,check=True).stdout
    return np.frombuffer(raw,dtype="<f4").astype(np.float64)

def env(x):
    if len(x)<WIN: return np.zeros(0)
    n=1+(len(x)-WIN)//HOP
    e=np.empty(n)
    for i in range(n):
        f=x[i*HOP:i*HOP+WIN]; e[i]=np.sqrt(np.mean(f*f))
    k=np.ones(5)/5.0
    return np.convolve(e,k,mode="same")

def onset(e,frac=0.06):
    mx=e.max(); thr=max(mx*frac, mx*0.0+1e-6)
    v=np.where(e>thr)[0]
    return (v[0]/100.0) if len(v) else 0.0

def xcorr_lag(eb,ea,max_lag_s=10.0):
    """best integer lag (frames, 100fps) s.t. eb[t] ~ ea[t-lag]; positive => delay avatar."""
    # normalize
    eb=(eb-eb.mean())/(eb.std()+1e-9)
    ea=(ea-ea.mean())/(ea.std()+1e-9)
    ML=int(max_lag_s*100)
    best=None;bl=0
    for lag in range(-ML,ML+1):
        # compare eb[t] with ea[t-lag] over overlap
        if lag>=0:
            a=eb[lag:]; b=ea[:len(eb)-lag]
        else:
            a=eb[:len(eb)+lag]; b=ea[-lag:len(eb)]
        L=min(len(a),len(b))
        if L<500: continue
        c=np.dot(a[:L],b[:L])/L
        if best is None or c>best: best=c; bl=lag
    return bl, best

ref=sys.argv[1]  # benb3 audio source (mov)
eb=env(load(ref))
print(f"REF {ref}: dur={len(eb)/100:.2f}s onset={onset(eb):.2f}s")
for name in sys.argv[2:]:
    ea=env(load(name))
    lag,corr=xcorr_lag(eb,ea)
    delay=lag/100.0
    # windowed drift: split ref into 3 thirds, local xcorr within +-1.0s of global lag
    n=len(eb); thirds=[(0,n//3),(n//3,2*n//3),(2*n//3,n)]
    wdr=[]
    for (s,e2) in thirds:
        sub_b=eb[s:e2]
        # search local lag near global
        bb=(sub_b-sub_b.mean())/(sub_b.std()+1e-9)
        bestc=None;bll=0
        for dl in range(lag-120,lag+121):
            # ea index = t - dl for t in [s,e2)
            ia=np.arange(s,e2)-dl
            m=(ia>=0)&(ia<len(ea))
            if m.sum()<300: continue
            av=ea[ia[m]]; av=(av-av.mean())/(av.std()+1e-9)
            c=np.dot(bb[m],av)/m.sum()
            if bestc is None or c>bestc: bestc=c; bll=dl
        wdr.append(bll/100.0)
    drift=max(wdr)-min(wdr)
    print(f"{name}: lag={lag}f delay={delay:+.3f}s corr={corr:.3f} onset={onset(ea):.2f}s "
          f"windowed(early/mid/late)=[{wdr[0]:+.3f},{wdr[1]:+.3f},{wdr[2]:+.3f}] drift={drift:.3f}s")

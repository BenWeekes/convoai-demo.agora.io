#!/usr/bin/env python3
"""
align_peak.py  --  peak-anchored, per-phrase piecewise-linear video time-warp.

PURPOSE
-------
Avatar-vendor exports are recorded free-running: the avatar speaks the same
script as a reference ("anam") tile, but with its own pacing and a silent
lead-in.  A single flat time offset therefore cannot keep the mouth in sync
with the shared mux audio -- the drift accumulates across the clip.

This tool anchors on the *loud moments* of speech (the per-phrase energy
peaks).  It finds the RMS-envelope peaks of the reference audio and of the
vendor audio, matches them 1:1 in spoken order, and then warps the vendor
VIDEO with a piecewise-linear time map so that vendor-peak #k lands exactly on
reference-peak #k.  Between anchors each segment is linearly stretched or
squeezed (ffmpeg trim + setpts).  The result is a video-only mp4 whose mouth
motion lines up with the reference's audio at every phrase.

Attach the reference audio to the output afterwards (ffmpeg -i warped -i ref
-map 0:v -map 1:a) and the tile is self-consistent and lip-synced.

ALGORITHM
---------
1. Decode audio to mono f32 PCM @ 16 kHz   (ffmpeg -ac 1 -ar 16000 -f f32le -).
2. RMS envelope: frame window 400 samples, hop 160 samples (25 ms / 10 ms),
   then a ~5-frame moving-average smoother.
3. Peak pick (greedy, non-maximum suppression):
   - candidate = any frame whose smoothed RMS > 0.3 * global-max,
   - repeatedly take the highest remaining candidate,
   - forbid any other peak within +/- MIN_SPACING (1.0 s),
   - return the accepted peak times, sorted ascending.
4. Match ref/vendor peaks 1:1 in order.  Same script => counts should match
   (about 12 for the comparison track).  If they differ we match up to the
   smaller count IN ORDER and print a loud warning (we do NOT silently drop
   interior peaks -- a mismatch means you should fix --vendor-leadin or the
   threshold, not trust the output).
5. Build the piecewise-linear warp in the REFERENCE timeline:
      head : ref[0 .. r1]              <- vendor[0 .. v1]
      seg k: ref[r_k .. r_{k+1}]       <- vendor[v_k .. v_{k+1}]
      tail : ref[r_n .. refDur]        <- vendor[v_n .. vendorDur]
   Each segment is  trim=start:end, setpts=(PTS-STARTPTS)*(refDur/vendorDur),
   concatenated in order, then resampled to a constant frame rate.

Only numpy + ffmpeg/ffprobe are used (no librosa / scipy).

CLI
---
    python3 align_peak.py --ref REF.mp4 --vendor VENDOR.mp4 --out OUT.mp4 \
            [--vendor-leadin SECONDS] [--fps 30] [--threshold 0.3] \
            [--min-spacing 1.0]

--vendor-leadin trims the vendor export's silent intro BEFORE peak detection
(and shifts every vendor anchor by the same amount), so the first real phrase
is what gets matched to the reference's first phrase.
"""

import argparse
import subprocess
import sys

import numpy as np

SR = 16000          # analysis sample rate
WIN = 400           # RMS frame window (samples)  ~25 ms
HOP = 160           # RMS hop (samples)           ~10 ms  -> 100 frames/sec
SMOOTH = 5          # moving-average smoothing (frames)


def ffprobe_duration(path):
    """Return container duration in seconds (float)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def load_audio_mono_f32(path, leadin=0.0):
    """Decode to mono float32 PCM @ 16 kHz; drop the first `leadin` seconds."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path,
         "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    if leadin > 0:
        n = int(round(leadin * SR))
        x = x[n:] if n < len(x) else x[:0]
    return x


def rms_envelope(x):
    """Framed RMS envelope with a short moving-average smoother.

    Returns (env, times) where env[i] is the RMS of the frame centred near
    times[i] seconds.
    """
    if len(x) < WIN:
        return np.zeros(0), np.zeros(0)
    n_frames = 1 + (len(x) - WIN) // HOP
    env = np.empty(n_frames)
    for i in range(n_frames):
        s = i * HOP
        frame = x[s:s + WIN]
        env[i] = np.sqrt(np.mean(frame * frame))
    # moving-average smoothing over SMOOTH frames
    if SMOOTH > 1 and n_frames >= SMOOTH:
        kernel = np.ones(SMOOTH) / SMOOTH
        env = np.convolve(env, kernel, mode="same")
    # frame centre time
    times = (np.arange(n_frames) * HOP + WIN / 2.0) / SR
    return env, times


def pick_peaks(env, times, threshold=0.3, min_spacing=1.0):
    """Greedy non-maximum-suppression peak picker.

    candidate frames: env > threshold * max(env)
    take highest, suppress everything within +/- min_spacing, repeat.
    Returns peak times sorted ascending.
    """
    if len(env) == 0:
        return []
    mx = float(env.max())
    if mx <= 0:
        return []
    cand = np.where(env > threshold * mx)[0]
    order = cand[np.argsort(-env[cand])]      # highest first
    chosen = []
    chosen_t = []
    for idx in order:
        t = times[idx]
        if all(abs(t - ct) >= min_spacing for ct in chosen_t):
            chosen.append(idx)
            chosen_t.append(t)
    return sorted(times[i] for i in chosen)


def detect_peaks(path, leadin=0.0, threshold=0.3, min_spacing=1.0):
    x = load_audio_mono_f32(path, leadin=leadin)
    env, times = rms_envelope(x)
    peaks = pick_peaks(env, times, threshold, min_spacing)
    return peaks


def build_warp_filter(ref_peaks, ven_peaks, ref_dur, ven_dur,
                      leadin=0.0, fps=30):
    """Return (filter_complex_string, out_label) for the piecewise warp.

    Boundaries in the REFERENCE timeline:
        0, r1, r2, ... rn, ref_dur
    sourced from the VENDOR timeline (all vendor times shifted by `leadin`):
        leadin, leadin+v1, ... leadin+vn, leadin+ven_dur
    """
    n = min(len(ref_peaks), len(ven_peaks))
    rp = list(ref_peaks[:n])
    vp = list(ven_peaks[:n])

    # reference boundaries and matching vendor boundaries
    ref_bounds = [0.0] + rp + [ref_dur]
    ven_bounds = [0.0] + vp + [ven_dur]

    parts = []
    labels = []
    seg = 0
    for k in range(len(ref_bounds) - 1):
        rc, rd = ref_bounds[k], ref_bounds[k + 1]
        va, vb = ven_bounds[k], ven_bounds[k + 1]
        ref_len = rd - rc
        ven_len = vb - va
        if ref_len <= 1e-6 or ven_len <= 1e-6:
            continue
        scale = ref_len / ven_len          # >1 slows vendor down, <1 speeds up
        a = va + leadin
        b = vb + leadin
        lbl = f"s{seg}"
        parts.append(
            f"[0:v]trim=start={a:.6f}:end={b:.6f},"
            f"setpts=(PTS-STARTPTS)*{scale:.9f}[{lbl}]")
        labels.append(f"[{lbl}]")
        seg += 1

    concat = "".join(labels) + f"concat=n={seg}:v=1:a=0[cat]"
    # resample to constant fps and reset timestamps
    tail = f"[cat]fps={fps},setpts=N/({fps}*TB)[vout]"
    fc = ";".join(parts + [concat, tail])
    return fc, "[vout]"


def warp_video(vendor, out, ref_peaks, ven_peaks, ref_dur, ven_dur,
               leadin=0.0, fps=30):
    fc, out_label = build_warp_filter(
        ref_peaks, ven_peaks, ref_dur, ven_dur, leadin=leadin, fps=fps)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", vendor,
           "-filter_complex", fc, "-map", out_label,
           "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-preset", "medium", "-crf", "18", out]
    print("\n[warp ffmpeg]\n" + " ".join(cmd) + "\n")
    subprocess.run(cmd, check=True)


def fmt_peaks(peaks):
    return "  ".join(f"{p:6.3f}" for p in peaks)


def main():
    ap = argparse.ArgumentParser(description="Peak-anchored video time-warp")
    ap.add_argument("--ref", required=True, help="reference mp4 (sync target audio)")
    ap.add_argument("--vendor", required=True, help="vendor tile mp4 to warp")
    ap.add_argument("--out", required=True, help="output video-only mp4")
    ap.add_argument("--vendor-leadin", type=float, default=0.0,
                    help="seconds of silent intro to trim from vendor first")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--threshold", type=float, default=0.3,
                    help="peak candidate threshold as fraction of max RMS")
    ap.add_argument("--min-spacing", type=float, default=1.0,
                    help="minimum seconds between accepted peaks")
    args = ap.parse_args()

    ref_dur = ffprobe_duration(args.ref)
    ven_dur_full = ffprobe_duration(args.vendor)
    ven_dur = ven_dur_full - args.vendor_leadin   # effective, post-leadin

    ref_peaks = detect_peaks(args.ref, 0.0, args.threshold, args.min_spacing)
    ven_peaks = detect_peaks(args.vendor, args.vendor_leadin,
                             args.threshold, args.min_spacing)

    print("=" * 64)
    print(f"REF    {args.ref}  dur={ref_dur:.3f}s  peaks={len(ref_peaks)}")
    print(f"   {fmt_peaks(ref_peaks)}")
    print(f"VENDOR {args.vendor}  dur={ven_dur_full:.3f}s "
          f"(leadin {args.vendor_leadin:.3f}s -> eff {ven_dur:.3f}s)  "
          f"peaks={len(ven_peaks)}")
    print(f"   {fmt_peaks(ven_peaks)}")

    if len(ref_peaks) != len(ven_peaks):
        print("\n*** WARNING: peak counts differ "
              f"(ref={len(ref_peaks)}, vendor={len(ven_peaks)}). "
              "Matching up to the smaller count IN ORDER. "
              "Consider adjusting --vendor-leadin or --threshold. ***\n")

    n = min(len(ref_peaks), len(ven_peaks))
    print("\n1:1 MATCH (vendor-time -> ref-time):")
    for i in range(n):
        print(f"   #{i+1:2d}  {ven_peaks[i]:7.3f}  ->  {ref_peaks[i]:7.3f}")
    print("=" * 64)

    if n < 1:
        print("ERROR: no peaks matched; cannot warp.", file=sys.stderr)
        sys.exit(2)

    warp_video(args.vendor, args.out, ref_peaks, ven_peaks,
               ref_dur, ven_dur, leadin=args.vendor_leadin, fps=args.fps)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

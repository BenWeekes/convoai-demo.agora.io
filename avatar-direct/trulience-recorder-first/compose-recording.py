#!/usr/bin/env python3
"""Mux the recorder's own received audio/video, without lip-based alignment.

Video uses received CaptureTimeMs differences. PCM uses its sample count, with
the measured first-callback arrival offset. Raw per-callback clocks are retained
for diagnosing whether that reconstruction matches live receiver playout.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--height", type=int, default=480)
    args = parser.parse_args()
    os.umask(0o077)
    meta = json.loads((args.work / "meta.json").read_text())
    timestamps = [int(x) for x in (args.work / "video.timestamps").read_text().splitlines() if not x.startswith("#")]
    if not timestamps or any(y < x for x, y in zip(timestamps, timestamps[1:])):
        raise ValueError("Missing/non-monotonic video timestamps; inspect raw capture")
    if len(timestamps) != meta["frames"]:
        raise ValueError("Frame count and timestamps disagree")
    if args.height < 160 or args.height > 1920 or args.height % 2:
        raise ValueError("Output height must be even and between 160 and 1920")
    video = args.work / "video.mkv"
    subprocess.run(["mkvmerge", "-o", str(video), "--timestamps",
                    "0:" + str(args.work / "video.timestamps"), str(args.work / "recv.264")], check=True)
    # Preserve negative offsets by moving both tracks to a non-negative common
    # origin. No independent trim, speech alignment, or source audio replacement.
    offset = meta["audio_offset_ms"] / 1000
    origin = min(0, offset)
    filters = (f"[0:v]setpts=PTS+{-origin}/TB,scale=-2:{args.height}[v];"
               f"[1:a]asetpts=PTS+{offset-origin}/TB[a]")
    subprocess.run([
        "ffmpeg", "-v", "error", "-n", "-threads", "1", "-i", str(video),
        "-i", str(args.work / "audio.wav"), "-filter_complex", filters,
        "-map", "[v]", "-map", "[a]", "-fps_mode", "vfr",
        "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(args.output),
    ], check=True)
    print("Wrote", args.output, "with captured offset", meta["audio_offset_ms"], "ms; no trimming")


if __name__ == "__main__":
    main()

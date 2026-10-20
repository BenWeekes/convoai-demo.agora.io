#!/usr/bin/env python3
"""Record Agora first, then drive native-provider via convoai_to_video.

Credentials are read from the environment. This is a WAV-driven generic protocol
client, not a ConvoAI agent. No sleep/discard is used to hide startup behavior.
"""
import argparse
import asyncio
import base64
import contextlib
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time
import uuid
import wave

import requests
import websockets


class Recorder:
    def __init__(self, executable, config, work):
        self.events = queue.Queue()
        self.log = (work / "rec.log").open("w")
        self.process = subprocess.Popen(
            [str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.log, text=True, cwd=work,
        )
        self.process.stdin.write(json.dumps(config))
        self.process.stdin.close()
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        for line in self.process.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                self.log.write(line)
                self.log.flush()
                continue
            if not isinstance(event, dict):
                continue
            # Ready's short-lived publisher token only crosses this private pipe.
            self.log.write(json.dumps({k: v for k, v in event.items() if k != "publisherToken"}) + "\n")
            self.log.flush()
            self.events.put(event)

    async def ready(self):
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            try:
                event = self.events.get_nowait()
                if event.get("event") == "ready":
                    return event
            except queue.Empty:
                pass
            self.check()
            await asyncio.sleep(.02)
        raise RuntimeError("Recorder did not confirm RTC join")

    def check(self):
        if self.process.poll() is not None:
            raise RuntimeError(f"Recorder exited ({self.process.returncode}); inspect private rec.log")

    async def close(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGINT)
        try:
            code = await asyncio.to_thread(self.process.wait, timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            await asyncio.to_thread(self.process.wait)
            raise RuntimeError("Recorder did not stop cleanly")
        finally:
            await asyncio.to_thread(self.thread.join, 2)
            self.log.close()
        if code != 0:
            raise RuntimeError(f"Recorder failed ({code}); inspect private rec.log")


def request(base, key, route, method, body=None):
    response = requests.request(
        method, base + route, headers={"x-api-key": key},
        json=body, timeout=100 if method == "POST" else 20,
    )
    if not response.ok:
        # Do not print request headers, WSS addresses or untrusted response bodies.
        raise RuntimeError(f"Provider {method} {route}: HTTP {response.status_code}")
    return response.json() if response.content else {}


async def capture(args, recorder_factory=Recorder, request_fn=request, connect=websockets.connect):
    app, cert = os.environ["AGORA_APP_ID"], os.environ.get("AGORA_APP_CERTIFICATE", "")
    key = os.environ["API_KEY"]
    with wave.open(str(args.wav), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 24000):
            raise ValueError("WAV must be PCM16, 24 kHz, mono")
        pcm = source.readframes(source.getnframes())
    if not pcm or len(pcm) > 24000 * 2 * 120:
        raise ValueError("WAV must contain between 0 and 120 seconds of audio")
    channel = "trl-record-" + uuid.uuid4().hex[:12]
    timeline = {"channel": channel, "source_samples": len(pcm)//2,
                "source_duration_s": len(pcm)/48000, "voice_chunks": 0,
                "warmup_s": 0, "discard_s": 0}
    mark = lambda name: timeline.update({name: time.time_ns()//1000000})
    config = {"appId": app, "certificate": cert, "channel": channel,
              "publisherUid": "102", "subscriberUid": "103", "directory": str(args.work)}
    recorder = recorder_factory(args.recorder, config, args.work)
    session = ws = listener = None
    failure = None
    errors = []
    try:
        ready = await recorder.ready()
        timeline["recorder_ready_ms"] = ready["epochMs"]
        settings = {"app_id": app, "token": ready["publisherToken"], "channel": channel,
                    "uid": "102", "enable_string_uid": False}
        body = {"avatar_id": args.avatar, "quality": "high", "version": "v1",
                "video_encoding": "H264", "agora_settings": settings,
                "width": args.width, "height": args.height, "fps": 30}
        if args.environment:
            body["environment"] = args.environment
        mark("start_request_ms")
        session = await asyncio.to_thread(request_fn, args.base, key, "/session/start", "POST", body)
        mark("start_response_ms")
        timeline["session_id"] = session["session_id"]
        # The exact token is retained in memory for Stop, not written to reports.
        ws = await connect(
            session["websocket_address"],
            additional_headers={"Authorization": "Bearer " + session["session_token"]},
            open_timeout=30, max_size=1048576,
        )
        mark("ws_open_ms")

        async def listen():
            async for raw in ws:
                event = json.loads(raw)
                if event.get("command") == "error":
                    raise RuntimeError("Provider reported a WebSocket error")
            raise RuntimeError("Provider closed WebSocket before test Stop")

        listener = asyncio.create_task(listen())
        await ws.send(json.dumps({"command": "init", "session_id": session["session_id"], **body}))
        mark("init_sent_ms")
        start = asyncio.get_running_loop().time()
        # Send the first real speech chunk immediately after init; no pre-roll,
        # receiver discard, first-frame gate, or extra model warmup here.
        for offset in range(0, len(pcm), 2880):
            recorder.check()
            if listener.done():
                await listener
            if offset == 0:
                mark("first_voice_ms")
            chunk = pcm[offset:offset+2880]
            await ws.send(json.dumps({
                "command": "voice", "event_id": uuid.uuid4().hex,
                "encoding": "PCM16", "sampleRate": 24000,
                "audio": base64.b64encode(chunk).decode("ascii"),
            }))
            timeline["voice_chunks"] += 1
            remaining = start + (offset+len(chunk))/48000 - asyncio.get_running_loop().time()
            if remaining > 0:
                await asyncio.sleep(remaining)
        await ws.send(json.dumps({"command": "voice_end", "event_id": uuid.uuid4().hex}))
        mark("voice_end_ms")
        # Tail captures queued rendering/playout. This is after all speech input.
        end = asyncio.get_running_loop().time() + args.tail
        while asyncio.get_running_loop().time() < end:
            recorder.check()
            if listener.done():
                await listener
            await asyncio.sleep(.05)
        mark("capture_complete_ms")
    except BaseException as exc:
        failure = exc
    finally:
        if listener:
            listener.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await listener
        # Stop with the exact returned session token, even after WSS/media failure.
        if session:
            try:
                await asyncio.to_thread(request_fn, args.base, key, "/session/stop", "DELETE",
                                        {k: session[k] for k in ("session_id", "session_token")})
                timeline["stop_ok"] = True
            except Exception as exc:
                timeline["stop_ok"] = False
                errors.append(exc)
        if ws:
            with contextlib.suppress(Exception):
                await ws.close()
        try:
            await recorder.close()
        except Exception as exc:
            errors.append(exc)
        mark("finished_ms")
        timeline["passed_transport"] = failure is None and not errors
        (args.work / "timeline.json").write_text(json.dumps(timeline, indent=2) + "\n")
    if failure:
        raise failure
    if errors:
        raise errors[0]
    return timeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("API_BASE"), required=not os.environ.get("API_BASE"))
    parser.add_argument("--avatar", default=os.environ.get("AVATAR_ID"), required=not os.environ.get("AVATAR_ID"))
    parser.add_argument("--environment", choices=("production", "staging"), default=os.environ.get("ENVIRONMENT"))
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True, help="New private output directory")
    parser.add_argument("--recorder", type=Path, required=True)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--tail", type=float, default=6, help="Seconds to record after voice_end")
    args = parser.parse_args()
    args.base = args.base.rstrip("/")
    if not 1 <= args.tail <= 20:
        parser.error("--tail must be between 1 and 20 seconds")
    os.umask(0o077)
    args.work = args.work.absolute()
    args.wav = args.wav.absolute()
    args.recorder = args.recorder.absolute()
    if not args.recorder.is_file():
        parser.error("--recorder must be a built receiver executable")
    args.work.mkdir(mode=0o700, parents=True, exist_ok=False)
    result = asyncio.run(capture(args))
    print(json.dumps(result, indent=2))
    print("Capture complete. Inspect A/V; transport success alone does not prove lip sync.")


if __name__ == "__main__":
    main()

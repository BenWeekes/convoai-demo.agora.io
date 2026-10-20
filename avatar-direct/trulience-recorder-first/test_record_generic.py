"""Verify receiver-first ordering, immediate voice and owned failure cleanup."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

spec = importlib.util.spec_from_file_location("record_generic", Path(__file__).with_name("record-generic.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class DriverTest(unittest.IsolatedAsyncioTestCase):
    async def run_capture(self, failure=None):
        events = []

        class Receiver:
            def __init__(self, *args):
                events.append("receiver_started")

            async def ready(self):
                if failure == "join":
                    raise RuntimeError("join failed")
                events.append("joined")
                return {"epochMs": 1, "publisherToken": "private-rtc-token"}

            def check(self):
                pass

            async def close(self):
                events.append("receiver_closed")

        def request(base, key, route, method, body=None):
            if method == "POST":
                self.assertEqual(events, ["receiver_started", "joined"])
                self.assertEqual(body["agora_settings"]["token"], "private-rtc-token")
                events.append("start")
                if failure == "start":
                    raise RuntimeError("start failed")
                return {"session_id": "owned-session", "session_token": "private-stop-token",
                        "websocket_address": "wss://test.invalid"}
            self.assertEqual(body, {"session_id": "owned-session", "session_token": "private-stop-token"})
            events.append("stop")
            return {}

        class WS:
            async def send(self, raw):
                e = json.loads(raw)
                events.append(e["command"])
                if failure == "voice" and e["command"] == "voice":
                    raise RuntimeError("voice failed")

            def __aiter__(self):
                return self

            async def __anext__(self):
                await asyncio.Future()

            async def close(self):
                events.append("ws_closed")

        async def connect(*args, **kwargs):
            if failure == "ws":
                raise RuntimeError("ws failed")
            events.append("ws")
            return WS()

        with TemporaryDirectory() as tmp, patch.dict(os.environ, {"AGORA_APP_ID": "test", "API_KEY": "private-key"}):
            work = Path(tmp)
            wav = work / "in.wav"
            with wave.open(str(wav), "wb") as f:
                f.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                f.writeframes(b"\x01\x00" * 1440)
            args = SimpleNamespace(wav=wav, recorder="unused", work=work, avatar="305",
                                   width=1280, height=720, environment=None, base="https://test.invalid", tail=0)
            if failure:
                with self.assertRaisesRegex(RuntimeError, failure):
                    await driver.capture(args, Receiver, request, connect)
            else:
                await driver.capture(args, Receiver, request, connect)
            report_text = (work / "timeline.json").read_text()
            self.assertNotIn("private-", report_text)
            return events, json.loads(report_text)

    async def test_recorder_joins_before_start_and_voice_is_immediate(self):
        events, report = await self.run_capture()
        self.assertEqual(events, ["receiver_started", "joined", "start", "ws", "init", "voice",
                                  "voice_end", "stop", "ws_closed", "receiver_closed"])
        self.assertLess(report["first_voice_ms"] - report["init_sent_ms"], 100)
        self.assertEqual(report["source_samples"], 1440)
        self.assertTrue(report["passed_transport"])

    async def test_no_provider_start_if_receiver_join_fails(self):
        events, report = await self.run_capture("join")
        self.assertEqual(events, ["receiver_started", "receiver_closed"])
        self.assertFalse(report["passed_transport"])

    async def test_stop_after_websocket_failure(self):
        events, report = await self.run_capture("ws")
        self.assertEqual(events[-2:], ["stop", "receiver_closed"])
        self.assertTrue(report["stop_ok"])

    async def test_stop_after_voice_failure(self):
        events, report = await self.run_capture("voice")
        self.assertEqual(events[-3:], ["stop", "ws_closed", "receiver_closed"])
        self.assertFalse(report["passed_transport"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import time
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server
from fastapi.testclient import TestClient


class LocalVoiceCacheTests(unittest.TestCase):
  def test_tts_cache_key_is_stable_and_changes_with_inputs(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      prompt = Path(tmp) / "reference.wav"
      prompt.write_bytes(b"voice-a")
      payload = server.TtsRequest(text="Xin chao", voiceId="main_voice", language="vi")

      first = server.build_tts_cache_key("main_voice", prompt, "Xin chao", "vi", payload)
      second = server.build_tts_cache_key("main_voice", prompt, "Xin chao", "vi", payload)
      changed_text = server.build_tts_cache_key("main_voice", prompt, "Xin chao ban", "vi", payload)

      prompt.write_bytes(b"voice-a-new")
      changed_prompt = server.build_tts_cache_key("main_voice", prompt, "Xin chao", "vi", payload)

      self.assertEqual(first, second)
      self.assertNotEqual(first, changed_text)
      self.assertNotEqual(first, changed_prompt)

  def test_audio_cache_round_trips_bytes_and_metadata(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      original_cache_dir = server.AUDIO_CACHE_DIR
      server.AUDIO_CACHE_DIR = Path(tmp)
      try:
        server.write_audio_cache("abc123", b"RIFFtest", {"voiceId": "voice_1"})
        cached = server.read_audio_cache("abc123")
      finally:
        server.AUDIO_CACHE_DIR = original_cache_dir

      self.assertIsNotNone(cached)
      self.assertEqual(cached["bytes"], b"RIFFtest")
      self.assertEqual(cached["metadata"]["voiceId"], "voice_1")
      self.assertEqual(cached["metadata"]["cacheKey"], "abc123")


class LocalVoiceJobTests(unittest.TestCase):
  def test_job_endpoint_completes_and_serves_audio(self) -> None:
    original_synthesize = server.synthesize_tts_audio

    def fake_synthesize(payload):
      return {
        "bytes": b"RIFFjob",
        "filename": "job.wav",
        "cache": "MISS",
      }

    server.synthesize_tts_audio = fake_synthesize
    try:
      client = TestClient(server.app)
      created = client.post("/jobs", json={"text": "Xin chao", "voiceId": "voice_1", "language": "vi"})
      self.assertEqual(created.status_code, 200)
      job_id = created.json()["jobId"]

      status = {}
      for _ in range(30):
        status = client.get(f"/jobs/{job_id}").json()
        if status["status"] == "done":
          break
        time.sleep(0.02)

      self.assertEqual(status["status"], "done")
      self.assertEqual(status["audioUrl"], f"/jobs/{job_id}/audio")
      audio = client.get(f"/jobs/{job_id}/audio")
      self.assertEqual(audio.status_code, 200)
      self.assertEqual(audio.content, b"RIFFjob")
    finally:
      server.synthesize_tts_audio = original_synthesize


if __name__ == "__main__":
  unittest.main()

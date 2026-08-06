from __future__ import annotations

import io
import json
import os
import re
import shutil
import sys
import threading
import time
import unicodedata
import uuid
import builtins
import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


for stream in (sys.stdout, sys.stderr):
  if hasattr(stream, "reconfigure"):
    try:
      stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
      pass

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("LOCAL_VOICE_DATA_DIR", APP_DIR / "data")).resolve()
VOICES_DIR = DATA_DIR / "voices"
OUTPUT_DIR = DATA_DIR / "outputs"
AUDIO_CACHE_DIR = DATA_DIR / "audio-cache"
LATENT_CACHE_DIR = DATA_DIR / "latent-cache"
MODEL_DIR = Path(os.getenv("LOCAL_VOICE_MODEL_DIR", DATA_DIR / "models" / "vixtts")).resolve()
VIXTTS_TTS_SOURCE_DIR = Path(
  os.getenv("LOCAL_VOICE_VIXTTS_TTS_DIR", APP_DIR / "vendors" / "vixtts-demo" / "TTS")
).resolve()
VIXTTS_REPO_ID = os.getenv("LOCAL_VOICE_VIXTTS_REPO", "capleaf/viXTTS")
DEFAULT_LANGUAGE = os.getenv("LOCAL_VOICE_LANGUAGE", "vi")
DEFAULT_DEVICE = os.getenv("LOCAL_VOICE_DEVICE", "auto")
DEFAULT_ENGINE = os.getenv("LOCAL_VOICE_ENGINE", "vixtts").strip().lower()
API_TOKEN = os.getenv("LOCAL_VOICE_TOKEN", "").strip()

VOICE_ID_RE = re.compile(r"[^a-zA-Z0-9_.-]+")
MODEL_LOCK = threading.Lock()
MODEL: Any | None = None
TORCHAUDIO: Any | None = None
VIXTTS_LATENT_CACHE: dict[tuple[str, float, float, bool], tuple[Any, Any]] = {}
JOB_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.getenv("LOCAL_VOICE_MAX_WORKERS", "1")))
JOB_LOCK = threading.Lock()
JOBS: dict[str, dict[str, Any]] = {}


def now_ms() -> int:
  return int(time.time() * 1000)


def sanitize_voice_id(value: str | None, fallback: str | None = None) -> str:
  raw = (value or fallback or f"voice_{uuid.uuid4().hex[:8]}").strip().lower()
  raw = unicodedata.normalize("NFKD", raw)
  raw = raw.encode("ascii", "ignore").decode("ascii")
  raw = VOICE_ID_RE.sub("_", raw).strip("._-")
  return raw or f"voice_{uuid.uuid4().hex[:8]}"


def require_token(authorization: str | None) -> None:
  if not API_TOKEN:
    return
  expected = f"Bearer {API_TOKEN}"
  if authorization != expected and authorization != API_TOKEN:
    raise HTTPException(status_code=401, detail="Sai token Local Voice Server.")


def ensure_dirs() -> None:
  VOICES_DIR.mkdir(parents=True, exist_ok=True)
  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
  AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
  LATENT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
  MODEL_DIR.mkdir(parents=True, exist_ok=True)


def voice_dir(voice_id: str) -> Path:
  return VOICES_DIR / sanitize_voice_id(voice_id)


def metadata_path(voice_id: str) -> Path:
  return voice_dir(voice_id) / "metadata.json"


def reference_audio_path(voice_id: str) -> Path:
  meta = read_voice_metadata(voice_id)
  path = meta.get("referenceAudioPath")
  if path:
    return Path(path)
  candidates = list(voice_dir(voice_id).glob("reference.*"))
  if candidates:
    return candidates[0]
  raise HTTPException(status_code=404, detail=f"Không tìm thấy audio mẫu cho voiceId {voice_id}.")


def read_voice_metadata(voice_id: str) -> dict[str, Any]:
  path = metadata_path(voice_id)
  if not path.exists():
    return {}
  return json.loads(path.read_text(encoding="utf-8"))


def write_voice_metadata(voice_id: str, metadata: dict[str, Any]) -> None:
  directory = voice_dir(voice_id)
  directory.mkdir(parents=True, exist_ok=True)
  metadata_path(voice_id).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def list_voices() -> list[dict[str, Any]]:
  ensure_dirs()
  voices = []
  for item in sorted(VOICES_DIR.iterdir()):
    if not item.is_dir():
      continue
    meta = read_voice_metadata(item.name)
    if meta:
      voices.append(meta)
  return voices


def normalize_text(text: str) -> str:
  cleaned = " ".join(str(text or "").replace("\r", "\n").split())
  if not cleaned:
    raise HTTPException(status_code=400, detail="Thiếu text để tạo giọng.")
  if cleaned[-1] not in ".!?…":
    cleaned = f"{cleaned}."
  return cleaned


def file_fingerprint(path: Path) -> dict[str, Any]:
  stat = path.stat()
  return {
    "path": str(path.resolve()),
    "size": stat.st_size,
    "mtimeNs": stat.st_mtime_ns,
  }


def build_tts_cache_key(voice_id: str, prompt_path: Path, text: str, language: str, payload: "TtsRequest") -> str:
  fingerprint = {
    "engine": DEFAULT_ENGINE,
    "repo": VIXTTS_REPO_ID,
    "voiceId": sanitize_voice_id(voice_id),
    "prompt": file_fingerprint(prompt_path),
    "text": normalize_text(text),
    "language": (language or DEFAULT_LANGUAGE).strip().lower(),
    "temperature": payload.temperature,
    "lengthPenalty": payload.length_penalty,
    "repetitionPenalty": payload.repetition_penalty,
    "topK": payload.top_k,
    "topP": payload.top_p,
    "speed": payload.speed,
    "sentenceGapMs": payload.sentence_gap_ms,
  }
  encoded = json.dumps(fingerprint, ensure_ascii=False, sort_keys=True).encode("utf-8")
  return hashlib.sha256(encoded).hexdigest()


def audio_cache_paths(cache_key: str) -> tuple[Path, Path]:
  safe_key = re.sub(r"[^a-fA-F0-9]", "", cache_key)[:64]
  if not safe_key:
    safe_key = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()
  return AUDIO_CACHE_DIR / f"{safe_key}.wav", AUDIO_CACHE_DIR / f"{safe_key}.json"


def read_audio_cache(cache_key: str) -> dict[str, Any] | None:
  audio_path, meta_path = audio_cache_paths(cache_key)
  if not audio_path.exists() or not meta_path.exists():
    return None
  try:
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    return {
      "bytes": audio_path.read_bytes(),
      "metadata": metadata,
      "path": str(audio_path),
    }
  except Exception:
    return None


def write_audio_cache(cache_key: str, audio_bytes: bytes, metadata: dict[str, Any]) -> Path:
  ensure_dirs()
  audio_path, meta_path = audio_cache_paths(cache_key)
  audio_path.write_bytes(audio_bytes)
  meta = {
    **metadata,
    "cacheKey": cache_key,
    "createdAt": now_ms(),
    "audioPath": str(audio_path),
  }
  meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
  return audio_path


def build_latent_cache_key(prompt_path: Path, model: Any) -> str:
  fingerprint = {
    "engine": DEFAULT_ENGINE,
    "repo": VIXTTS_REPO_ID,
    "prompt": file_fingerprint(prompt_path),
    "gptCondLen": float(model.config.gpt_cond_len),
    "maxRefLen": float(model.config.max_ref_len),
    "soundNormRefs": bool(model.config.sound_norm_refs),
  }
  encoded = json.dumps(fingerprint, ensure_ascii=False, sort_keys=True).encode("utf-8")
  return hashlib.sha256(encoded).hexdigest()


def latent_cache_path(cache_key: str) -> Path:
  return LATENT_CACHE_DIR / f"{cache_key}.pt"


def model_device(model: Any) -> Any:
  return getattr(model, "device", None)


def move_tensor(value: Any, device: Any) -> Any:
  if device is not None and hasattr(value, "to"):
    return value.to(device)
  return value


def add_silence_gap(chunks: list[Any], sample_rate: int, gap_ms: int) -> list[Any]:
  if gap_ms <= 0 or len(chunks) < 2:
    return chunks
  import torch

  gap_samples = max(1, int(sample_rate * gap_ms / 1000))
  result = []
  for index, chunk in enumerate(chunks):
    if index > 0:
      result.append(torch.zeros(gap_samples, dtype=chunk.dtype, device=chunk.device))
    result.append(chunk)
  return result


def resolve_device() -> str:
  if DEFAULT_DEVICE and DEFAULT_DEVICE != "auto":
    return DEFAULT_DEVICE
  try:
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"
  except Exception:
    return "cpu"


def get_model() -> Any:
  global MODEL, TORCHAUDIO
  if MODEL is not None:
    return MODEL

  with MODEL_LOCK:
    if MODEL is not None:
      return MODEL
    if DEFAULT_ENGINE != "vixtts":
      raise HTTPException(status_code=400, detail=f"Engine local clone chưa hỗ trợ: {DEFAULT_ENGINE}.")

    MODEL = load_vixtts_model()
    return MODEL


def load_vixtts_model() -> Any:
  global TORCHAUDIO
  ensure_dirs()
  if str(VIXTTS_TTS_SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(VIXTTS_TTS_SOURCE_DIR))

  try:
    import torch
    import torchaudio as ta
    from huggingface_hub import hf_hub_download, snapshot_download
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
  except Exception as exc:
    raise HTTPException(
      status_code=500,
      detail=(
        "Chưa cài đủ viXTTS. Chạy scripts/setup-local-voice-server.ps1 rồi thử lại. "
        f"Lỗi gốc: {exc}"
      ),
    ) from exc

  required_files = ["model.pth", "config.json", "vocab.json", "speakers_xtts.pth"]
  if not all((MODEL_DIR / file_name).exists() for file_name in required_files):
    snapshot_download(repo_id=VIXTTS_REPO_ID, repo_type="model", local_dir=str(MODEL_DIR))
    hf_hub_download(repo_id="coqui/XTTS-v2", filename="speakers_xtts.pth", local_dir=str(MODEL_DIR))

  if hasattr(torch.serialization, "add_safe_globals"):
    try:
      torch.serialization.add_safe_globals([XttsConfig])
    except Exception:
      pass

  config = XttsConfig()
  config.load_json(str(MODEL_DIR / "config.json"))
  model = Xtts.init_from_config(config)
  use_deepspeed = os.getenv("LOCAL_VOICE_USE_DEEPSPEED", "").strip().lower() in { "1", "true", "yes" }
  model.load_checkpoint(config, checkpoint_dir=str(MODEL_DIR), use_deepspeed=use_deepspeed)
  device = resolve_device()
  if device == "cuda":
    model.cuda()

  TORCHAUDIO = ta
  return model


def tensor_to_wav_bytes(wav: Any, sample_rate: int) -> bytes:
  if TORCHAUDIO is None:
    raise HTTPException(status_code=500, detail="Torchaudio chưa sẵn sàng.")
  buffer = io.BytesIO()
  TORCHAUDIO.save(buffer, wav.cpu(), sample_rate, format="wav")
  return buffer.getvalue()


def normalize_vietnamese_text(text: str) -> str:
  try:
    from vinorm import TTSnorm
  except Exception:
    return text
  original_open = builtins.open

  def utf8_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
    path = str(file).replace("\\", "/")
    if (path.endswith("/vinorm/input.txt") or path.endswith("/vinorm/output.txt")) and "b" not in mode:
      kwargs.setdefault("encoding", "utf-8")
    return original_open(file, mode, *args, **kwargs)

  try:
    builtins.open = utf8_open
    normalized = TTSnorm(text, unknown=False, lower=False, rule=True)
  except Exception:
    normalized = text
  finally:
    builtins.open = original_open

  return (
    normalized
    .replace("..", ".")
    .replace("!.", "!")
    .replace("?.", "?")
    .replace(" .", ".")
    .replace(" ,", ",")
    .replace('"', "")
    .replace("'", "")
    .replace("AI", "Ây Ai")
    .replace("A.I", "Ây Ai")
  )


def split_tts_sentences(text: str, language: str) -> list[str]:
  if language in { "ja", "zh", "zh-cn" }:
    return [part.strip() for part in text.split("。") if part.strip()]
  try:
    from underthesea import sent_tokenize
    sentences = sent_tokenize(text)
  except Exception:
    sentences = re.split(r"(?<=[.!?])\s+", text)
  return [sentence.strip() for sentence in sentences if sentence.strip()]


def calculate_keep_len(text: str, language: str) -> int:
  if language in { "ja", "zh", "zh-cn" }:
    return -1
  word_count = len(text.split())
  num_punct = text.count(".") + text.count("!") + text.count("?") + text.count(",")
  if word_count < 5:
    return 15000 * word_count + 2000 * num_punct
  if word_count < 10:
    return 13000 * word_count + 2000 * num_punct
  return -1


def generate_vixtts_audio(model: Any, text: str, prompt_path: Path, language: str, payload: "TtsRequest") -> tuple[Any, int]:
  import torch

  if language == "zh":
    language = "zh-cn"
  if language == "vi":
    text = normalize_vietnamese_text(text)

  cache_key = (
    str(prompt_path.resolve()),
    float(model.config.gpt_cond_len),
    float(model.config.max_ref_len),
    bool(model.config.sound_norm_refs),
  )
  if cache_key in VIXTTS_LATENT_CACHE:
    gpt_cond_latent, speaker_embedding = VIXTTS_LATENT_CACHE[cache_key]
  else:
    latent_key = build_latent_cache_key(prompt_path, model)
    latent_path = latent_cache_path(latent_key)
    if latent_path.exists():
      data = torch.load(latent_path, map_location=model_device(model), weights_only=False)
      gpt_cond_latent = move_tensor(data["gptCondLatent"], model_device(model))
      speaker_embedding = move_tensor(data["speakerEmbedding"], model_device(model))
    else:
      gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
        audio_path=str(prompt_path),
        gpt_cond_len=model.config.gpt_cond_len,
        max_ref_length=model.config.max_ref_len,
        sound_norm_refs=model.config.sound_norm_refs,
      )
      try:
        torch.save({
          "gptCondLatent": gpt_cond_latent.detach().cpu(),
          "speakerEmbedding": speaker_embedding.detach().cpu(),
        }, latent_path)
      except Exception:
        pass
    VIXTTS_LATENT_CACHE[cache_key] = (gpt_cond_latent, speaker_embedding)

  chunks = []
  sample_rate = 24000
  for sentence in split_tts_sentences(text, language):
    wav_chunk = model.inference(
      text=sentence,
      language=language,
      gpt_cond_latent=gpt_cond_latent,
      speaker_embedding=speaker_embedding,
      temperature=payload.temperature,
      length_penalty=payload.length_penalty,
      repetition_penalty=payload.repetition_penalty,
      top_k=payload.top_k,
      top_p=payload.top_p,
      speed=payload.speed,
      enable_text_splitting=True,
    )
    wav = torch.tensor(wav_chunk["wav"])
    keep_len = calculate_keep_len(sentence, language)
    if keep_len > 0:
      wav = wav[:keep_len]
    chunks.append(wav)

  if not chunks:
    raise HTTPException(status_code=400, detail="Không tách được câu nào để tạo giọng.")
  chunks = add_silence_gap(chunks, sample_rate, payload.sentence_gap_ms)
  return torch.cat(chunks, dim=0).unsqueeze(0), sample_rate


class TtsRequest(BaseModel):
  text: str
  voiceId: str | None = None
  voice_id: str | None = None
  language: str = Field(default=DEFAULT_LANGUAGE)
  format: str = Field(default="wav")
  temperature: float = Field(default=0.25, ge=0.01, le=2.0)
  length_penalty: float = Field(default=1.0, ge=0.1, le=5.0)
  repetition_penalty: float = Field(default=8.0, ge=1.0, le=20.0)
  top_k: int = Field(default=25, ge=1, le=100)
  top_p: float = Field(default=0.75, ge=0.01, le=1.0)
  speed: float = Field(default=0.95, ge=0.5, le=1.5)
  sentence_gap_ms: int = Field(default=120, ge=0, le=1000)


def synthesize_tts_audio(payload: TtsRequest) -> dict[str, Any]:
  voice_id = sanitize_voice_id(payload.voiceId or payload.voice_id)
  prompt_path = reference_audio_path(voice_id)
  text = normalize_text(payload.text)
  language = (payload.language or DEFAULT_LANGUAGE).strip().lower() or DEFAULT_LANGUAGE
  cache_key = build_tts_cache_key(voice_id, prompt_path, text, language, payload)

  cached = read_audio_cache(cache_key)
  if cached:
    return {
      "bytes": cached["bytes"],
      "filename": f"{voice_id}_cached.wav",
      "cache": "HIT",
      "cacheKey": cache_key,
      "metadata": cached["metadata"],
    }

  model = get_model()
  try:
    wav, sample_rate = generate_vixtts_audio(model, text, prompt_path, language, payload)
    audio_bytes = tensor_to_wav_bytes(wav, sample_rate)
  except HTTPException:
    raise
  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Lỗi tạo giọng Local Clone viXTTS: {exc}") from exc

  output_path = OUTPUT_DIR / f"{voice_id}_{now_ms()}.wav"
  output_path.write_bytes(audio_bytes)
  write_audio_cache(cache_key, audio_bytes, {
    "voiceId": voice_id,
    "language": language,
    "text": text,
    "outputPath": str(output_path),
    "engine": DEFAULT_ENGINE,
  })
  return {
    "bytes": audio_bytes,
    "filename": output_path.name,
    "cache": "MISS",
    "cacheKey": cache_key,
    "outputPath": str(output_path),
  }


def run_job(job_id: str, payload: TtsRequest) -> None:
  with JOB_LOCK:
    if job_id in JOBS:
      JOBS[job_id]["status"] = "running"
      JOBS[job_id]["startedAt"] = now_ms()
  try:
    result = synthesize_tts_audio(payload)
    with JOB_LOCK:
      JOBS[job_id].update({
        "status": "done",
        "finishedAt": now_ms(),
        "audio": result["bytes"],
        "filename": result["filename"],
        "cache": result.get("cache", "MISS"),
        "audioUrl": f"/jobs/{job_id}/audio",
      })
  except Exception as exc:
    detail = getattr(exc, "detail", None) or str(exc)
    with JOB_LOCK:
      if job_id in JOBS:
        JOBS[job_id].update({
          "status": "error",
          "finishedAt": now_ms(),
          "error": detail,
        })


app = FastAPI(title="ViCompare Local Voice Clone Server", version="1.0.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
  ensure_dirs()
  return {
    "ok": True,
    "engine": DEFAULT_ENGINE,
    "device": resolve_device(),
    "modelLoaded": MODEL is not None,
    "language": DEFAULT_LANGUAGE,
    "voices": len(list_voices()),
    "modelDir": str(MODEL_DIR),
  }


@app.get("/voices")
def get_voices(authorization: str | None = Header(default=None)) -> dict[str, Any]:
  require_token(authorization)
  return { "voices": list_voices() }


@app.post("/voices")
async def create_voice(
  audio: UploadFile = File(...),
  voice_id: str | None = Form(default=None),
  name: str | None = Form(default=None),
  authorization: str | None = Header(default=None),
) -> dict[str, Any]:
  require_token(authorization)
  ensure_dirs()

  original_name = audio.filename or "reference.wav"
  suffix = Path(original_name).suffix.lower() or ".wav"
  if suffix not in { ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm" }:
    raise HTTPException(status_code=400, detail="File mẫu nên là wav/mp3/m4a/flac/ogg/webm.")

  new_voice_id = sanitize_voice_id(voice_id, name)
  directory = voice_dir(new_voice_id)
  directory.mkdir(parents=True, exist_ok=True)
  ref_path = directory / f"reference{suffix}"

  with ref_path.open("wb") as file:
    shutil.copyfileobj(audio.file, file)

  metadata = {
    "id": new_voice_id,
    "name": (name or new_voice_id).strip(),
    "originalFileName": original_name,
    "referenceAudioPath": str(ref_path),
    "createdAt": now_ms(),
    "engine": DEFAULT_ENGINE,
    "language": DEFAULT_LANGUAGE,
  }
  write_voice_metadata(new_voice_id, metadata)
  return { "voice": metadata, "voiceId": new_voice_id }


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
  require_token(authorization)
  target = voice_dir(voice_id)
  if not target.exists():
    raise HTTPException(status_code=404, detail="Voice không tồn tại.")
  shutil.rmtree(target)
  return { "ok": True, "voiceId": sanitize_voice_id(voice_id) }


@app.post("/jobs")
def create_tts_job(payload: TtsRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
  require_token(authorization)
  job_id = uuid.uuid4().hex
  with JOB_LOCK:
    JOBS[job_id] = {
      "id": job_id,
      "status": "queued",
      "createdAt": now_ms(),
      "voiceId": sanitize_voice_id(payload.voiceId or payload.voice_id),
    }
  JOB_EXECUTOR.submit(run_job, job_id, payload)
  return {
    "ok": True,
    "jobId": job_id,
    "status": "queued",
    "statusUrl": f"/jobs/{job_id}",
  }


@app.get("/jobs/{job_id}")
def get_tts_job(job_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
  require_token(authorization)
  with JOB_LOCK:
    job = JOBS.get(job_id)
    if not job:
      raise HTTPException(status_code=404, detail="Job không tồn tại.")
    return { key: value for key, value in job.items() if key != "audio" }


@app.get("/jobs/{job_id}/audio")
def get_tts_job_audio(job_id: str, authorization: str | None = Header(default=None)) -> Response:
  require_token(authorization)
  with JOB_LOCK:
    job = JOBS.get(job_id)
    if not job:
      raise HTTPException(status_code=404, detail="Job không tồn tại.")
    if job.get("status") != "done":
      raise HTTPException(status_code=409, detail="Job chưa tạo xong audio.")
    audio = job.get("audio")
    filename = job.get("filename") or f"{job_id}.wav"
    cache_status = job.get("cache") or "MISS"
  return Response(audio, media_type="audio/wav", headers={
    "Content-Disposition": f'inline; filename="{filename}"',
    "X-Local-Voice-Cache": cache_status,
  })


@app.post("/tts")
def text_to_speech(payload: TtsRequest, authorization: str | None = Header(default=None)) -> Response:
  require_token(authorization)
  result = synthesize_tts_audio(payload)
  return Response(result["bytes"], media_type="audio/wav", headers={
    "Content-Disposition": f'inline; filename="{result["filename"]}"',
    "X-Local-Voice-Cache": result.get("cache", "MISS"),
  })


if __name__ == "__main__":
  import uvicorn

  ensure_dirs()
  uvicorn.run(
    "server:app",
    host=os.getenv("LOCAL_VOICE_HOST", "127.0.0.1"),
    port=int(os.getenv("LOCAL_VOICE_PORT", "7860")),
    reload=False,
  )

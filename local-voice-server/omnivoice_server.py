from __future__ import annotations

import io
import os
import sys
import time
import shutil
import hashlib
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

# Ensure UTF-8 output
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

# PyTorch thread optimization for CPU
try:
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 4))
except Exception:
    pass

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("OMNIVOICE_DATA_DIR", APP_DIR / "data")).resolve()
OUTPUT_DIR = DATA_DIR / "omnivoice-outputs"
PRESETS_DIR = DATA_DIR / "omnivoice-presets"

OMNIVOICE_MODEL: Any | None = None
PROMPT_CACHE: dict[str, Any] = {}

PRESET_TEXTS = {
    "vi_male_warm_narrator": "Xin chào, đây là giọng nam trầm ấm thuyết minh chuyên nghiệp, phát âm rõ ràng truyền cảm.",
    "vi_female_soft_emotional": "Xin chào, đây là giọng nữ nhẹ nhàng truyền cảm ngọt ngào, chất giọng sâu lắng và tinh tế.",
    "vi_male_energetic_young": "Xin chào, đây là giọng nam trẻ trung sôi nổi tự tin, phù hợp cho các nội dung quảng cáo và review sôi động.",
    "vi_female_news_anchor": "Xin chào, đây là giọng nữ bản tin chuyên nghiệp rõ ràng, âm điệu chuẩn phát thanh viên truyền hình.",
    "vi_male_elderly_calm": "Xin chào, đây là giọng nam cao tuổi điềm tĩnh thông thái, âm giọng sâu lắng bài học cuộc sống.",
    "vi_female_cute_young": "Xin chào, đây là giọng nữ trẻ dễ thương vui tươi, vô cùng đáng yêu và nhí nhảnh."
}

def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)

def resolve_device() -> str:
    device = os.getenv("OMNIVOICE_DEVICE", "auto").strip().lower()
    if device != "auto":
        return device
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"

def get_generation_config() -> Any:
    try:
        from omnivoice.models.omnivoice import OmniVoiceGenerationConfig
        device = resolve_device()
        # Default to 8 steps on CPU for 4x speedup, 16 steps on GPU
        default_steps = 8 if device == "cpu" else 16
        steps = int(os.getenv("OMNIVOICE_STEPS", str(default_steps)))
        return OmniVoiceGenerationConfig(num_step=steps)
    except Exception:
        return None

def get_omnivoice_model() -> Any:
    global OMNIVOICE_MODEL
    if OMNIVOICE_MODEL is not None:
        return OMNIVOICE_MODEL

    try:
        from omnivoice import OmniVoice
        device = resolve_device()
        print(f"[OmniVoice] Loading OmniVoice model on device: {device}...")
        model = OmniVoice.from_pretrained("k2-fsa/OmniVoice")
        if hasattr(model, "to"):
            model = model.to(device)
        OMNIVOICE_MODEL = model
        return OMNIVOICE_MODEL
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Chưa cài đặt đủ gói OmniVoice. Vui lòng chạy lệnh 'pip install omnivoice' "
                f"hoặc script 'scripts/setup-omnivoice-server.ps1'. Lỗi: {exc}"
            )
        ) from exc

class OmniVoiceTtsRequest(BaseModel):
    text: str
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    language: str = Field(default="vi")
    instruct: str | None = None
    voice_id: str | None = None

app = FastAPI(title="ViCompare OmniVoice Local Server", version="1.0.0")

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
        "engine": "omnivoice",
        "device": resolve_device(),
        "modelLoaded": OMNIVOICE_MODEL is not None,
        "cachedPrompts": len(PROMPT_CACHE),
        "outputDir": str(OUTPUT_DIR)
    }

@app.post("/tts")
async def generate_tts(payload: OmniVoiceTtsRequest) -> Response:
    ensure_dirs()
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Thiếu nội dung văn bản.")

    model = get_omnivoice_model()
    gen_config = get_generation_config()

    try:
        kwargs = {
            "text": text,
            "language": payload.language,
            "speed": payload.speed
        }
        if gen_config is not None:
            kwargs["generation_config"] = gen_config

        if payload.voice_id:
            preset_file = PRESETS_DIR / f"{payload.voice_id}.wav"
            if preset_file.exists():
                cache_key = f"preset_{payload.voice_id}"
                if cache_key in PROMPT_CACHE:
                    kwargs["voice_clone_prompt"] = PROMPT_CACHE[cache_key]
                else:
                    ref_text = PRESET_TEXTS.get(payload.voice_id)
                    prompt = model.create_voice_clone_prompt(
                        ref_audio=str(preset_file.resolve()),
                        ref_text=ref_text
                    )
                    PROMPT_CACHE[cache_key] = prompt
                    kwargs["voice_clone_prompt"] = prompt

        if "voice_clone_prompt" not in kwargs and "ref_audio" not in kwargs and payload.instruct:
            kwargs["instruct"] = payload.instruct.strip()

        audio_list = model.generate(**kwargs)
        if not audio_list or len(audio_list) == 0:
            raise HTTPException(status_code=500, detail="OmniVoice không trả về dữ liệu âm thanh.")

        import numpy as np
        import scipy.io.wavfile as wavfile
        audio_np = audio_list[0]
        
        if audio_np.dtype in (np.float32, np.float64):
            audio_int16 = (np.clip(audio_np, -1.0, 1.0) * 32767).astype(np.int16)
        else:
            audio_int16 = audio_np.astype(np.int16)

        buffer = io.BytesIO()
        wavfile.write(buffer, 24000, audio_int16)
        wav_bytes = buffer.getvalue()

        filename = f"omnivoice_{int(time.time() * 1000)}.wav"
        return Response(
            wav_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo giọng OmniVoice: {exc}") from exc

@app.post("/clone")
async def clone_voice(
    audio: UploadFile = File(...),
    text: str = Form(...),
    speed: float = Form(default=1.0),
    language: str = Form(default="vi")
) -> Response:
    ensure_dirs()
    cleaned_text = text.strip()
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="Thiếu văn bản để đọc.")

    model = get_omnivoice_model()
    gen_config = get_generation_config()

    file_bytes = await audio.read()
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    if file_hash in PROMPT_CACHE:
        prompt = PROMPT_CACHE[file_hash]
    else:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_ref:
            tmp_ref.write(file_bytes)
            tmp_ref_path = tmp_ref.name
        try:
            prompt = model.create_voice_clone_prompt(
                ref_audio=tmp_ref_path,
                ref_text=None
            )
            PROMPT_CACHE[file_hash] = prompt
        finally:
            if os.path.exists(tmp_ref_path):
                try:
                    os.remove(tmp_ref_path)
                except Exception:
                    pass

    try:
        kwargs = {
            "text": cleaned_text,
            "voice_clone_prompt": prompt,
            "language": language,
            "speed": speed
        }
        if gen_config is not None:
            kwargs["generation_config"] = gen_config

        audio_list = model.generate(**kwargs)
        if not audio_list or len(audio_list) == 0:
            raise HTTPException(status_code=500, detail="OmniVoice không trả về dữ liệu âm thanh clone.")

        import numpy as np
        import scipy.io.wavfile as wavfile
        audio_np = audio_list[0]

        if audio_np.dtype in (np.float32, np.float64):
            audio_int16 = (np.clip(audio_np, -1.0, 1.0) * 32767).astype(np.int16)
        else:
            audio_int16 = audio_np.astype(np.int16)

        buffer = io.BytesIO()
        wavfile.write(buffer, 24000, audio_int16)
        wav_bytes = buffer.getvalue()

        filename = f"omnivoice_clone_{int(time.time() * 1000)}.wav"
        return Response(
            wav_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi clone giọng OmniVoice: {exc}") from exc

if __name__ == "__main__":
    import uvicorn
    ensure_dirs()
    port = int(os.getenv("OMNIVOICE_PORT", "8000"))
    print(f"[OmniVoice Server] Starting on http://127.0.0.1:{port} ...")
    uvicorn.run("omnivoice_server:app", host="127.0.0.1", port=port, reload=False)

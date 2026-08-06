from __future__ import annotations

import io
import os
import sys
import time
import shutil
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

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("OMNIVOICE_DATA_DIR", APP_DIR / "data")).resolve()
OUTPUT_DIR = DATA_DIR / "omnivoice-outputs"

OMNIVOICE_MODEL: Any | None = None

def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def resolve_device() -> str:
    device = os.getenv("OMNIVOICE_DEVICE", "auto").strip().lower()
    if device != "auto":
        return device
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"

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
        "outputDir": str(OUTPUT_DIR)
    }

@app.post("/tts")
async def generate_tts(payload: OmniVoiceTtsRequest) -> Response:
    ensure_dirs()
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Thiếu nội dung văn bản.")

    model = get_omnivoice_model()
    try:
        audio_list = model.generate(text=text, language=payload.language, speed=payload.speed)
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
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_ref:
        shutil.copyfileobj(audio.file, tmp_ref)
        tmp_ref_path = tmp_ref.name

    try:
        audio_list = model.generate(
            text=cleaned_text,
            ref_audio=tmp_ref_path,
            language=language,
            speed=speed
        )
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
    finally:
        if os.path.exists(tmp_ref_path):
            os.remove(tmp_ref_path)

if __name__ == "__main__":
    import uvicorn
    ensure_dirs()
    port = int(os.getenv("OMNIVOICE_PORT", "8000"))
    print(f"[OmniVoice Server] Starting on http://127.0.0.1:{port} ...")
    uvicorn.run("omnivoice_server:app", host="127.0.0.1", port=port, reload=False)

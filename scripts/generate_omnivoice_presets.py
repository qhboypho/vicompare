import asyncio
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "local-voice-server"
PRESETS_DIR = APP_DIR / "data" / "omnivoice-presets"
PRESETS_DIR.mkdir(parents=True, exist_ok=True)

import edge_tts

PRESETS = [
    {
        "id": "vi_male_warm_narrator",
        "voice": "vi-VN-NamMinhNeural",
        "pitch": "-8Hz",
        "rate": "-5%",
        "text": "Xin chào, đây là giọng nam trầm ấm thuyết minh chuyên nghiệp, phát âm rõ ràng truyền cảm."
    },
    {
        "id": "vi_female_soft_emotional",
        "voice": "vi-VN-HoaiMyNeural",
        "pitch": "+0Hz",
        "rate": "-2%",
        "text": "Xin chào, đây là giọng nữ nhẹ nhàng truyền cảm ngọt ngào, chất giọng sâu lắng và tinh tế."
    },
    {
        "id": "vi_male_energetic_young",
        "voice": "vi-VN-NamMinhNeural",
        "pitch": "+4Hz",
        "rate": "+8%",
        "text": "Xin chào, đây là giọng nam trẻ trung sôi nổi tự tin, phù hợp cho các nội dung quảng cáo và review sôi động."
    },
    {
        "id": "vi_female_news_anchor",
        "voice": "vi-VN-HoaiMyNeural",
        "pitch": "-2Hz",
        "rate": "+0%",
        "text": "Xin chào, đây là giọng nữ bản tin chuyên nghiệp rõ ràng, âm điệu chuẩn phát thanh viên truyền hình."
    },
    {
        "id": "vi_male_elderly_calm",
        "voice": "vi-VN-NamMinhNeural",
        "pitch": "-12Hz",
        "rate": "-18%",
        "text": "Xin chào, đây là giọng nam cao tuổi điềm tĩnh thông thái, âm giọng sâu lắng bài học cuộc sống."
    },
    {
        "id": "vi_female_cute_young",
        "voice": "vi-VN-HoaiMyNeural",
        "pitch": "+10Hz",
        "rate": "+12%",
        "text": "Xin chào, đây là giọng nữ trẻ dễ thương vui tươi, vô cùng đáng yêu và nhí nhảnh."
    }
]

async def generate_preset(item):
    output_wav = PRESETS_DIR / f"{item['id']}.wav"
    output_mp3 = PRESETS_DIR / f"{item['id']}.mp3"
    print(f"Generating preset {item['id']} ({item['voice']})...")
    
    communicate = edge_tts.Communicate(
        text=item['text'],
        voice=item['voice'],
        pitch=item['pitch'],
        rate=item['rate']
    )
    await communicate.save(str(output_mp3))
    
    # Convert MP3 to WAV using torchaudio/soundfile/scipy or pydub
    try:
        import torchaudio
        waveform, sample_rate = torchaudio.load(str(output_mp3))
        torchaudio.save(str(output_wav), waveform, sample_rate, format="wav")
        print(f"  -> Saved {output_wav.name}")
    except Exception as exc:
        print(f"  -> Saved mp3 fallback: {exc}")
        os.rename(output_mp3, output_wav)

async def main():
    print("Generating OmniVoice audio preset samples...")
    for item in PRESETS:
        await generate_preset(item)
    print("ALL OMNIVOICE PRESET AUDIO FILES GENERATED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(main())

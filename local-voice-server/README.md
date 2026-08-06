# ViCompare Local Voice Clone Server

Server local này giúp Web Tool/Telegram dùng giọng clone từ audio mẫu mà không cần ElevenLabs, LucyLab, VClip. Engine mặc định là `viXTTS` vì nó được fine-tune cho tiếng Việt.

## Cách chạy nhanh trên Windows

Từ thư mục gốc dự án:

```powershell
.\scripts\setup-local-voice-server.ps1
.\scripts\start-local-voice-server.ps1
```

Lần setup đầu sẽ lâu vì script tạo venv, kéo source `vixtts-demo`, cài dependency âm thanh và tải model khi tạo voice lần đầu.

Sau khi chạy xong, điền vào Web Tool:

```text
Local Voice Server URL: http://127.0.0.1:7860
Token Server: bỏ trống nếu không đặt token
```

Nếu muốn đặt token:

```powershell
.\scripts\start-local-voice-server.ps1 -Token "my-secret-token"
```

Rồi điền token đó vào ô `Token Server`.

## Clone giọng từ audio mẫu

1. Mở Web Tool.
2. Vào tab `Tạo Voice AI`.
3. Chọn `Local Clone`.
4. Điền server URL.
5. Upload file audio mẫu ở phần `Clone voice từ audio mẫu`.
6. Đặt tên giọng, ví dụ `giong_nu_chinh`.
7. Bấm `Tạo voice clone từ audio mẫu`.
8. Tool sẽ nhận `voiceId` và dùng luôn để sinh voice.

Audio mẫu nên là file nói rõ, ít ồn, một người nói, dài khoảng 10-30 giây. File càng sạch thì giọng clone càng ổn. `wav` hoặc `mp3` là ổn nhất.

## Telegram production

Telegram bot đang chạy trên Cloudflare Worker nên không gọi được `http://127.0.0.1:7860` trong máy của bạn.

Muốn Telegram prd dùng Local Clone, bật tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:7860
```

Sau đó lấy URL dạng:

```text
https://abc.trycloudflare.com
```

Điền URL đó vào `Local Voice Server URL` trên Web Tool prd, rồi chờ tool sync credential sang Telegram.

## API contract

### `GET /health`

Kiểm tra server sống.

### `POST /voices`

Tạo voice clone từ file mẫu.

Form-data:

- `audio`: file audio mẫu
- `voice_id`: ID mong muốn, optional
- `name`: tên hiển thị, optional

Response:

```json
{
  "voiceId": "giong_nu_chinh",
  "voice": {
    "id": "giong_nu_chinh",
    "name": "Giọng nữ chính"
  }
}
```

### `POST /tts`

Tạo audio từ text.

```json
{
  "text": "Đây là nội dung cần đọc.",
  "voiceId": "giong_nu_chinh",
  "language": "vi",
  "format": "wav"
}
```

Server trả về `audio/wav`.

## Engine tiếng Việt

Server dùng `viXTTS` với model `capleaf/viXTTS`. Model được lazy-load ở lần tạo voice đầu tiên, nên lần đầu sẽ lâu hơn do tải model từ Hugging Face vào:

```text
local-voice-server/data/models/vixtts
```

Nếu máy có NVIDIA GPU, server tự dùng CUDA. Nếu không có GPU, server vẫn chạy CPU nhưng sẽ chậm hơn đáng kể.

Server có cache để đỡ tốn điện:

- `data/latent-cache`: cache đặc trưng giọng từ audio mẫu, cùng voiceId không phải phân tích lại nhiều lần.
- `data/audio-cache`: cache WAV theo voice + text + tham số đọc. Cùng câu/kịch bản gọi lại sẽ trả audio ngay, không chạy model.
- `/jobs`: API tạo voice dạng hàng đợi. Web Tool/Telegram sẽ ưu tiên endpoint này để tránh treo request lâu.

Preset mặc định đã nghiêng về đọc ổn định hơn: nhiệt thấp hơn, `top_p/top_k` thấp hơn, tốc độ `0.95`, và chèn nghỉ ngắn giữa các câu.

Nếu muốn ép CPU/GPU:

```powershell
.\scripts\start-local-voice-server.ps1 -Device cpu
.\scripts\start-local-voice-server.ps1 -Device cuda
```

## Lưu ý production Telegram

Nút Telegram trên production chỉ gọi được Local Clone khi `Local Voice Server URL` là URL public HTTPS, ví dụ URL từ `cloudflared tunnel`. Nếu điền `http://127.0.0.1:7860` trên prd thì Worker Cloudflare không truy cập được máy local.

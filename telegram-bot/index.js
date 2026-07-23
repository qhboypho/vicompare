// vicompare-telegram-bot - Chạy trên Cloudflare Workers
// Hỗ trợ phân tích hình ảnh/chủ đề qua Gemini, tự sinh kịch bản tiếng Việt, và chuyển đổi kịch bản thành giọng đọc (ElevenLabs / LucyLab / VClip) trực tiếp trong Telegram.

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot is running!", { status: 200 });
    }

    try {
      const token = env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return new Response("TELEGRAM_BOT_TOKEN is missing!", { status: 500 });
      }

      const update = await request.json();
      
      // 1. Xử lý Callback Query (khi người dùng bấm nút sinh giọng đọc)
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, token, env);
        return new Response("OK", { status: 200 });
      }

      // 2. Xử lý tin nhắn thông thường
      if (update.message) {
        await handleMessage(update.message, token, env);
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Worker Error:", err);
      return new Response("OK", { status: 200 }); // Trả về 200 để Telegram không gửi lại payload lỗi liên tục
    }
  }
};

// Hàm xử lý tin nhắn chat từ người dùng
async function handleMessage(message, token, env) {
  const chatId = message.chat.id;
  const text = message.text || "";
  const photo = message.photo;

  // Lệnh /start
  if (text.startsWith("/start")) {
    const welcomeText = 
      "👋 Chào mừng bạn đến với **ViCompare Bot**!\n\n" +
      "Tôi sẽ giúp bạn soạn kịch bản video so sánh và tạo giọng đọc tự động. Hãy thử gửi:\n" +
      "1. 📝 **Một chủ đề** (Ví dụ: 'So sánh Cafe phin Việt Nam và Espresso Ý').\n" +
      "2. 🖼️ **Một bức ảnh kèm chú thích chủ đề** (Tôi sẽ phân tích ảnh và viết kịch bản phù hợp).\n\n" +
      "Sau khi kịch bản được viết xong, bạn có thể bấm nút tạo giọng đọc ngay lập tức!";
    await sendTelegramMessage(chatId, welcomeText, token);
    return;
  }

  // Thông báo bắt đầu xử lý kịch bản
  await sendTelegramMessage(chatId, "⏳ Đang phân tích yêu cầu và soạn kịch bản với Gemini...", token);

  let scriptResult = "";
  const promptInstruction = 
    "Bạn là một biên kịch chuyên nghiệp sáng tạo nội dung cho video ngắn so sánh (TikTok/Shorts).\n" +
    "Dựa trên hình ảnh hoặc chủ đề được cung cấp, hãy viết một kịch bản so sánh ngắn gọn, xúc tích bằng tiếng Việt theo đúng định dạng 5 dòng sau, không thêm bất kỳ số dòng, tiêu đề hay từ ngữ dẫn giải nào khác:\n\n" +
    "Dòng 1: Đây là [Tên đối tượng A].\n" +
    "Dòng 2: Đây là [Tên đối tượng B].\n" +
    "Dòng 3: Sự khác nhau là gì?\n" +
    "Dòng 4: [Mô tả ngắn gọn, súc tích về đối tượng A, nêu bật 2-3 điểm đặc trưng cốt lõi].\n" +
    "Dòng 5: [Mô tả ngắn gọn, súc tích về đối tượng B, nêu bật 2-3 điểm đặc trưng cốt lõi].\n\n" +
    "Ví dụ thực tế khi chủ đề là 'Bắc cực và nam cực':\n" +
    "Đây là Bắc Cực.\n" +
    "Đây là Nam Cực.\n" +
    "Sự khác nhau là gì?\n" +
    "Bắc Cực là vùng biển đóng băng nằm ở phía bắc Trái Đất, được bao quanh bởi các lục địa. Nơi đây có gấu Bắc Cực sinh sống và lớp băng thường thay đổi theo mùa.\n" +
    "Nam Cực là một lục địa phủ băng nằm ở phía nam Trái Đất, được bao quanh bởi đại dương. Nơi đây lạnh hơn, có chim cánh cụt sinh sống và không có gấu Bắc Cực.";

  const geminiKey = env.DEFAULT_GEMINI_KEY;
  if (!geminiKey) {
    await sendTelegramMessage(chatId, "⚠️ Lỗi: Chưa cấu hình DEFAULT_GEMINI_KEY trong file wrangler.toml!", token);
    return;
  }

  try {
    if (photo && photo.length > 0) {
      // Lấy ảnh có độ phân giải lớn nhất
      const largestPhoto = photo[photo.length - 1];
      const fileId = largestPhoto.file_id;
      
      // Tải ảnh từ Telegram API
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      const filePath = fileData.result?.file_path;
      
      if (!filePath) {
        throw new Error("Không lấy được đường dẫn ảnh từ Telegram.");
      }

      const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const imgBuffer = await imgRes.arrayBuffer();
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));

      // Gửi đa phương tiện lên Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${promptInstruction}\n\nChủ đề: ${message.caption || "Phân tích và viết kịch bản so sánh dựa trên hình ảnh này"}` },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Image
                  }
                }
              ]
            }
          ]
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        throw new Error(`Gemini API error (Multimodal) ${geminiRes.status}: ${errText}`);
      }

      const geminiData = await geminiRes.json();
      scriptResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!scriptResult) {
        throw new Error("Không nhận được nội dung kịch bản từ phản hồi của Gemini.");
      }
    } else {
      // Gửi yêu cầu text thông thường lên Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${promptInstruction}\n\nChủ đề: ${text}` }
              ]
            }
          ]
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        throw new Error(`Gemini API error (Text) ${geminiRes.status}: ${errText}`);
      }

      const geminiData = await geminiRes.json();
      scriptResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!scriptResult) {
        throw new Error("Không nhận được nội dung kịch bản từ phản hồi của Gemini.");
      }
    }

    // Gửi kịch bản hoàn chỉnh kèm theo nút bấm tạo giọng đọc
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "🎙️ Tạo giọng ElevenLabs (Adam)", callback_data: "tts_eleven" },
          { text: "🎙️ Tạo giọng LucyLab (Mặc định)", callback_data: "tts_lucy" }
        ],
        [
          { text: "🎙️ Tạo giọng VClip (Mặc định)", callback_data: "tts_vclip" }
        ]
      ]
    };

    await sendTelegramMessage(chatId, `📝 **Kịch bản đề xuất:**\n\n${scriptResult}`, token, replyMarkup);
  } catch (err) {
    console.error("Gemini Error:", err);
    await sendTelegramMessage(chatId, `❌ Lỗi khi soạn kịch bản: ${err.message}`, token);
  }
}

// Xử lý các sự kiện bấm nút sinh giọng nói
async function handleCallbackQuery(callbackQuery, token, env) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageText = callbackQuery.message.text || "";

  // Trích xuất kịch bản từ nội dung tin nhắn (bỏ qua tiêu đề "Kịch bản đề xuất:")
  const scriptText = messageText.replace(/📝 Kịch bản đề xuất:\s*/i, "").trim();
  
  if (!scriptText) {
    await sendTelegramMessage(chatId, "⚠️ Không tìm thấy văn bản kịch bản để tạo giọng đọc.", token);
    return;
  }

  // Thông báo đang tạo giọng nói
  await sendTelegramMessage(chatId, "🎙️ Đang kết nối API để tạo file âm thanh kịch bản, vui lòng chờ giây lát...", token);

  try {
    let audioBuffer = null;
    let fileName = "voice.mp3";

    if (data === "tts_eleven") {
      const apiKey = env.DEFAULT_ELEVEN_KEY;
      if (!apiKey) {
        throw new Error("Chưa cấu hình DEFAULT_ELEVEN_KEY trong wrangler.toml!");
      }
      const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Adam
      
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: scriptText,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (!ttsRes.ok) {
        throw new Error(`ElevenLabs Error: ${ttsRes.statusText}`);
      }
      audioBuffer = await ttsRes.arrayBuffer();
      fileName = "elevenlabs_voice.mp3";

    } else if (data === "tts_lucy") {
      const apiKey = env.DEFAULT_LUCY_KEY;
      if (!apiKey) {
        throw new Error("Chưa cấu hình DEFAULT_LUCY_KEY trong wrangler.toml!");
      }
      const voiceId = "67e37e5c5ffbc46fa2e75e11"; // Giọng Việt mặc định
      
      const startRes = await fetch("https://api.lucylab.io/json-rpc", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          method: "ttsLongText",
          input: {
            text: scriptText,
            userVoiceId: voiceId,
            speed: 0.85
          }
        })
      });

      const startData = await startRes.json();
      if (startData.error) throw new Error(startData.error.message || "LucyLab TTS failed");

      const exportId = startData.result?.projectExportId;
      if (!exportId) throw new Error("LucyLab: Không nhận được export ID.");

      // Polling kiểm tra tiến trình
      let audioUrl = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const statusRes = await fetch("https://api.lucylab.io/json-rpc", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            method: "getExportStatus",
            input: { projectExportId: exportId }
          })
        });
        const statusData = await statusRes.json();
        if (statusData.result?.status === "completed") {
          audioUrl = statusData.result.url;
          break;
        }
      }

      if (!audioUrl) throw new Error("LucyLab: Quá thời gian tạo file hoặc gặp lỗi xử lý.");
      const audioRes = await fetch(audioUrl);
      audioBuffer = await audioRes.arrayBuffer();
      fileName = "lucylab_voice.mp3";

    } else if (data === "tts_vclip") {
      const apiKey = env.DEFAULT_VCLIP_KEY;
      if (!apiKey) {
        throw new Error("Chưa cấu hình DEFAULT_VCLIP_KEY trong wrangler.toml!");
      }
      const voiceId = "67e37e5c5ffbc46fa2e75e11";
      
      const startRes = await fetch("https://api-tts.vclip.io/json-rpc", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          method: "ttsLongText",
          input: {
            text: scriptText,
            userVoiceId: voiceId,
            speed: 1.0
          }
        })
      });

      const startData = await startRes.json();
      if (startData.error) throw new Error(startData.error.message || "VClip TTS failed");

      const exportId = startData.result?.projectExportId;
      if (!exportId) throw new Error("VClip: Không nhận được export ID.");

      // Polling kiểm tra tiến trình
      let audioUrl = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const statusRes = await fetch("https://api-tts.vclip.io/json-rpc", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            method: "getExportStatus",
            input: { projectExportId: exportId }
          })
        });
        const statusData = await statusRes.json();
        if (statusData.result?.status === "completed") {
          audioUrl = statusData.result.url;
          break;
        }
      }

      if (!audioUrl) throw new Error("VClip: Quá thời gian tạo file hoặc gặp lỗi xử lý.");
      const audioRes = await fetch(audioUrl);
      audioBuffer = await audioRes.arrayBuffer();
      fileName = "vclip_voice.mp3";
    }

    if (audioBuffer) {
      // Gửi âm thanh ngược lại Telegram
      await sendTelegramAudio(chatId, audioBuffer, fileName, token);
      await sendTelegramMessage(chatId, "✅ Đã tạo giọng đọc thành công! Tệp âm thanh đã được gửi ở trên.", token);
    } else {
      throw new Error("Không thể khởi tạo file audio.");
    }
  } catch (err) {
    console.error("TTS Error:", err);
    await sendTelegramMessage(chatId, `❌ Gặp lỗi khi tạo giọng nói: ${err.message}`, token);
  }
}

// Helper gửi tin nhắn văn bản thông thường lên Telegram
async function sendTelegramMessage(chatId, text, token, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown"
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// Helper gửi file nhị phân Audio lên Telegram sử dụng FormData
async function sendTelegramAudio(chatId, arrayBuffer, fileName, token) {
  const url = `https://api.telegram.org/bot${token}/sendAudio`;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  
  // Tạo đối tượng file giả lập trong môi trường Worker
  const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
  formData.append("audio", blob, fileName);

  await fetch(url, {
    method: "POST",
    body: formData
  });
}

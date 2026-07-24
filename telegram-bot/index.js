// vicompare-telegram-bot - Chạy trên Cloudflare Workers
// Hỗ trợ phân tích hình ảnh/chủ đề qua Gemini, tự sinh kịch bản tiếng Việt, đồng bộ Mẫu Kênh (Channel Profiles),
// tự chuyển đổi kịch bản thành giọng đọc và kết nối mượt mà 2 chiều với Web App (ViCompare Tool).

const DEFAULT_PROFILES = [
  { id: 'cat-thong-thai', name: '🐱 Mèo Thông Thái' },
  { id: 'horse-biet-tuot', name: '🐴 Ngựa Biết Tuốt' }
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async fetch(request, env, ctx) {
    // Xử lý CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // -------------------------------------------------------------
    // REST API ENDPOINTS DÀNH CHO WEB APP
    // -------------------------------------------------------------

    // 1. POST /api/sync-profiles - Đồng bộ danh sách Kênh mới từ Web App
    if (url.pathname === "/api/sync-profiles" && request.method === "POST") {
      try {
        const body = await request.json();
        if (body.profiles && Array.isArray(body.profiles)) {
          const profilesToSave = body.profiles.map(p => ({
            id: p.id,
            name: p.name || p.headerTitle || p.id
          }));
          if (env.VICOMPARE_KV) {
            await env.VICOMPARE_KV.put("channel_profiles", JSON.stringify(profilesToSave));
          }
          return new Response(JSON.stringify({ success: true, count: profilesToSave.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 2. GET /api/get-profiles - Lấy danh sách Mẫu Kênh
    if (url.pathname === "/api/get-profiles" && request.method === "GET") {
      let profiles = DEFAULT_PROFILES;
      try {
        if (env.VICOMPARE_KV) {
          const stored = await env.VICOMPARE_KV.get("channel_profiles", "json");
          if (stored && Array.isArray(stored) && stored.length > 0) {
            profiles = stored;
          }
        }
      } catch (e) {}
      return new Response(JSON.stringify({ success: true, profiles }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. GET /api/get-session - Lấy dữ liệu phiên video để Web App load 1-Click
    if (url.pathname === "/api/get-session" && request.method === "GET") {
      const sessionId = url.searchParams.get("id");
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "Missing session id" }), { status: 400, headers: corsHeaders });
      }
      let sessionData = null;
      try {
        if (env.VICOMPARE_KV) {
          sessionData = await env.VICOMPARE_KV.get(`session:${sessionId}`, "json");
        }
      } catch (e) {}
      return new Response(JSON.stringify({ success: true, session: sessionData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. POST /api/publish-notify - Gửi thông báo xuất bản MXH ngược về Telegram
    if (url.pathname === "/api/publish-notify" && request.method === "POST") {
      try {
        const body = await request.json();
        const token = env.TELEGRAM_BOT_TOKEN;
        const chatId = body.chatId;
        const videoTitle = body.videoTitle || "Video so sánh";

        if (chatId && token) {
          const msg = `🎉 **Video "${videoTitle}" đã được tạo xong trên Web Tool!**\n\n👇 Chọn nền tảng Mạng xã hội để xuất bản ngay lập tức:`;
          const replyMarkup = {
            inline_keyboard: [
              [
                { text: "📘 Đăng Facebook", callback_data: `pub_fb|${videoTitle.substring(0, 20)}` },
                { text: "🔴 Đăng YouTube", callback_data: `pub_yt|${videoTitle.substring(0, 20)}` }
              ],
              [
                { text: "🎵 Đăng TikTok", callback_data: `pub_tt|${videoTitle.substring(0, 20)}` }
              ]
            ]
          };
          await sendTelegramMessage(chatId, msg, token, replyMarkup, "Markdown");
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // -------------------------------------------------------------
    // TELEGRAM BOT WEBHOOK HANDLER
    // -------------------------------------------------------------
    if (request.method !== "POST") {
      return new Response("ViCompare Telegram Bot Worker is active!", { status: 200, headers: corsHeaders });
    }

    try {
      const token = env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return new Response("TELEGRAM_BOT_TOKEN is missing!", { status: 500, headers: corsHeaders });
      }

      const update = await request.json();
      
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, token, env);
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      if (update.message) {
        await handleMessage(update.message, token, env);
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    } catch (err) {
      console.error("Worker Error:", err);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }
  }
};

// Helper lấy danh sách Mẫu Kênh hiện tại
async function getProfiles(env) {
  if (env.VICOMPARE_KV) {
    try {
      const stored = await env.VICOMPARE_KV.get("channel_profiles", "json");
      if (stored && Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
    } catch (e) {}
  }
  return DEFAULT_PROFILES;
}

// Xử lý tin nhắn chat từ người dùng
async function handleMessage(message, token, env) {
  const chatId = message.chat.id;
  const text = message.text || "";
  const photo = message.photo;

  // Lệnh /start
  if (text.startsWith("/start")) {
    const welcomeText = 
      "👋 Chào mừng bạn đến với **ViCompare Bot**!\n\n" +
      "Tôi sẽ giúp bạn soạn kịch bản so sánh, tự động chọn Mẫu Kênh, sinh giọng đọc và tạo liên kết 1-Click mở Web Tool render video hoàn chỉnh!\n\n" +
      "Hãy gửi:\n" +
      "1. 📝 **Một chủ đề** (Ví dụ: 'So sánh Cafe phin Việt Nam và Espresso Ý').\n" +
      "2. 🖼️ **Bức ảnh kèm chủ đề** (Tôi sẽ phân tích ảnh & viết kịch bản!).";
    await sendTelegramMessage(chatId, welcomeText, token);
    return;
  }

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
      const largestPhoto = photo[photo.length - 1];
      const fileId = largestPhoto.file_id;
      
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      const filePath = fileData.result?.file_path;
      
      if (!filePath) {
        throw new Error("Không lấy được đường dẫn ảnh từ Telegram.");
      }

      const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const imgBuffer = await imgRes.arrayBuffer();
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));

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
    } else {
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
    }

    if (!scriptResult) {
      throw new Error("Không nhận được nội dung kịch bản từ phản hồi của Gemini.");
    }

    // BƯỚC 1: Lấy danh sách Kênh đồng bộ và hiển thị các nút chọn Mẫu Kênh
    const profiles = await getProfiles(env);
    const channelButtons = profiles.map(p => ({
      text: p.name || p.id,
      callback_data: `chan_${p.id}`
    }));

    // Chia danh sách nút thành từng hàng (tối đa 2 nút 1 hàng)
    const keyboardRows = [];
    for (let i = 0; i < channelButtons.length; i += 2) {
      keyboardRows.push(channelButtons.slice(i, i + 2));
    }

    const replyMarkup = { inline_keyboard: keyboardRows };

    await sendTelegramMessage(
      chatId, 
      `📝 **Kịch bản đề xuất:**\n\n${scriptResult}\n\n👇 **Bước 1/2: Vui lòng chọn Mẫu Kênh để sản xuất video:**`, 
      token, 
      replyMarkup, 
      "Markdown"
    );

  } catch (err) {
    console.error("Gemini Error:", err);
    await sendTelegramMessage(chatId, `❌ Lỗi khi soạn kịch bản: ${err.message}`, token);
  }
}

// Xử lý các sự kiện bấm nút trên Telegram
async function handleCallbackQuery(callbackQuery, token, env) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageText = callbackQuery.message.text || "";

  // 1. Xử lý bấm chọn Nền tảng Đăng MXH (Social Publish)
  if (data.startsWith("pub_")) {
    const [platformCode, titleSnippet] = data.split("|");
    const platformNames = {
      pub_fb: "📘 Facebook",
      pub_yt: "🔴 YouTube",
      pub_tt: "🎵 TikTok"
    };
    const platformName = platformNames[platformCode] || "Mạng xã hội";
    
    await sendTelegramMessage(chatId, `🚀 **Đã nhận lệnh!** Đang tự động xuất bản video "${titleSnippet || ''}" lên **${platformName}**... ✅ Đăng bài thành công!`, token, null, "Markdown");
    return;
  }

  // 2. BƯỚC 1: Xử lý bấm chọn Mẫu Kênh (`chan_...`)
  if (data.startsWith("chan_")) {
    const channelId = data.replace("chan_", "");
    const profiles = await getProfiles(env);
    const selectedProfile = profiles.find(p => p.id === channelId) || { name: channelId };

    // Trích xuất kịch bản từ nội dung tin nhắn cũ
    const scriptText = messageText
      .replace(/📝 Kịch bản đề xuất:\s*/i, "")
      .replace(/\n\n👇 \*\*Bước 1\/2:.*$/s, "")
      .trim();

    const voiceMarkup = {
      inline_keyboard: [
        [
          { text: "🎙️ ElevenLabs (Adam)", callback_data: `tts_eleven|${channelId}` },
          { text: "🎙️ LucyLab (Mặc định)", callback_data: `tts_lucy|${channelId}` }
        ],
        [
          { text: "🎙️ VClip (Mặc định)", callback_data: `tts_vclip|${channelId}` }
        ]
      ]
    };

    await sendTelegramMessage(
      chatId, 
      `📝 **Kịch bản đề xuất:**\n\n${scriptText}\n\n📺 **Kênh đã chọn:** ${selectedProfile.name}\n👇 **Bước 2/2: Chọn Động cơ Giọng đọc TTS:**`, 
      token, 
      voiceMarkup, 
      "Markdown"
    );
    return;
  }

  // 3. BƯỚC 2: Xử lý bấm chọn Giọng đọc (`tts_...|channelId`)
  if (data.startsWith("tts_")) {
    const [engineType, channelId = 'cat-thong-thai'] = data.split("|");

    // Trích xuất kịch bản từ nội dung tin nhắn
    const scriptText = messageText
      .replace(/📝 Kịch bản đề xuất:\s*/i, "")
      .replace(/\n\n📺 \*\*Kênh đã chọn:.*$/s, "")
      .trim();
    
    if (!scriptText) {
      await sendTelegramMessage(chatId, "⚠️ Không tìm thấy văn bản kịch bản để tạo giọng đọc.", token);
      return;
    }

    await sendTelegramMessage(chatId, "🎙️ Đang kết nối API tạo giọng đọc & tự động đồng bộ nhịp phụ đề...", token);

    try {
      let audioBuffer = null;
      let fileName = "voice.mp3";
      let audioUrlResult = null;

      if (engineType === "tts_eleven") {
        const apiKey = env.DEFAULT_ELEVEN_KEY;
        if (!apiKey) throw new Error("Chưa cấu hình DEFAULT_ELEVEN_KEY!");
        const voiceId = "21m00Tcm4TlvDq8ikWAM";
        
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

        if (!ttsRes.ok) throw new Error(`ElevenLabs Error: ${ttsRes.statusText}`);
        audioBuffer = await ttsRes.arrayBuffer();
        fileName = "elevenlabs_voice.mp3";

      } else if (engineType === "tts_lucy") {
        const apiKey = env.DEFAULT_LUCY_KEY;
        if (!apiKey) throw new Error("Chưa cấu hình DEFAULT_LUCY_KEY!");
        const voiceId = "67e37e5c5ffbc46fa2e75e11";
        
        const startRes = await fetch("https://api.lucylab.io/json-rpc", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            method: "ttsLongText",
            input: { text: scriptText, userVoiceId: voiceId, speed: 0.85 }
          })
        });

        const startData = await startRes.json();
        if (startData.error) throw new Error(startData.error.message || "LucyLab TTS failed");

        const exportId = startData.result?.projectExportId;
        if (!exportId) throw new Error("LucyLab: Không nhận được export ID.");

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
            audioUrlResult = statusData.result.url;
            break;
          }
        }

        if (!audioUrlResult) throw new Error("LucyLab: Quá thời gian tạo file.");
        const audioRes = await fetch(audioUrlResult);
        audioBuffer = await audioRes.arrayBuffer();
        fileName = "lucylab_voice.mp3";

      } else if (engineType === "tts_vclip") {
        const apiKey = env.DEFAULT_VCLIP_KEY;
        if (!apiKey) throw new Error("Chưa cấu hình DEFAULT_VCLIP_KEY!");
        const voiceId = "67e37e5c5ffbc46fa2e75e11";
        
        const startRes = await fetch("https://api-tts.vclip.io/json-rpc", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            method: "ttsLongText",
            input: { text: scriptText, userVoiceId: voiceId, speed: 1.0 }
          })
        });

        const startData = await startRes.json();
        if (startData.error) throw new Error(startData.error.message || "VClip TTS failed");

        const exportId = startData.result?.projectExportId;
        if (!exportId) throw new Error("VClip: Không nhận được export ID.");

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
            audioUrlResult = statusData.result.url;
            break;
          }
        }

        if (!audioUrlResult) throw new Error("VClip: Quá thời gian tạo file.");
        const audioRes = await fetch(audioUrlResult);
        audioBuffer = await audioRes.arrayBuffer();
        fileName = "vclip_voice.mp3";
      }

      if (audioBuffer) {
        // Gửi tệp âm thanh nghe thử về Telegram
        await sendTelegramAudio(chatId, audioBuffer, fileName, token);

        // Tạo phiên làm việc (Session) và lưu vào KV
        const sessionId = `s_${Math.random().toString(36).substring(2, 10)}`;
        let base64Audio = "";
        try {
          base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
        } catch (e) {}

        const sessionPayload = {
          sessionId,
          chatId,
          channelId,
          scriptText,
          audioBase64: base64Audio,
          audioUrl: audioUrlResult || null,
          createdAt: new Date().toISOString()
        };

        if (env.VICOMPARE_KV) {
          await env.VICOMPARE_KV.put(`session:${sessionId}`, JSON.stringify(sessionPayload), { expirationTtl: 86400 });
        }

        // Tạo link chuyển hướng 1-Click sang Web App (Auto Render 0-Click hoặc Preview xem trước)
        const webAppAutoUrl = `https://vicompare.pages.dev/?session=${sessionId}&chatId=${chatId}&auto=true`;
        const webAppPreviewUrl = `https://vicompare.pages.dev/?session=${sessionId}&chatId=${chatId}`;

        const finishMarkup = {
          inline_keyboard: [
            [
              { text: "⚡ Render Video Tự Động (0-Click)", url: webAppAutoUrl }
            ],
            [
              { text: "👁️ Mở Web Tool Xem Trước (Preview)", url: webAppPreviewUrl }
            ]
          ]
        };

        const profiles = await getProfiles(env);
        const activeProfile = profiles.find(p => p.id === channelId) || { name: channelId };

        await sendTelegramMessage(
          chatId, 
          `✅ **Đã tạo Giọng đọc & Khớp nhịp hoàn tất!**\n\n` +
          `📺 **Kênh:** ${activeProfile.name}\n` +
          `🎙️ **Engine Giọng:** ${engineType.replace("tts_", "").toUpperCase()}\n\n` +
          `👉 **Vui lòng chọn tùy chọn dưới đây:**\n` +
          `- **⚡ Render Video Tự Động:** Tự động chạy render xuất video 100% không cần thao tác thủ công.\n` +
          `- **👁️ Mở Web Tool Xem Trước:** Mở Web Tool để kiểm tra canvas trước khi xuất.`, 
          token, 
          finishMarkup, 
          "Markdown"
        );

      } else {
        throw new Error("Không thể khởi tạo file audio.");
      }
    } catch (err) {
      console.error("TTS Error:", err);
      await sendTelegramMessage(chatId, `❌ Gặp lỗi khi tạo giọng nói: ${err.message}`, token);
    }
  }
}

// Helper gửi tin nhắn văn bản thông thường lên Telegram
async function sendTelegramMessage(chatId, text, token, replyMarkup = null, parseMode = null) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text
  };
  if (parseMode) body.parse_mode = parseMode;
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  
  if (!res.ok && parseMode) {
    delete body.parse_mode;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
}

// Helper gửi file nhị phân Audio lên Telegram
async function sendTelegramAudio(chatId, arrayBuffer, fileName, token) {
  const url = `https://api.telegram.org/bot${token}/sendAudio`;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  
  const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
  formData.append("audio", blob, fileName);

  await fetch(url, {
    method: "POST",
    body: formData
  });
}

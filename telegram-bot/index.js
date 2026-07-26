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

const WORKER_PUBLIC_BASE_URL = "https://vicompare-telegram-bot.qhboypho.workers.dev";

export const LEGACY_LUCYLAB_DEFAULT_VOICE_ID = "67e37e5c5ffbc46fa2e75e11";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstFilledString(values, { rejectLegacyLucyDefault = false } = {}) {
  for (const value of values) {
    const candidate = cleanString(value);
    if (!candidate) continue;
    if (rejectLegacyLucyDefault && candidate === LEGACY_LUCYLAB_DEFAULT_VOICE_ID) continue;
    return candidate;
  }
  return "";
}

export function cleanTelegramScriptText(text) {
  if (!text) return "";
  const lines = String(text)
    .replace(/📝\s*\*{0,2}Kịch bản đề xuất:\*{0,2}\s*/i, "")
    .split(/\r?\n/);

  const cleanLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (cleanLines.length > 0) cleanLines.push("");
      continue;
    }

    if (
      /^👇\s*\*{0,2}Bước\s+1\/2\b/i.test(line) ||
      /^📺\s*\*{0,2}Kênh đã chọn\b/i.test(line) ||
      /^👇\s*\*{0,2}Bước\s+2\/2\b/i.test(line)
    ) {
      break;
    }

    cleanLines.push(rawLine.trimEnd());
  }

  return cleanLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function pickVoiceCandidate(item) {
  if (!item || typeof item !== "object") return "";
  return firstFilledString([
    item.userVoiceId,
    item.user_voice_id,
    item.voiceId,
    item.voice_id,
    item.id,
    item._id
  ]);
}

export function resolveTtsApiKey(engineType, syncedCreds = {}, env = {}) {
  if (engineType === "tts_eleven") {
    const apiKey = firstFilledString([syncedCreds.elevenLabsApiKey, env.DEFAULT_ELEVEN_KEY]);
    if (!apiKey) throw new Error("Chưa cấu hình DEFAULT_ELEVEN_KEY!");
    return apiKey;
  }

  if (engineType === "tts_lucy") {
    const apiKey = firstFilledString([
      syncedCreds.lucyLabApiKey,
      env.DEFAULT_LUCY_KEY,
      env.LUCY_KEY,
      env.LUCY_API_KEY
    ]);
    if (!apiKey) throw new Error("Chưa cấu hình API Key LucyLab (DEFAULT_LUCY_KEY hoặc LUCY_KEY)!");
    return apiKey;
  }

  if (engineType === "tts_vclip") {
    const apiKey = firstFilledString([
      syncedCreds.vclipApiKey,
      env.DEFAULT_VCLIP_KEY,
      env.VCLIP_KEY,
      env.VCLIP_API_KEY
    ]);
    if (!apiKey) throw new Error("Chưa cấu hình API Key VClip (DEFAULT_VCLIP_KEY hoặc VCLIP_KEY)!");
    return apiKey;
  }

  throw new Error("Động cơ TTS không được hỗ trợ.");
}

export function resolveTtsConfig(engineType, syncedCreds = {}, env = {}, fetchedVoice = null) {
  if (engineType === "tts_eleven") {
    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      host: "api.elevenlabs.io",
      fileName: "elevenlabs_voice.mp3",
      speed: 1.0
    };
  }

  if (engineType === "tts_lucy") {
    const voiceId = firstFilledString([
      syncedCreds.lucyLabVoiceId,
      env.DEFAULT_LUCY_VOICE_ID,
      env.LUCY_VOICE_ID,
      env.LUCY_USER_VOICE_ID,
      env.USER_VOICE_ID,
      env.DEFAULT_VOICE_ID,
      fetchedVoice,
      LEGACY_LUCYLAB_DEFAULT_VOICE_ID
    ]);

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api.lucylab.io",
      fileName: "lucylab_voice.mp3",
      speed: 0.85
    };
  }

  if (engineType === "tts_vclip") {
    const voiceId = firstFilledString([
      syncedCreds.vclipVoiceId,
      env.DEFAULT_VCLIP_VOICE_ID,
      env.VCLIP_VOICE_ID,
      env.VCLIP_USER_VOICE_ID,
      fetchedVoice
    ], { rejectLegacyLucyDefault: true });

    if (!voiceId) {
      throw new Error("Chưa cấu hình userVoiceId VClip hợp lệ. Vui lòng nhập đúng ID giọng VClip trong Web App rồi đồng bộ lại Telegram.");
    }

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api-tts.vclip.io",
      fileName: "vclip_voice.mp3",
      speed: 1.0
    };
  }

  throw new Error("Động cơ TTS không được hỗ trợ.");
}

export function readExportResult(result = {}) {
  const audioUrl = firstFilledString([
    result.url,
    result.audioUrl,
    result.downloadUrl,
    result.fileUrl,
    result.audio_url,
    result.download_url
  ]);
  const state = firstFilledString([result.status, result.state]).toLowerCase();
  const failed = ["failed", "error", "errored"].includes(state);
  const completed = Boolean(audioUrl) || ["completed", "complete", "success", "succeeded"].includes(state);

  return { state, audioUrl, failed, completed };
}

export function extractComparisonPairs(scriptText) {
  const lines = cleanTelegramScriptText(scriptText)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const pairs = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const leftMatch = lines[i].match(/^(?:đây là|day la)\s+(.+?)[.?!]*$/i);
    const rightMatch = lines[i + 1].match(/^(?:đây là|day la)\s+(.+?)[.?!]*$/i);
    if (leftMatch && rightMatch) {
      pairs.push({
        leftTitle: leftMatch[1].trim(),
        rightTitle: rightMatch[1].trim(),
        startIndex: i
      });
    }
  }

  return pairs;
}

function buildImageSearchQueries(title) {
  const cleanTitle = cleanString(title)
    .replace(/^con\s+/i, "")
    .replace(/^chó\s+/i, "")
    .replace(/^cho\s+/i, "")
    .replace(/^mèo\s+/i, "")
    .replace(/^meo\s+/i, "");

  const queries = [title, cleanTitle]
    .map(q => cleanString(q))
    .filter(Boolean);

  return [...new Set(queries.flatMap(q => [`${q} photo`, `${q} animal`, q]))];
}

async function fetchWikimediaImage(title) {
  for (const query of buildImageSearchQueries(title)) {
    try {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "6");
      url.searchParams.set("gsrsearch", query);
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url|mime");
      url.searchParams.set("iiurlwidth", "720");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "ViCompareBot/1.0 (image search for user-created videos)" }
      });
      if (!res.ok) continue;

      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});
      const image = pages
        .map(page => page.imageinfo?.[0])
        .find(info => info?.thumburl && /^image\//.test(info.mime || ""));

      if (image?.thumburl) return image.thumburl;
    } catch (e) {}
  }

  return "";
}

async function fetchComparisonImages(scriptText) {
  const pairs = extractComparisonPairs(scriptText);
  return Promise.all(pairs.map(async (pair) => ({
    ...pair,
    leftImageUrl: await fetchWikimediaImage(pair.leftTitle),
    rightImageUrl: await fetchWikimediaImage(pair.rightTitle)
  })));
}

async function pollExportAudioUrl(host, apiKey, exportId, engineName) {
  for (let i = 0; i < 18; i++) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const statusRes = await fetch(`https://${host}/json-rpc`, {
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

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();
    if (statusData.error) {
      throw new Error(`${engineName}: ${statusData.error.message || "Lỗi kiểm tra tiến trình."}`);
    }

    const exportResult = readExportResult(statusData.result || {});
    if (exportResult.audioUrl) return exportResult.audioUrl;
    if (exportResult.failed) throw new Error(`${engineName}: Tiến trình tạo giọng nói bị lỗi.`);
  }

  throw new Error(`${engineName}: Quá thời gian tạo file.`);
}

export function buildWebAppUrls({
  sessionId,
  chatId,
  channelId,
  scriptText,
  audioUrl,
  comparisonImages = [],
  includeInlinePayload = false
}) {
  const inlinePayload = includeInlinePayload
    ? {
        sessionId,
        chatId,
        channelId,
        scriptText: cleanTelegramScriptText(scriptText),
        audioUrl,
        comparisonImages,
        createdAt: new Date(0).toISOString()
      }
    : null;
  const encodedPayload = inlinePayload
    ? btoa(unescape(encodeURIComponent(JSON.stringify(inlinePayload))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "")
    : "";

  const buildUrl = (auto) => {
    const url = new URL("https://vicompare.pages.dev/");
    url.searchParams.set("session", sessionId);
    url.searchParams.set("chatId", String(chatId));
    if (auto) url.searchParams.set("auto", "true");

    if (encodedPayload) {
      url.hash = new URLSearchParams({ tdata: encodedPayload }).toString();
    }

    return url.toString();
  };

  return {
    autoUrl: buildUrl(true),
    previewUrl: buildUrl(false)
  };
}

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

    // 1. POST /api/sync-profiles - Đồng bộ danh sách Kênh & Thông tin API Key/VoiceID từ Web App
    if (url.pathname === "/api/sync-profiles" && request.method === "POST") {
      try {
        const body = await request.json();
        if (env.VICOMPARE_KV) {
          if (body.profiles && Array.isArray(body.profiles)) {
            const profilesToSave = body.profiles.map(p => ({
              id: p.id,
              name: p.name || p.headerTitle || p.id
            }));
            await env.VICOMPARE_KV.put("channel_profiles", JSON.stringify(profilesToSave));
          }
          if (body.credentials) {
            await env.VICOMPARE_KV.put("app_credentials", JSON.stringify(body.credentials));
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
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
        const token = env.TELEGRAM_BOT_TOKEN;
        const contentType = request.headers.get("Content-Type") || "";
        let chatId = "";
        let videoTitle = "Video so sánh";
        let publishCaption = "";
        let videoFile = null;

        if (contentType.includes("multipart/form-data")) {
          const form = await request.formData();
          chatId = cleanString(form.get("chatId"));
          videoTitle = cleanString(form.get("videoTitle")) || videoTitle;
          publishCaption = ensurePublishHashtags(cleanString(form.get("caption")) || videoTitle);
          videoFile = form.get("video");
        } else {
          const body = await request.json();
          chatId = body.chatId;
          videoTitle = body.videoTitle || videoTitle;
          publishCaption = ensurePublishHashtags(body.caption || videoTitle);
        }

        if (chatId && token) {
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

          if (videoFile && typeof videoFile.arrayBuffer === "function") {
            const videoBuffer = await videoFile.arrayBuffer();
            await sendTelegramDocument(
              chatId,
              videoBuffer,
              `${videoTitle.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "video_so_sanh"}.webm`,
              token,
              `🎉 Video "${videoTitle}" đã render xong.\n\n📝 Caption sẽ đăng:\n${publishCaption}\n\nCAPTION:${publishCaption}\n\n👇 Bấm nút dưới đây để đăng trực tiếp:`,
              replyMarkup
            );
          } else {
            const msg = `🎉 **Video "${videoTitle}" đã được tạo xong trên Web Tool!**\n\n📝 Caption sẽ đăng:\n${publishCaption}\n\nCAPTION:${publishCaption}\n\n👇 Chọn nền tảng Mạng xã hội để xuất bản ngay lập tức:`;
            await sendTelegramMessage(chatId, msg, token, replyMarkup, "Markdown");
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 5. GET /api/audio - Proxy audio đã gửi qua Telegram bằng file_id để Web Tool export có tiếng ổn định trên prod
    if (url.pathname === "/api/audio" && request.method === "GET") {
      try {
        const fileId = cleanString(url.searchParams.get("file_id"));
        if (!fileId) {
          return new Response("Missing file_id", { status: 400, headers: corsHeaders });
        }

        const token = env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          return new Response("Missing bot token", { status: 500, headers: corsHeaders });
        }

        const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const fileInfo = await fileInfoRes.json().catch(() => ({}));
        const filePath = fileInfo.result?.file_path;
        if (!fileInfoRes.ok || !filePath) {
          return new Response("Telegram file not found", { status: 404, headers: corsHeaders });
        }

        const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", audioRes.headers.get("Content-Type") || "audio/mpeg");
        const contentLength = audioRes.headers.get("Content-Length");
        if (contentLength) headers.set("Content-Length", contentLength);

        return new Response(audioRes.body, {
          status: audioRes.status,
          headers
        });
      } catch (err) {
        return new Response(`Audio proxy error: ${err.message}`, { status: 502, headers: corsHeaders });
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
        ctx.waitUntil(handleCallbackQuery(update.callback_query, token, env));
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

// Helper tự động lấy Voice ID hợp lệ từ tài khoản LucyLab / VClip
async function fetchVoiceId(host, apiKey) {
  const methods = ["getUserVoices", "getVoices", "getPublicVoices"];
  for (const m of methods) {
    try {
      const res = await fetch(`https://${host}/json-rpc`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: m, input: { limit: 20, page: 1 } })
      });
      const data = await res.json();
      const list = data.result?.items || data.result?.voices || (Array.isArray(data.result) ? data.result : []);
      if (list && Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          if (!item) continue;
          const candidate = pickVoiceCandidate(item);
          if (candidate) return candidate;
        }
      }
    } catch (e) {}
  }
  return null;
}

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
    "Dựa trên hình ảnh hoặc chủ đề được cung cấp, hãy TỰ ĐỘNG XÂY DỰNG KỊCH BẢN GỒM ÍT NHẤT 2 ĐẾN 3 CẶP SO SÁNH NỐI TIẾP NHAU (mỗi cặp gồm 1 khối 5 dòng) để video đạt độ dài chuẩn từ 20 đến 35 giây.\n\n" +
    "QUY TẮC ĐỊNH DẠNG KHẮT KHE:\n" +
    "- Viết các khối 5 dòng nối tiếp nhau liền mạch.\n" +
    "- Tuyệt đối KHÔNG thêm số thứ tự (ví dụ: Cặp 1, Cặp 2), tiêu đề hay từ ngữ dẫn giải nào ngoài đúng các dòng kịch bản.\n\n" +
    "Cấu trúc của MỖI KHỐI 5 DÒNG như sau:\n" +
    "Dòng 1: Đây là [Tên đối tượng A].\n" +
    "Dòng 2: Đây là [Tên đối tượng B].\n" +
    "Dòng 3: Sự khác nhau là gì?\n" +
    "Dòng 4: [Mô tả ngắn gọn, súc tích về đối tượng A, nêu bật 2-3 điểm đặc trưng cốt lõi].\n" +
    "Dòng 5: [Mô tả ngắn gọn, súc tích về đối tượng B, nêu bật 2-3 điểm đặc trưng cốt lõi].\n\n" +
    "Ví dụ kịch bản mẫu 2 cặp (10 dòng):\n" +
    "Đây là Bắc Cực.\n" +
    "Đây là Nam Cực.\n" +
    "Sự khác nhau là gì?\n" +
    "Bắc Cực là vùng biển đóng băng nằm ở phía bắc Trái Đất, được bao quanh bởi các lục địa. Nơi đây có gấu Bắc Cực sinh sống.\n" +
    "Nam Cực là một lục địa phủ băng nằm ở phía nam Trái Đất, được bao quanh bởi đại dương. Nơi đây lạnh hơn và có chim cánh cụt.\n" +
    "Đây là Gấu Bắc Cực.\n" +
    "Đây là Chim Cánh Cụt.\n" +
    "Sự khác nhau là gì?\n" +
    "Gấu Bắc Cực là loài thú săn mồi đi trên băng, sở hữu lớp mỡ dày và bộ lông trắng ngụy trang xuất sắc.\n" +
    "Chim Cánh Cụt là loài chim không biết bay, bơi lặn cực giỏi và sống thành từng đàn lớn ở vùng băng tuyết.";

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
  if (callbackQuery.id) {
    try {
      await answerTelegramCallbackQuery(callbackQuery.id, token);
    } catch (e) {}
  }

  // 1. Xử lý bấm chọn Nền tảng Đăng MXH (Social Publish)
  if (data.startsWith("pub_")) {
    const [platformCode, titleSnippet] = data.split("|");
    const platformNames = {
      pub_fb: "📘 Facebook",
      pub_yt: "🔴 YouTube",
      pub_tt: "🎵 TikTok"
    };
    const platformName = platformNames[platformCode] || "Mạng xã hội";

    const videoFileId = callbackQuery.message?.document?.file_id || callbackQuery.message?.video?.file_id;
    if (!videoFileId) {
      await sendTelegramMessage(chatId, `⚠️ Không tìm thấy file video trong tin nhắn này để đăng lên ${platformName}. Vui lòng render lại từ Web Tool.`, token);
      return;
    }

    await sendTelegramMessage(chatId, `🚀 Đã nhận lệnh đăng "${titleSnippet || "video"}" lên ${platformName}. Đang upload thật...`, token);
    try {
      const videoBuffer = await downloadTelegramFile(videoFileId, token);
      const caption = extractPublishCaption(callbackQuery.message?.caption || callbackQuery.message?.text || "") || ensurePublishHashtags(titleSnippet || "Video So Sánh");
      let result = null;
      if (platformCode === "pub_fb") {
        result = await publishFacebookReel(videoBuffer, caption, env);
      } else if (platformCode === "pub_yt") {
        result = await publishYouTubeShort(videoBuffer, caption, env);
      } else {
        result = await publishTikTokVideo(videoBuffer, caption, env);
      }

      await sendTelegramMessage(chatId, `✅ Đăng ${platformName} thành công!\nID: ${result.id || "N/A"}`, token);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Đăng ${platformName} thất bại: ${err.message}`, token);
    }
    return;
  }

  // 2. BƯỚC 1: Xử lý bấm chọn Mẫu Kênh (`chan_...`)
  if (data.startsWith("chan_")) {
    const channelId = data.replace("chan_", "");
    const profiles = await getProfiles(env);
    const selectedProfile = profiles.find(p => p.id === channelId) || { name: channelId };

    // Trích xuất kịch bản từ nội dung tin nhắn cũ
    const scriptText = cleanTelegramScriptText(messageText);

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

    const nextText = `📝 **Kịch bản đề xuất:**\n\n${scriptText}\n\n📺 **Kênh đã chọn:** ${selectedProfile.name}\n👇 **Bước 2/2: Chọn Động cơ Giọng đọc TTS:**`;
    const edited = await editTelegramMessageText(
      chatId,
      callbackQuery.message.message_id,
      nextText,
      token,
      voiceMarkup,
      "Markdown"
    );
    if (!edited) {
      await sendTelegramMessage(chatId, nextText, token, voiceMarkup, "Markdown");
    }
    return;
  }

  // 3. BƯỚC 2: Xử lý bấm chọn Giọng đọc (`tts_...|channelId`)
  if (data.startsWith("tts_")) {
    const [engineType, channelId = 'cat-thong-thai'] = data.split("|");

    // Trích xuất kịch bản từ nội dung tin nhắn
    const scriptText = cleanTelegramScriptText(messageText);
    
    if (!scriptText) {
      await sendTelegramMessage(chatId, "⚠️ Không tìm thấy văn bản kịch bản để tạo giọng đọc.", token);
      return;
    }

    await sendTelegramMessage(chatId, "🎙️ Đang kết nối API tạo giọng đọc & tự động đồng bộ nhịp phụ đề...", token);

    try {
      let audioBuffer = null;
      let fileName = "voice.mp3";
      let audioUrlResult = null;

      let syncedCreds = {};
      try {
        if (env.VICOMPARE_KV) {
          syncedCreds = (await env.VICOMPARE_KV.get("app_credentials", "json")) || {};
        }
      } catch (e) {}

      if (engineType === "tts_eleven") {
        const ttsConfig = resolveTtsConfig(engineType, syncedCreds, env);
        
        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ttsConfig.voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": ttsConfig.apiKey,
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
        fileName = ttsConfig.fileName;

      } else if (engineType === "tts_lucy") {
        const apiKey = resolveTtsApiKey(engineType, syncedCreds, env);
        const fetchedVoice = await fetchVoiceId("api.lucylab.io", apiKey);
        const ttsConfig = resolveTtsConfig(engineType, syncedCreds, env, fetchedVoice);
        
        let startRes = await fetch("https://api.lucylab.io/json-rpc", {
          method: "POST",
          headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "ttsLongText",
            input: {
              text: String(scriptText).trim(),
              userVoiceId: ttsConfig.voiceId,
              speed: ttsConfig.speed
            }
          })
        });
        let startData = await startRes.json();

        if (startData.error) {
          startRes = await fetch("https://api.lucylab.io/json-rpc", {
            method: "POST",
            headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "ttsLongText",
              input: {
                text: String(scriptText).trim(),
                voiceId: ttsConfig.voiceId,
                speed: ttsConfig.speed
              }
            })
          });
          const retryData = await startRes.json();
          if (!retryData.error) {
            startData = retryData;
          }
        }

        if (startData.error) throw new Error(`LucyLab API: ${startData.error.message || JSON.stringify(startData.error)} (Dùng VoiceID: ${ttsConfig.voiceId})`);

        const exportId = startData.result?.projectExportId;
        if (!exportId) throw new Error("LucyLab: Không nhận được export ID.");

        audioUrlResult = await pollExportAudioUrl(ttsConfig.host, ttsConfig.apiKey, exportId, "LucyLab");
        const audioRes = await fetch(audioUrlResult);
        audioBuffer = await audioRes.arrayBuffer();
        fileName = ttsConfig.fileName;

      } else if (engineType === "tts_vclip") {
        const apiKey = resolveTtsApiKey(engineType, syncedCreds, env);
        const fetchedVoice = await fetchVoiceId("api-tts.vclip.io", apiKey);
        const ttsConfig = resolveTtsConfig(engineType, syncedCreds, env, fetchedVoice);
        
        let startRes = await fetch("https://api-tts.vclip.io/json-rpc", {
          method: "POST",
          headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "ttsLongText",
            input: {
              text: String(scriptText).trim(),
              userVoiceId: ttsConfig.voiceId,
              speed: ttsConfig.speed
            }
          })
        });
        let startData = await startRes.json();

        if (startData.error) {
          startRes = await fetch("https://api-tts.vclip.io/json-rpc", {
            method: "POST",
            headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "ttsLongText",
              input: {
                text: String(scriptText).trim(),
                voiceId: ttsConfig.voiceId,
                speed: ttsConfig.speed
              }
            })
          });
          const retryData = await startRes.json();
          if (!retryData.error) {
            startData = retryData;
          }
        }

        if (startData.error) throw new Error(`VClip API: ${startData.error.message || JSON.stringify(startData.error)} (Dùng VoiceID: ${ttsConfig.voiceId})`);

        const exportId = startData.result?.projectExportId;
        if (!exportId) throw new Error("VClip: Không nhận được export ID.");

        audioUrlResult = await pollExportAudioUrl(ttsConfig.host, ttsConfig.apiKey, exportId, "VClip");
        const audioRes = await fetch(audioUrlResult);
        audioBuffer = await audioRes.arrayBuffer();
        fileName = ttsConfig.fileName;
      }

      if (audioBuffer) {
        // Gửi tệp âm thanh nghe thử về Telegram
        const telegramAudioFileId = await sendTelegramAudio(chatId, audioBuffer, fileName, token);
        const webAudioUrl = telegramAudioFileId
          ? `${WORKER_PUBLIC_BASE_URL}/api/audio?file_id=${encodeURIComponent(telegramAudioFileId)}`
          : audioUrlResult;

        // Tạo phiên làm việc (Session) và lưu vào KV
        const sessionId = `s_${Math.random().toString(36).substring(2, 10)}`;
        let base64Audio = "";
        try {
          base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
        } catch (e) {}

        const comparisonImages = await fetchComparisonImages(scriptText);

        const sessionPayload = {
          sessionId,
          chatId,
          channelId,
          scriptText,
          audioBase64: base64Audio,
          audioUrl: webAudioUrl || null,
          comparisonImages,
          createdAt: new Date().toISOString()
        };

        let sessionSaved = false;
        if (env.VICOMPARE_KV) {
          await env.VICOMPARE_KV.put(`session:${sessionId}`, JSON.stringify(sessionPayload), { expirationTtl: 86400 });
          sessionSaved = true;
        }

        // Tạo link chuyển hướng 1-Click sang Web App (Auto Render 0-Click hoặc Preview xem trước)
        const { autoUrl: webAppAutoUrl, previewUrl: webAppPreviewUrl } = buildWebAppUrls({
          sessionId,
          chatId,
          channelId,
          scriptText,
          audioUrl: webAudioUrl || null,
          comparisonImages,
          includeInlinePayload: !sessionSaved
        });

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

// Helper xác nhận Telegram đã nhận callback để nút bấm không bị loading mãi
async function answerTelegramCallbackQuery(callbackQueryId, token) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

// Helper sửa tin nhắn hiện tại để không tạo thêm block kịch bản trùng khi chọn kênh
async function editTelegramMessageText(chatId, messageId, text, token, replyMarkup = null, parseMode = null) {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text
  };
  if (parseMode) body.parse_mode = parseMode;
  if (replyMarkup) body.reply_markup = replyMarkup;

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok && parseMode) {
    delete body.parse_mode;
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  return res.ok;
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

async function sendTelegramDocument(chatId, arrayBuffer, fileName, token, caption = "", replyMarkup = null) {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) formData.append("caption", caption);
  if (replyMarkup) formData.append("reply_markup", JSON.stringify(replyMarkup));
  const blob = new Blob([arrayBuffer], { type: "video/webm" });
  formData.append("document", blob, fileName);

  const res = await fetch(url, {
    method: "POST",
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.description || "Không gửi được video lên Telegram.");
  }
  return data.result?.document?.file_id || "";
}

async function downloadTelegramFile(fileId, token) {
  const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileInfo = await fileInfoRes.json().catch(() => ({}));
  const filePath = fileInfo.result?.file_path;
  if (!fileInfoRes.ok || !filePath) {
    throw new Error("Không tải được thông tin file video từ Telegram.");
  }
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error("Không tải được file video từ Telegram CDN.");
  }
  return await fileRes.arrayBuffer();
}

function requireEnv(env, keys) {
  for (const key of keys) {
    const value = cleanString(env[key]);
    if (value) return value;
  }
  throw new Error(`Thiếu cấu hình ${keys[0]} trên Worker.`);
}

function ensurePublishHashtags(caption) {
  const base = cleanString(caption) || "Video so sánh thú vị";
  const withoutTags = base
    .replace(/#shorts/gi, "")
    .replace(/#reels/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${withoutTags} #shorts #reels`.trim();
}

function extractPublishCaption(messageText) {
  const text = String(messageText || "");
  const match = text.match(/(?:^|\n)CAPTION:\s*([\s\S]*?)(?:\n\n👇|\n?$)/i);
  return match ? ensurePublishHashtags(match[1]) : "";
}

async function publishFacebookReel(videoBuffer, title, env) {
  const pageId = requireEnv(env, ["FB_PAGE_ID", "DEFAULT_FB_PAGE_ID"]);
  const accessToken = requireEnv(env, ["FB_ACCESS_TOKEN", "DEFAULT_FB_TOKEN"]);

  const startRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: accessToken,
      upload_phase: "start"
    })
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok) {
    throw new Error(startData.error?.message || "Khởi tạo Facebook Reel lỗi.");
  }

  const { video_id, upload_url } = startData;
  if (!video_id || !upload_url) {
    throw new Error("Facebook không trả về video_id/upload_url.");
  }

  const uploadRes = await fetch(upload_url, {
    method: "POST",
    headers: {
      "Authorization": `OAuth ${accessToken}`,
      "offset": "0",
      "file_size": String(videoBuffer.byteLength),
      "Content-Type": "application/octet-stream"
    },
    body: videoBuffer
  });
  if (!uploadRes.ok) {
    const uploadErr = await uploadRes.text().catch(() => "");
    throw new Error(`Upload video Facebook lỗi: ${uploadErr || uploadRes.statusText}`);
  }

  const finishRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: accessToken,
      upload_phase: "finish",
      video_id,
      video_state: "PUBLISHED",
      description: title
    })
  });
  const finishData = await finishRes.json().catch(() => ({}));
  if (!finishRes.ok) {
    throw new Error(finishData.error?.message || "Hoàn tất xuất bản Facebook lỗi.");
  }

  return { id: finishData.fb_id || finishData.id || video_id };
}

async function publishYouTubeShort(videoBuffer, title, env) {
  const clientId = requireEnv(env, ["YT_CLIENT_ID", "DEFAULT_YT_CLIENT_ID"]);
  const clientSecret = requireEnv(env, ["YT_CLIENT_SECRET", "DEFAULT_YT_CLIENT_SECRET"]);
  const refreshToken = requireEnv(env, ["YT_REFRESH_TOKEN", "DEFAULT_YT_REFRESH_TOKEN"]);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Không gia hạn được YouTube token.");
  }

  const boundary = `----vicompare-${crypto.randomUUID()}`;
  const metadata = {
    snippet: {
      title: title.slice(0, 100) || "Video So Sánh",
      description: title,
      tags: ["shorts", "videososanh"],
      categoryId: "22"
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: video/webm\r\n\r\n`
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.byteLength + videoBuffer.byteLength + suffix.byteLength);
  body.set(prefix, 0);
  body.set(new Uint8Array(videoBuffer), prefix.byteLength);
  body.set(suffix, prefix.byteLength + videoBuffer.byteLength);

  const uploadRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error(uploadData.error?.message || "Upload YouTube thất bại.");
  }

  return { id: uploadData.id };
}

export function resolveTikTokCredentials(syncedCreds = {}, env = {}) {
  const clientKey = firstFilledString([
    syncedCreds.ttClientKey,
    syncedCreds.tt_client_key,
    env.TT_CLIENT_KEY,
    env.TIKTOK_CLIENT_KEY
  ]);
  const clientSecret = firstFilledString([
    syncedCreds.ttClientSecret,
    syncedCreds.tt_client_secret,
    env.TT_CLIENT_SECRET,
    env.TIKTOK_CLIENT_SECRET
  ]);
  const refreshToken = firstFilledString([
    syncedCreds.ttRefreshToken,
    syncedCreds.tt_refresh_token,
    env.TT_REFRESH_TOKEN,
    env.TIKTOK_REFRESH_TOKEN
  ]);
  const accessToken = firstFilledString([
    syncedCreds.ttAccessToken,
    syncedCreds.tt_access_token,
    env.TT_ACCESS_TOKEN,
    env.TIKTOK_ACCESS_TOKEN
  ]);

  if (!accessToken && !(clientKey && clientSecret && refreshToken)) {
    throw new Error("Chưa cấu hình TikTok Access Token hoặc bộ Client Key/Secret + Refresh Token.");
  }

  return { clientKey, clientSecret, refreshToken, accessToken };
}

async function getSyncedCredentials(env) {
  try {
    if (env.VICOMPARE_KV) {
      return (await env.VICOMPARE_KV.get("app_credentials", "json")) || {};
    }
  } catch (e) {}
  return {};
}

export function getTikTokApiErrorMessage(payload = {}, fallback = "TikTok API error") {
  const error = payload.error || {};
  return firstFilledString([
    payload.error_description,
    typeof payload.error === "string" ? payload.error : "",
    error.message,
    error.code,
    fallback
  ]);
}

export function pickTikTokPrivacyLevel(options = []) {
  const allowed = Array.isArray(options) ? options.map(cleanString).filter(Boolean) : [];
  return allowed.find(item => item === "PUBLIC_TO_EVERYONE")
    || allowed.find(item => item === "MUTUAL_FOLLOW_FRIENDS")
    || allowed.find(item => item === "FOLLOWER_OF_CREATOR")
    || allowed.find(item => item === "SELF_ONLY")
    || "SELF_ONLY";
}

async function refreshTikTokAccessToken(credentials) {
  if (!credentials.clientKey || !credentials.clientSecret || !credentials.refreshToken) {
    return { accessToken: credentials.accessToken, tokenData: null };
  }

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache"
    },
    body: new URLSearchParams({
      client_key: credentials.clientKey,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(getTikTokApiErrorMessage(tokenData, "Không gia hạn được TikTok token."));
  }
  return { accessToken: tokenData.access_token, tokenData };
}

async function queryTikTokCreatorInfo(accessToken) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(getTikTokApiErrorMessage(data, "Không lấy được TikTok creator info."));
  }
  return data.data || {};
}

async function initTikTokVideoPublish(accessToken, caption, videoSize, privacyLevel) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      post_info: {
        title: cleanString(caption).slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: true
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1
      }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error?.code !== "ok" || !data.data?.publish_id || !data.data?.upload_url) {
    throw new Error(getTikTokApiErrorMessage(data, "Không khởi tạo được phiên đăng TikTok."));
  }
  return data.data;
}

async function publishTikTokVideo(videoBuffer, caption, env) {
  const syncedCreds = await getSyncedCredentials(env);
  const credentials = resolveTikTokCredentials(syncedCreds, env);
  const { accessToken, tokenData } = await refreshTikTokAccessToken(credentials);
  if (!accessToken) throw new Error("Thiếu TikTok access token.");

  if (tokenData?.access_token && env.VICOMPARE_KV) {
    const nextCreds = {
      ...syncedCreds,
      ttAccessToken: tokenData.access_token,
      tt_access_token: tokenData.access_token,
      ttRefreshToken: tokenData.refresh_token || credentials.refreshToken,
      tt_refresh_token: tokenData.refresh_token || credentials.refreshToken,
      ttOpenId: tokenData.open_id || syncedCreds.ttOpenId || syncedCreds.tt_open_id || "",
      tt_open_id: tokenData.open_id || syncedCreds.ttOpenId || syncedCreds.tt_open_id || ""
    };
    await env.VICOMPARE_KV.put("app_credentials", JSON.stringify(nextCreds));
  }

  const creatorInfo = await queryTikTokCreatorInfo(accessToken);
  const privacyLevel = pickTikTokPrivacyLevel(creatorInfo.privacy_level_options);
  const initData = await initTikTokVideoPublish(accessToken, caption, videoBuffer.byteLength, privacyLevel);

  const uploadRes = await fetch(initData.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoBuffer.byteLength - 1}/${videoBuffer.byteLength}`
    },
    body: videoBuffer
  });
  if (!uploadRes.ok) {
    const uploadErr = await uploadRes.text().catch(() => "");
    throw new Error(`Upload video TikTok lỗi: ${uploadErr || uploadRes.statusText}`);
  }

  return {
    id: initData.publish_id,
    privacyLevel,
    creator: creatorInfo.creator_username || creatorInfo.creator_nickname || ""
  };
}

// Helper gửi file nhị phân Audio lên Telegram
async function sendTelegramAudio(chatId, arrayBuffer, fileName, token) {
  const url = `https://api.telegram.org/bot${token}/sendAudio`;
  const formData = new FormData();
  formData.append("chat_id", chatId);
  
  const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
  formData.append("audio", blob, fileName);

  const res = await fetch(url, {
    method: "POST",
    body: formData
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("sendTelegramAudio failed:", data);
    return "";
  }

  return data.result?.audio?.file_id || data.result?.document?.file_id || "";
}

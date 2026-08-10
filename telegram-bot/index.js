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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Sync-Token"
};

const WORKER_PUBLIC_BASE_URL = "https://vicompare-telegram-bot.qhboypho.workers.dev";
const IMAGE_SEARCH_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const LEGACY_LUCYLAB_DEFAULT_VOICE_ID = "67e37e5c5ffbc46fa2e75e11";

function isAuthorizedSettingsSyncRequest(request, env) {
  const expected = cleanString(env.APP_SETTINGS_SYNC_TOKEN);
  if (!expected) return true;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("X-Sync-Token") || "";
  return bearer === expected || headerToken === expected;
}

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

function firstFiniteNumber(values, fallback = 1.0) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const candidate = typeof value === "number" ? value : Number.parseFloat(value);
    if (Number.isFinite(candidate)) return candidate;
  }
  return fallback;
}

function normalizeVoicefreeModelId(modelId) {
  const candidate = cleanString(modelId);
  if (!candidate || candidate === "Eleven v3") return "eleven_v3";
  return candidate;
}

export function splitScriptTextSegments(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => /[.!?:…]$/.test(line) ? line : `${line}.`);
}

export const splitVoicefreeTextSegments = splitScriptTextSegments;

const TELEGRAM_GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
const TELEGRAM_GEMINI_TIMEOUT_MS = 9000;

export function buildGeminiGenerationBody(parts, { maxOutputTokens = 1400 } = {}) {
  return {
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens,
      thinkingConfig: {
        thinkingLevel: "minimal"
      }
    }
  };
}

function isRetryableGeminiStatus(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

export async function requestGeminiContent({
  apiKey,
  parts,
  fetchImpl = fetch,
  timeoutMs = TELEGRAM_GEMINI_TIMEOUT_MS,
  maxOutputTokens = 1400,
  models = TELEGRAM_GEMINI_MODELS
}) {
  let lastError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(buildGeminiGenerationBody(parts, { maxOutputTokens })),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const error = new Error(`Gemini ${model} lỗi ${response.status}: ${errorText || response.statusText}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const result = (data.candidates?.[0]?.content?.parts || [])
        .map(part => cleanString(part?.text))
        .filter(Boolean)
        .join("\n")
        .trim();

      if (!result) {
        const finishReason = data.candidates?.[0]?.finishReason || "EMPTY_RESPONSE";
        const error = new Error(`Gemini ${model} không trả nội dung (${finishReason}).`);
        error.status = 503;
        throw error;
      }

      console.log(`Gemini ${model} completed in ${Date.now() - startedAt}ms.`);
      return result;
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      lastError = timedOut
        ? new Error(`Gemini ${model} phản hồi quá ${Math.ceil(timeoutMs / 1000)} giây.`)
        : error;
      const canTryFallback = index < models.length - 1
        && (timedOut || isRetryableGeminiStatus(Number(error?.status)));

      console.warn(`Gemini ${model} failed after ${Date.now() - startedAt}ms: ${lastError.message}`);
      if (!canTryFallback) throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Gemini tạm thời không phản hồi.");
}



function base64ToArrayBuffer(base64) {
  const clean = cleanString(base64).replace(/^data:[^,]+,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function mergeSyncedCredentials(existing = {}, incoming = {}) {
  const next = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const source = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      const candidate = cleanString(value);
      if (!candidate) continue;
      if (key === "vclipVoiceId" && candidate === LEGACY_LUCYLAB_DEFAULT_VOICE_ID) continue;
      next[key] = candidate;
    } else if (value !== undefined && value !== null) {
      next[key] = value;
    }
  }

  return next;
}

export function buildCredentialsFromAppSettings(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const credentials = settings.credentials && typeof settings.credentials === "object" && !Array.isArray(settings.credentials)
    ? { ...settings.credentials }
    : {};

  const mirrorSetting = (settingsKey, credentialKey) => {
    const value = settings[settingsKey];
    if (value === undefined || value === null) return;
    if (typeof value === "string" && cleanString(value) === "") return;
    credentials[credentialKey] = value;
  };

  mirrorSetting("selectedVoiceId", "selectedVoiceId");
  mirrorSetting("selectedVoiceId", "elevenLabsVoiceId");
  mirrorSetting("vclipVoiceId", "vclipVoiceId");
  mirrorSetting("vclipSpeed", "vclipSpeed");
  mirrorSetting("lucyLabVoiceId", "lucyLabVoiceId");
  mirrorSetting("lucyLabSpeed", "lucyLabSpeed");
  mirrorSetting("voicefreeVoiceId", "voicefreeVoiceId");
  mirrorSetting("voicefreeProvider", "voicefreeProvider");
  mirrorSetting("voicefreeModelId", "voicefreeModelId");
  mirrorSetting("voicefreeSpeed", "voicefreeSpeed");

  return credentials;
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
      /^👇\s*\*{0,2}Bước\s+2\/2\b/i.test(line) ||
      /^📸\s*/i.test(line)
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

  if (engineType === "tts_voicefree") {
    const apiKey = firstFilledString([
      syncedCreds.voicefreeApiKey,
      syncedCreds.voicefree_api_key,
      env.DEFAULT_VOICEFREE_KEY,
      env.VOICEFREE_KEY,
      env.VOICEFREE_API_KEY
    ]);
    if (!apiKey) throw new Error("Chưa cấu hình API Key Voicefree (xi-api-key)!");
    return apiKey;
  }

  throw new Error("Động cơ TTS không được hỗ trợ.");
}

function resolveSyncedVoiceId(engineType, syncedCreds = {}) {
  if (engineType === "tts_eleven") {
    return firstFilledString([
      syncedCreds.elevenLabsVoiceId,
      syncedCreds.elevenlabsVoiceId,
      syncedCreds.elevenVoiceId,
      syncedCreds.selectedVoiceId,
      syncedCreds.eleven_labs_voice_id,
      syncedCreds.eleven_voice_id
    ]);
  }

  if (engineType === "tts_lucy") {
    return firstFilledString([
      syncedCreds.lucyLabVoiceId,
      syncedCreds.lucylabVoiceId,
      syncedCreds.lucyVoiceId,
      syncedCreds.lucy_lab_voice_id,
      syncedCreds.lucy_voice_id
    ]);
  }

  if (engineType === "tts_vclip") {
    return firstFilledString([
      syncedCreds.vclipVoiceId,
      syncedCreds.vclipUserVoiceId,
      syncedCreds.vclip_voice_id,
      syncedCreds.vclip_user_voice_id
    ], { rejectLegacyLucyDefault: true });
  }

  if (engineType === "tts_voicefree") {
    return firstFilledString([
      syncedCreds.voicefreeVoiceId,
      syncedCreds.voicefree_voice_id
    ]);
  }

  return "";
}

export function buildTtsEngineKeyboard(channelId) {
  return {
    inline_keyboard: [
      [
        { text: "🎙️ ElevenLabs", callback_data: `tts_eleven|${channelId}` },
        { text: "🎙️ LucyLab", callback_data: `tts_lucy|${channelId}` }
      ],
      [
        { text: "🎙️ VClip", callback_data: `tts_vclip|${channelId}` }
      ],
      [
        { text: "🎙️ Voicefree", callback_data: `tts_voicefree|${channelId}` }
      ],
      [
        { text: "🎙️ Local Clone", callback_data: `tts_local|${channelId}` }
      ]
    ]
  };
}

export function resolveTtsConfig(engineType, syncedCreds = {}, env = {}) {
  if (engineType === "tts_eleven") {
    const voiceId = resolveSyncedVoiceId(engineType, syncedCreds);
    if (!voiceId) {
      throw new Error("Chưa đồng bộ Voice ID ElevenLabs từ Web Tool. Vui lòng chọn/lưu giọng ElevenLabs trên Web Tool prd rồi đồng bộ lại Telegram.");
    }

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api.elevenlabs.io",
      fileName: "elevenlabs_voice.mp3",
      speed: 1.0
    };
  }

  if (engineType === "tts_lucy") {
    const voiceId = resolveSyncedVoiceId(engineType, syncedCreds);
    if (!voiceId) {
      throw new Error("Chưa đồng bộ Voice ID LucyLab từ Web Tool. Vui lòng chọn/lưu giọng LucyLab trên Web Tool prd rồi đồng bộ lại Telegram.");
    }

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api.lucylab.io",
      fileName: "lucylab_voice.mp3",
      speed: 0.85
    };
  }

  if (engineType === "tts_vclip") {
    const voiceId = resolveSyncedVoiceId(engineType, syncedCreds);

    if (!voiceId) {
      throw new Error("Chưa đồng bộ userVoiceId VClip hợp lệ từ Web Tool. Vui lòng nhập đúng ID giọng VClip trên Web Tool prd rồi đồng bộ lại Telegram.");
    }

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api-tts.vclip.io",
      fileName: "vclip_voice.mp3",
      speed: 1.0
    };
  }

  if (engineType === "tts_voicefree") {
    const voiceId = resolveSyncedVoiceId(engineType, syncedCreds);
    if (!voiceId) {
      throw new Error("Chưa đồng bộ Voice ID Voicefree từ Web Tool. Vui lòng nhập Voice ID Voicefree rồi đồng bộ lại Telegram.");
    }

    return {
      apiKey: resolveTtsApiKey(engineType, syncedCreds, env),
      voiceId,
      host: "api.taovoicefree.com",
      fileName: "voicefree_voice.mp3",
      provider: firstFilledString([syncedCreds.voicefreeProvider, syncedCreds.voicefree_provider, env.VOICEFREE_PROVIDER]) || "elevenlabs",
      modelId: normalizeVoicefreeModelId(firstFilledString([syncedCreds.voicefreeModelId, syncedCreds.voicefree_model_id, env.VOICEFREE_MODEL_ID])),
      speed: firstFiniteNumber([syncedCreds.voicefreeSpeed, syncedCreds.voicefree_speed, env.VOICEFREE_SPEED], 1.0)
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

const IMAGE_SUBJECT_ALIASES = new Map([
  ["chó doberman", "Dobermann"],
  ["cho doberman", "Dobermann"],
  ["doberman", "Dobermann"],
  ["chó rottweiler", "Rottweiler"],
  ["cho rottweiler", "Rottweiler"],
  ["chó pitbull", "American Pit Bull Terrier"],
  ["cho pitbull", "American Pit Bull Terrier"],
  ["pitbull", "American Pit Bull Terrier"],
  ["chó american bully", "American Bully"],
  ["cho american bully", "American Bully"],
  ["trí tuệ nhân tạo", "Artificial intelligence"],
  ["tri tue nhan tao", "Artificial intelligence"],
  ["trí tuệ con người", "Thinking"],
  ["tri tue con nguoi", "Thinking"],
  ["tư duy con người", "Thinking"],
  ["tu duy con nguoi", "Thinking"],
  ["khách quan", "Objectivity"],
  ["khach quan", "Objectivity"],
  ["chủ quan", "Subjectivity"],
  ["chu quan", "Subjectivity"]
]);

const DOG_BREED_TERMS = new Set([
  "dobermann",
  "doberman",
  "rottweiler",
  "american pit bull terrier",
  "pitbull",
  "american bully"
]);

const BAD_IMAGE_TITLE_TERMS = [
  "logo",
  "icon",
  "symbol",
  "map",
  "locator",
  "flag",
  "coat of arms",
  "emblem",
  "pdf",
  "book",
  "cover",
  "poster",
  "screenshot",
  "audio",
  ".oga",
  ".ogg",
  ".webm",
  ".svg"
];

const BAD_IMAGE_DOMAINS = [
  "wikipedia.org",
  "wikimedia.org",
  "wikiwand.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "reddit.com"
];

function normalizeImageSubject(title) {
  const raw = cleanString(title)
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ");
  const noPrefix = raw
    .replace(/^con\s+/i, "")
    .replace(/^chó\s+/i, "")
    .replace(/^cho\s+/i, "")
    .replace(/^mèo\s+/i, "")
    .replace(/^meo\s+/i, "")
    .trim();
  const lookupKey = raw.toLowerCase();
  const noPrefixKey = noPrefix.toLowerCase();

  return {
    raw,
    subject: IMAGE_SUBJECT_ALIASES.get(lookupKey) || IMAGE_SUBJECT_ALIASES.get(noPrefixKey) || noPrefix || raw,
    noPrefix
  };
}

function tokenizeImageText(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeDogBreed(subject) {
  const normalized = tokenizeImageText(subject).join(" ");
  return DOG_BREED_TERMS.has(normalized);
}

export function buildImageSearchQueries(title) {
  const { raw, subject, noPrefix } = normalizeImageSubject(title);
  const baseQueries = [subject, noPrefix, raw]
    .map(q => cleanString(q))
    .filter(Boolean);

  const queries = [];
  for (const q of baseQueries) {
    if (looksLikeDogBreed(q)) {
      queries.push(`${q} dog breed`, `${q} dog`, q);
    } else {
      queries.push(q, `${q} photo`, `${q} illustration`);
    }
  }

  return [...new Set(queries)];
}

function decodeSearchText(value) {
  return cleanString(value)
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
}

function normalizeImageUrl(value) {
  try {
    const url = decodeSearchText(value);
    return decodeURIComponent(url);
  } catch (e) {
    return decodeSearchText(value);
  }
}

function isUsableWebImageUrl(value) {
  const imageUrl = normalizeImageUrl(value);
  if (!/^https?:\/\//i.test(imageUrl)) return false;
  if (BAD_IMAGE_TITLE_TERMS.some(term => imageUrl.toLowerCase().includes(term))) return false;
  try {
    const parsed = new URL(imageUrl);
    if (BAD_IMAGE_DOMAINS.some(domain => parsed.hostname.includes(domain))) return false;
    return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(parsed.pathname + parsed.search);
  } catch (e) {
    return false;
  }
}

function scoreWebImageUrl(imageUrl, query, subject) {
  const normalizedUrl = normalizeImageUrl(imageUrl);
  const haystack = tokenizeImageText(normalizedUrl);
  const tokenSet = new Set(haystack);
  const subjectTokens = tokenizeImageText(subject);
  const queryTokens = tokenizeImageText(query);
  let score = 0;

  for (const token of subjectTokens) {
    if (tokenSet.has(token)) score += 8;
  }
  for (const token of queryTokens) {
    if (tokenSet.has(token)) score += 2;
  }
  if (looksLikeDogBreed(subject) && tokenSet.has("dog")) score += 5;
  if (/\/(?:image|photo|media|uploads?|content)\//i.test(normalizedUrl)) score += 2;
  if (/\.(?:jpe?g|webp)(?:$|[?#])/i.test(normalizedUrl)) score += 2;
  if (BAD_IMAGE_TITLE_TERMS.some(term => normalizedUrl.toLowerCase().includes(term))) score -= 25;

  return score;
}

function pickBestWebImage(urls, query, subject) {
  const seen = new Set();
  return urls
    .map(normalizeImageUrl)
    .filter(isUsableWebImageUrl)
    .filter(url => {
      const key = url.split("?")[0].toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(url => ({
      url,
      score: scoreWebImageUrl(url, query, subject)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.url || "";
}

async function fetchGoogleImageSearch(query, subject) {
  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("tbm", "isch");
    url.searchParams.set("hl", "en");
    url.searchParams.set("safe", "active");
    url.searchParams.set("q", query);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": IMAGE_SEARCH_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    if (!res.ok) return "";

    const text = decodeSearchText(await res.text());
    const urls = [];
    for (const match of text.matchAll(/https?:\/\/[^"'<>\\\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\\\s]*)?/gi)) {
      urls.push(match[0]);
    }
    return pickBestWebImage(urls, query, subject);
  } catch (e) {
    return "";
  }
}

async function fetchDuckDuckGoImageSearch(query, subject) {
  try {
    const homeUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const homeRes = await fetch(homeUrl, {
      headers: { "User-Agent": IMAGE_SEARCH_USER_AGENT }
    });
    if (!homeRes.ok) return "";
    const homeText = await homeRes.text();
    const vqd = homeText.match(/vqd=['"]?([^&'"]+)/)?.[1];
    if (!vqd) return "";

    const apiUrl = new URL("https://duckduckgo.com/i.js");
    apiUrl.searchParams.set("l", "us-en");
    apiUrl.searchParams.set("o", "json");
    apiUrl.searchParams.set("q", query);
    apiUrl.searchParams.set("vqd", vqd);
    apiUrl.searchParams.set("f", ",,,");
    apiUrl.searchParams.set("p", "1");

    const res = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent": IMAGE_SEARCH_USER_AGENT,
        "Referer": homeUrl,
        "Accept": "application/json"
      }
    });
    if (!res.ok) return "";
    const data = await res.json();
    const urls = (data.results || []).flatMap(item => [item.image, item.thumbnail]).filter(Boolean);
    return pickBestWebImage(urls, query, subject);
  } catch (e) {
    return "";
  }
}

async function fetchWebImage(title) {
  const { subject } = normalizeImageSubject(title);
  for (const query of buildImageSearchQueries(title)) {
    const googleImage = await fetchGoogleImageSearch(query, subject);
    if (googleImage) return googleImage;

    const duckDuckGoImage = await fetchDuckDuckGoImageSearch(query, subject);
    if (duckDuckGoImage) return duckDuckGoImage;
  }

  return "";
}

export async function fetchComparisonImages(scriptText) {
  const pairs = extractComparisonPairs(scriptText);
  return Promise.all(pairs.map(async (pair) => ({
    ...pair,
    leftImageUrl: await fetchWebImage(pair.leftTitle),
    rightImageUrl: await fetchWebImage(pair.rightTitle)
  })));
}

function getManualImageStateKey(chatId) {
  return `manual_images:${chatId}`;
}

function getPendingManualImageKey(chatId, pendingId) {
  return `pending_image:${chatId}:${pendingId}`;
}

function buildManualImageState(chatId, scriptText, comparisonImages = []) {
  const pairs = extractComparisonPairs(scriptText);
  return {
    chatId,
    scriptText: cleanTelegramScriptText(scriptText),
    sessionId: "",
    comparisonImages: pairs.map((pair, index) => {
      const existing = comparisonImages[index] || {};
      return {
        ...pair,
        leftImageUrl: cleanString(existing.leftImageUrl),
        rightImageUrl: cleanString(existing.rightImageUrl)
      };
    }),
    updatedAt: new Date().toISOString()
  };
}

async function readManualImageState(chatId, env) {
  if (!env.VICOMPARE_KV) return null;
  try {
    return await env.VICOMPARE_KV.get(getManualImageStateKey(chatId), "json");
  } catch (e) {
    return null;
  }
}

async function writeManualImageState(chatId, state, env) {
  if (!env.VICOMPARE_KV) return false;
  await env.VICOMPARE_KV.put(getManualImageStateKey(chatId), JSON.stringify(state), { expirationTtl: 86400 });
  return true;
}

function getManualImageTargets(comparisonImages = []) {
  const targets = [];
  comparisonImages.forEach((pair, index) => {
    if (!pair.leftImageUrl) {
      targets.push({ pairIndex: index, side: "left", title: pair.leftTitle });
    }
    if (!pair.rightImageUrl) {
      targets.push({ pairIndex: index, side: "right", title: pair.rightTitle });
    }
  });
  return targets;
}

function normalizeMatchText(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTextTargetMatch(text, title) {
  const textTokens = new Set(normalizeMatchText(text).split(" ").filter(Boolean));
  const titleTokens = normalizeMatchText(title).split(" ").filter(token => token.length > 1);
  if (!textTokens.size || !titleTokens.length) return 0;
  const matched = titleTokens.filter(token => textTokens.has(token)).length;
  return matched / titleTokens.length;
}

export function pickManualImageTargetFromText(text, targets = []) {
  const scored = targets
    .map(target => ({
      target,
      score: Math.max(
        scoreTextTargetMatch(text, target.title),
        scoreTextTargetMatch(text, target.title?.replace(/^Anh hùng\s+/i, "")),
        scoreTextTargetMatch(text, target.title?.replace(/^Người\s+/i, ""))
      )
    }))
    .filter(item => item.score >= 0.65)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.target || null;
}

export function readImageClassificationResult(value, targets = []) {
  let parsed = value;
  if (typeof value === "string") {
    const jsonText = value.match(/\{[\s\S]*\}/)?.[0] || "";
    if (!jsonText) return null;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return null;
    }
  }

  let pairIndex = Number(parsed?.pairIndex);
  let side = cleanString(parsed?.side).toLowerCase();
  const confidence = Number(parsed?.confidence ?? 0);
  if (side === "trái" || side === "trai" || side === "a") side = "left";
  if (side === "phải" || side === "phai" || side === "b") side = "right";

  let target = targets.find(item => item.pairIndex === pairIndex && item.side === side);
  if (!target && pairIndex > 0) {
    pairIndex -= 1;
    target = targets.find(item => item.pairIndex === pairIndex && item.side === side);
  }

  if (!target) {
    const title = cleanString(parsed?.title || parsed?.targetTitle || parsed?.label || parsed?.match);
    target = pickManualImageTargetFromText(title, targets);
    if (target) {
      pairIndex = target.pairIndex;
      side = target.side;
    }
  }

  if (!target || confidence < 0.2) return null;
  return { pairIndex, side, confidence, title: target.title };
}

function mergeManualComparisonImages(baseImages = [], manualState = null) {
  if (!manualState || !Array.isArray(manualState.comparisonImages)) return baseImages;
  return baseImages.map((item, index) => {
    const manual = manualState.comparisonImages[index];
    if (!manual) return item;
    return {
      ...item,
      leftImageUrl: cleanString(manual.leftImageUrl) || item.leftImageUrl || "",
      rightImageUrl: cleanString(manual.rightImageUrl) || item.rightImageUrl || ""
    };
  });
}

function getManualImageProgress(comparisonImages = []) {
  const total = comparisonImages.length * 2;
  const done = comparisonImages.reduce((sum, pair) => (
    sum + (pair.leftImageUrl ? 1 : 0) + (pair.rightImageUrl ? 1 : 0)
  ), 0);
  return { done, total };
}

async function assignManualImageToTarget(chatId, imageFileId, target, env) {
  const state = await readManualImageState(chatId, env);
  if (!state || !Array.isArray(state.comparisonImages) || !state.comparisonImages[target.pairIndex]) {
    return null;
  }

  const imageUrl = `${WORKER_PUBLIC_BASE_URL}/api/telegram-file?file_id=${encodeURIComponent(imageFileId)}`;
  const nextState = {
    ...state,
    comparisonImages: state.comparisonImages.map((pair, index) => {
      if (index !== target.pairIndex) return pair;
      return {
        ...pair,
        [`${target.side}ImageUrl`]: imageUrl
      };
    }),
    updatedAt: new Date().toISOString()
  };

  await writeManualImageState(chatId, nextState, env);
  if (nextState.sessionId) {
    await updateSessionComparisonImages(nextState.sessionId, nextState.comparisonImages, env);
  }

  return nextState;
}

export function buildManualImageTargetKeyboard(targets, pendingId) {
  const buttons = targets.map(target => ({
    text: `${target.pairIndex + 1}${target.side === "left" ? "T" : "P"} ${target.title}`.slice(0, 60),
    callback_data: `img_${pendingId}|${target.pairIndex}|${target.side}`
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return { inline_keyboard: rows };
}

async function updateSessionComparisonImages(sessionId, comparisonImages, env) {
  if (!env.VICOMPARE_KV || !sessionId) return false;
  const session = await env.VICOMPARE_KV.get(`session:${sessionId}`, "json");
  if (!session) return false;
  await env.VICOMPARE_KV.put(`session:${sessionId}`, JSON.stringify({
    ...session,
    comparisonImages,
    updatedAt: new Date().toISOString()
  }), { expirationTtl: 86400 });
  return true;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  throw error;
}

function delayWithSignal(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      const error = new Error("Request aborted");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollExportAudioUrl(host, apiKey, exportId, engineName, options = {}) {
  for (let i = 0; i < 18; i++) {
    await delayWithSignal(2500, options.signal);
    const statusRes = await fetch(`https://${host}/json-rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        method: "getExportStatus",
        input: { projectExportId: exportId }
      }),
      signal: options.signal
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

async function pollVoicefreeAudioUrl(apiKey, taskId, options = {}) {
  for (let attempts = 0; attempts < 30; attempts += 1) {
    await delayWithSignal(2000, options.signal);
    const statusRes = await fetch(`https://api.taovoicefree.com/v1/history/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "xi-api-key": apiKey
      },
      signal: options.signal
    });
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json().catch(() => ({}));
    const state = String(statusData.status || statusData.state || "").toLowerCase();
    const url = statusData.result?.audio_url || statusData.audio_url || statusData.result?.url;
    if (url || state === "completed") {
      return url || statusData.result?.audio_url;
    }
    if (state === "failed") {
      throw new Error(`Voicefree: ${statusData.error || statusData.message || "Tiến trình tạo giọng nói bị lỗi."}`);
    }
  }
  throw new Error("Voicefree: Quá thời gian tạo file.");
}

async function requestVoicefreeAudioBuffer(ttsConfig, text, options = {}) {
  const startRes = await fetch(`https://api.taovoicefree.com/v1/text-to-speech/${encodeURIComponent(ttsConfig.voiceId)}`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "xi-api-key": ttsConfig.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: String(text).trim(),
      provider: ttsConfig.provider || "elevenlabs",
      model_id: ttsConfig.modelId || "eleven_v3",
      language_code: "vi",
      voice_settings: {
        speed: ttsConfig.speed
      }
    }),
    signal: options.signal
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || String(startData.status || "").toLowerCase() === "failed") {
    throw new Error(startData.message || startData.error || JSON.stringify(startData) || startRes.statusText);
  }

  const taskId = startData.id || startData.result?.id;
  if (!taskId) throw new Error("Không nhận được task ID.");

  const audioUrl = await pollVoicefreeAudioUrl(ttsConfig.apiKey, taskId, options);
  const audioRes = await fetch(audioUrl, { signal: options.signal });
  if (!audioRes.ok) {
    const errText = await audioRes.text().catch(() => "");
    throw new Error(`Không tải được audio Voicefree: ${errText || audioRes.statusText}`);
  }
  return await audioRes.arrayBuffer();
}

async function requestVoicefreeAudioBufferWithFallback(ttsConfig, scriptText, options = {}) {
  try {
    return await requestVoicefreeAudioBuffer(ttsConfig, scriptText, options);
  } catch (wholeTextErr) {
    if (wholeTextErr?.name === "AbortError") throw wholeTextErr;
    const segments = splitScriptTextSegments(scriptText);
    if (segments.length <= 1) {
      throw new Error(`Voicefree: ${wholeTextErr.message}`);
    }

    const chunks = [];
    for (const segment of segments) {
      chunks.push(new Uint8Array(await requestVoicefreeAudioBuffer(ttsConfig, segment, options)));
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }
}

async function requestJsonRpcTtsAudioBuffer(ttsConfig, text, label, options = {}) {
  const normalizedText = String(text || "").trim();
  let startRes = await fetch(`https://${ttsConfig.host}/json-rpc`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "ttsLongText",
      input: {
        text: normalizedText,
        userVoiceId: ttsConfig.voiceId,
        speed: ttsConfig.speed
      }
    }),
    signal: options.signal
  });
  let startData = await startRes.json();

  if (startData.error) {
    startRes = await fetch(`https://${ttsConfig.host}/json-rpc`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ttsConfig.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "ttsLongText",
        input: {
          text: normalizedText,
          voiceId: ttsConfig.voiceId,
          speed: ttsConfig.speed
        }
      }),
      signal: options.signal
    });
    const retryData = await startRes.json();
    if (!retryData.error) {
      startData = retryData;
    }
  }

  if (startData.error) throw new Error(`${label} API: ${startData.error.message || JSON.stringify(startData.error)} (Dùng VoiceID: ${ttsConfig.voiceId})`);

  const exportId = startData.result?.projectExportId;
  if (!exportId) throw new Error(`${label}: Không nhận được export ID.`);

  const audioUrl = await pollExportAudioUrl(ttsConfig.host, ttsConfig.apiKey, exportId, label, options);
  const audioRes = await fetch(audioUrl, { signal: options.signal });
  if (!audioRes.ok) throw new Error(`${label}: Không tải được audio đã xuất.`);
  return {
    buffer: await audioRes.arrayBuffer(),
    audioUrl
  };
}

async function requestTtsAudioBufferForText(engineType, ttsConfig, text, options = {}) {
  if (engineType === "tts_eleven") {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ttsConfig.voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": ttsConfig.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
      signal: options.signal
    });

    if (!ttsRes.ok) throw new Error(`ElevenLabs Error: ${ttsRes.statusText}`);
    return { buffer: await ttsRes.arrayBuffer(), audioUrl: null };
  }

  if (engineType === "tts_lucy") {
    return await requestJsonRpcTtsAudioBuffer(ttsConfig, text && !/[.!?:]$/.test(text.trim()) ? `${text.trim()}.` : text, "LucyLab", options);
  }

  if (engineType === "tts_vclip") {
    return await requestJsonRpcTtsAudioBuffer(ttsConfig, text, "VClip", options);
  }

  if (engineType === "tts_voicefree") {
    return { buffer: await requestVoicefreeAudioBufferWithFallback(ttsConfig, text, options), audioUrl: null };
  }

  throw new Error("Động cơ TTS không hợp lệ.");
}

function concatArrayBuffers(buffers) {
  const chunks = buffers.map(buffer => new Uint8Array(buffer));
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

export async function requestSegmentedTtsAudio(engineType, ttsConfig, scriptText, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 18000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const segments = splitScriptTextSegments(scriptText);
    const requestAudio = options.requestAudio || requestTtsAudioBufferForText;
    if (segments.length <= 1) {
      const result = await requestAudio(engineType, ttsConfig, scriptText, { signal: controller.signal });
      return {
        audioBuffer: result.buffer,
        audioUrlResult: result.audioUrl,
        audioSegments: [{
          text: cleanString(scriptText),
          base64: arrayBufferToBase64(result.buffer)
        }]
      };
    }

    const segmentResults = await mapWithConcurrency(
      segments,
      options.concurrency || 5,
      async (segment) => {
        const result = await requestAudio(engineType, ttsConfig, segment, { signal: controller.signal });
        return {
          text: segment,
          buffer: result.buffer,
          audioUrl: result.audioUrl
        };
      }
    );

    const audioSegments = segmentResults.map(segment => ({
      text: segment.text,
      base64: arrayBufferToBase64(segment.buffer)
    }));

    return {
      audioBuffer: concatArrayBuffers(segmentResults.map(segment => segment.buffer)),
      audioUrlResult: segmentResults[segmentResults.length - 1]?.audioUrl || null,
      audioSegments
    };
  } catch (error) {
    controller.abort();
    if (error?.name === "AbortError") {
      throw new Error(`Quá thời gian tạo voice (${Math.ceil(timeoutMs / 1000)} giây). Provider phản hồi quá chậm, vui lòng thử lại.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

export function buildWebAppUrls({
  sessionId,
  chatId,
  channelId,
  scriptText,
  audioUrl,
  audioSegments = [],
  voiceSyncMode = "segment",
  actionSfxEnabled = true,
  actionSfxVolume = 0.2,
  actionSfxPresets = null,
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
        audioSegments,
        voiceSyncMode,
        actionSfxEnabled,
        actionSfxVolume,
        actionSfxPresets,
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

const TELEGRAM_QUEUE_TTS_TIMEOUT_MS = 120000;
const TELEGRAM_UPDATE_DEDUPE_TTL_SECONDS = 86400;

export async function enqueueTelegramUpdate(update, env) {
  if (!env.TELEGRAM_JOBS || typeof env.TELEGRAM_JOBS.send !== "function") {
    return false;
  }

  try {
    await env.TELEGRAM_JOBS.send({ update });
    return true;
  } catch (error) {
    console.error("Unable to enqueue Telegram update, using waitUntil fallback:", {
      updateId: update?.update_id || null,
      error: error?.message || String(error)
    });
    return false;
  }
}

function getTelegramUpdateDedupeKey(update) {
  const updateId = Number(update?.update_id);
  if (!Number.isFinite(updateId)) return "";
  return `telegram_update_done:${updateId}`;
}

export async function dispatchTelegramUpdate(update, token, env, options = {}) {
  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query, token, env, options);
    return;
  }

  if (update?.message) {
    await handleMessage(update.message, token, env);
  }
}

export async function processTelegramQueueBatch(batch, env, dependencies = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const dispatchUpdate = dependencies.dispatchUpdate || dispatchTelegramUpdate;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing!");
  }

  for (const message of batch.messages || []) {
    const update = message.body?.update;
    const dedupeKey = getTelegramUpdateDedupeKey(update);
    const startedAt = Date.now();
    const updateType = update?.callback_query ? "callback_query" : update?.message ? "message" : "unknown";

    try {
      if (!update) {
        message.ack?.();
        continue;
      }

      if (dedupeKey && env.VICOMPARE_KV) {
        const alreadyProcessed = await env.VICOMPARE_KV.get(dedupeKey);
        if (alreadyProcessed) {
          console.log("Telegram queue job skipped as duplicate", {
            updateId: update?.update_id || null,
            updateType
          });
          message.ack?.();
          continue;
        }
      }

      console.log("Telegram queue job started", {
        updateId: update?.update_id || null,
        updateType
      });
      await dispatchUpdate(update, token, env, {
        answerCallback: false,
        ttsTimeoutMs: TELEGRAM_QUEUE_TTS_TIMEOUT_MS
      });

      if (dedupeKey && env.VICOMPARE_KV) {
        await env.VICOMPARE_KV.put(dedupeKey, "1", {
          expirationTtl: TELEGRAM_UPDATE_DEDUPE_TTL_SECONDS
        });
      }
      console.log("Telegram queue job completed", {
        updateId: update?.update_id || null,
        updateType,
        elapsedMs: Date.now() - startedAt
      });
      message.ack?.();
    } catch (error) {
      console.error("Telegram queue job failed:", {
        updateId: update?.update_id || null,
        error: error?.message || String(error)
      });
      message.retry?.();
    }
  }
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

    if (url.pathname === "/api/ausync-callback" && request.method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/api/app-settings" && request.method === "GET") {
      try {
        if (!isAuthorizedSettingsSyncRequest(request, env)) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized app settings sync request." }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.VICOMPARE_KV) {
          return new Response(JSON.stringify({ success: false, hasKv: false, settings: null }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const settings = (await env.VICOMPARE_KV.get("app_settings", "json")) || null;
        const credentials = await getSyncedCredentials(env);
        return new Response(JSON.stringify({ success: true, hasKv: true, settings, credentials }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/app-settings" && request.method === "POST") {
      try {
        if (!isAuthorizedSettingsSyncRequest(request, env)) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized app settings sync request." }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.VICOMPARE_KV) {
          return new Response(JSON.stringify({
            success: false,
            hasKv: false,
            error: "Missing Cloudflare KV binding VICOMPARE_KV. Cannot persist Web Tool settings."
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const body = await request.json();
        const settings = body.settings || body;
        const serialized = JSON.stringify(settings);
        if (serialized.length > 20 * 1024 * 1024) {
          return new Response(JSON.stringify({
            success: false,
            error: "App settings payload is too large for KV. Please remove oversized image/audio data."
          }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        await env.VICOMPARE_KV.put("app_settings", JSON.stringify({
          ...settings,
          updatedAt: new Date().toISOString()
        }));

        const settingsCredentials = buildCredentialsFromAppSettings(settings);
        if (Object.keys(settingsCredentials).length > 0) {
          const existingCredentials = (await env.VICOMPARE_KV.get("app_credentials", "json")) || {};
          const mergedCredentials = mergeSyncedCredentials(existingCredentials, settingsCredentials);
          await env.VICOMPARE_KV.put("app_credentials", JSON.stringify(mergedCredentials));
        }

        if (Array.isArray(settings.channelProfiles)) {
          const profilesToSave = settings.channelProfiles.map(p => ({
            id: p.id,
            name: p.name || p.headerTitle || p.id
          }));
          await env.VICOMPARE_KV.put("channel_profiles", JSON.stringify(profilesToSave));
        }

        return new Response(JSON.stringify({ success: true, hasKv: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 1. POST /api/sync-profiles - Đồng bộ danh sách Kênh & Thông tin API Key/VoiceID từ Web App
    if (url.pathname === "/api/sync-profiles" && request.method === "POST") {
      try {
        if (!env.VICOMPARE_KV) {
          return new Response(JSON.stringify({
            success: false,
            hasKv: false,
            error: "Missing Cloudflare KV binding VICOMPARE_KV. Cannot persist Web Tool voice/API settings for Telegram."
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const body = await request.json();
        let credentialsSaved = false;
        if (body.profiles && Array.isArray(body.profiles)) {
          const profilesToSave = body.profiles.map(p => ({
            id: p.id,
            name: p.name || p.headerTitle || p.id
          }));
          await env.VICOMPARE_KV.put("channel_profiles", JSON.stringify(profilesToSave));
        }
        if (body.credentials) {
          const existingCredentials = (await env.VICOMPARE_KV.get("app_credentials", "json")) || {};
          const mergedCredentials = mergeSyncedCredentials(existingCredentials, body.credentials);
          await env.VICOMPARE_KV.put("app_credentials", JSON.stringify(mergedCredentials));
          credentialsSaved = true;
        }
        return new Response(JSON.stringify({ success: true, hasKv: true, credentialsSaved }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/tts-config-status" && request.method === "GET") {
      const status = {
        hasKv: Boolean(env.VICOMPARE_KV),
        hasCredentials: false,
        hasVclipApiKey: false,
        vclipVoiceId: "",
        hasLucyLabApiKey: false,
        lucyLabVoiceId: "",
        hasElevenLabsApiKey: false,
        elevenLabsVoiceId: "",
        hasVoicefreeApiKey: false,
        voicefreeVoiceId: ""
      };

      if (env.VICOMPARE_KV) {
        const credentials = await getSyncedCredentials(env);
        status.hasCredentials = Object.keys(credentials).length > 0;
        status.hasVclipApiKey = Boolean(cleanString(credentials.vclipApiKey));
        status.vclipVoiceId = resolveSyncedVoiceId("tts_vclip", credentials);
        status.hasLucyLabApiKey = Boolean(cleanString(credentials.lucyLabApiKey));
        status.lucyLabVoiceId = resolveSyncedVoiceId("tts_lucy", credentials);
        status.hasElevenLabsApiKey = Boolean(cleanString(credentials.elevenLabsApiKey));
        status.elevenLabsVoiceId = resolveSyncedVoiceId("tts_eleven", credentials);
        status.hasVoicefreeApiKey = Boolean(cleanString(credentials.voicefreeApiKey || credentials.voicefree_api_key));
        status.voicefreeVoiceId = resolveSyncedVoiceId("tts_voicefree", credentials);
        status.voicefreeProvider = firstFilledString([credentials.voicefreeProvider, credentials.voicefree_provider]);
        status.voicefreeModelId = firstFilledString([credentials.voicefreeModelId, credentials.voicefree_model_id]);
        status.voicefreeSpeed = credentials.voicefreeSpeed ?? credentials.voicefree_speed ?? null;
      }

      return new Response(JSON.stringify(status), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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

    // 6. GET /api/telegram-file - Proxy ảnh/file Telegram để Web Tool có thể dùng ổn định trên prod
    if (url.pathname === "/api/telegram-file" && request.method === "GET") {
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

        const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", fileRes.headers.get("Content-Type") || "image/jpeg");
        const contentLength = fileRes.headers.get("Content-Length");
        if (contentLength) headers.set("Content-Length", contentLength);

        return new Response(fileRes.body, {
          status: fileRes.status,
          headers
        });
      } catch (err) {
        return new Response(`Telegram file proxy error: ${err.message}`, { status: 502, headers: corsHeaders });
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
        if (update.callback_query.id) {
          try {
            await answerTelegramCallbackQuery(update.callback_query.id, token);
          } catch (e) {}
        }
        const queued = await enqueueTelegramUpdate(update, env);
        if (!queued) {
          ctx.waitUntil(dispatchTelegramUpdate(update, token, env, { answerCallback: false }));
        }
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      if (update.message) {
        const queued = await enqueueTelegramUpdate(update, env);
        if (!queued) {
          ctx.waitUntil(dispatchTelegramUpdate(update, token, env));
        }
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    } catch (err) {
      console.error("Worker Error:", err);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }
  },

  async queue(batch, env) {
    await processTelegramQueueBatch(batch, env);
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

async function downloadTelegramFileWithContentType(fileId, token) {
  const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileInfo = await fileInfoRes.json().catch(() => ({}));
  const filePath = fileInfo.result?.file_path;
  if (!fileInfoRes.ok || !filePath) {
    throw new Error("Không tải được thông tin file từ Telegram.");
  }

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error("Không tải được file từ Telegram CDN.");
  }

  return {
    buffer: await fileRes.arrayBuffer(),
    contentType: inferImageMimeType(fileRes.headers.get("Content-Type"), filePath),
    filePath
  };
}

export function getTelegramImageFileId(message) {
  const photo = message.photo;
  if (photo && photo.length > 0) {
    return photo[photo.length - 1].file_id;
  }

  const document = message.document;
  const mimeType = cleanString(document?.mime_type).toLowerCase();
  const fileName = cleanString(document?.file_name).toLowerCase();
  const isImageDocument = mimeType.startsWith("image/")
    || /\.(?:jpe?g|png|webp)$/i.test(fileName);

  return isImageDocument ? document.file_id : "";
}

function getTelegramImageLabel(message) {
  return [
    message.caption,
    message.document?.file_name
  ].map(cleanString).filter(Boolean).join(" ");
}

export function inferImageMimeType(contentType, filePath = "") {
  const mimeType = cleanString(contentType).toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return mimeType;

  const path = cleanString(filePath).toLowerCase();
  if (/\.webp(?:$|\?)/i.test(path)) return "image/webp";
  if (/\.png(?:$|\?)/i.test(path)) return "image/png";
  if (/\.(?:jpe?g)(?:$|\?)/i.test(path)) return "image/jpeg";
  return "image/jpeg";
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function classifyTelegramImageForTargets(photoBuffer, contentType, targets, env) {
  const geminiKey = env.DEFAULT_GEMINI_KEY;
  if (!geminiKey) {
    throw new Error("Chưa cấu hình DEFAULT_GEMINI_KEY để nhận diện ảnh.");
  }
  if (!targets.length) return null;

  const targetText = targets
    .map(target => `${target.pairIndex + 1}.${target.side === "left" ? "left" : "right"} = ${target.title}`)
    .join("\n");
  const base64Image = arrayBufferToBase64(photoBuffer);
  const mimeType = inferImageMimeType(contentType);
  const text = await requestGeminiContent({
    apiKey: geminiKey,
    maxOutputTokens: 80,
    parts: [
      {
        text:
          "Identify which target this image best represents for a Vietnamese short comparison video. " +
          "Pick the closest target even for symbolic or documentary images. " +
          "Return only compact JSON like {\"pairIndex\":0,\"side\":\"left\",\"title\":\"Dân quân\",\"confidence\":0.91}. " +
          "pairIndex is zero-based. Use side left/right. Return confidence 0 only when the image is completely unrelated.\n\n" +
          `Targets:\n${targetText}`
      },
      {
        inlineData: {
          mimeType,
          data: base64Image
        }
      }
    ]
  });
  return readImageClassificationResult(text, targets);
}

async function handleManualComparisonImage(message, token, env) {
  const chatId = message.chat.id;
  const imageFileId = getTelegramImageFileId(message);
  if (!imageFileId) return false;

  const state = await readManualImageState(chatId, env);
  if (!state || !Array.isArray(state.comparisonImages) || state.comparisonImages.length === 0) {
    return false;
  }

  const targets = getManualImageTargets(state.comparisonImages);
  if (targets.length === 0) {
    await sendTelegramMessage(chatId, "✅ Kịch bản này đã đủ ảnh rồi. Nếu muốn đổi ảnh, gửi lại chủ đề để tạo phiên mới nhé.", token);
    return true;
  }

  try {
    const labelTarget = pickManualImageTargetFromText(getTelegramImageLabel(message), targets);
    let classified = labelTarget
      ? { ...labelTarget, confidence: 0.99 }
      : null;

    if (!classified) {
      const { buffer, contentType } = await downloadTelegramFileWithContentType(imageFileId, token);
      classified = await classifyTelegramImageForTargets(buffer, contentType, targets, env);
    }

    if (!classified) {
      const pendingId = Math.random().toString(36).slice(2, 8);
      if (env.VICOMPARE_KV) {
        await env.VICOMPARE_KV.put(getPendingManualImageKey(chatId, pendingId), JSON.stringify({
          imageFileId,
          createdAt: new Date().toISOString()
        }), { expirationTtl: 3600 });
      }
      await sendTelegramMessage(
        chatId,
        "⚠️ Tao chưa nhận diện chắc ảnh này thuộc mục nào. Bấm chọn ô cần gán ảnh này:",
        token,
        buildManualImageTargetKeyboard(targets, pendingId)
      );
      return true;
    }

    const nextState = await assignManualImageToTarget(chatId, imageFileId, classified, env);
    if (!nextState) {
      await sendTelegramMessage(chatId, "⚠️ Không tìm thấy phiên kịch bản để gán ảnh. Gửi lại chủ đề rồi thử lại nhé.", token);
      return true;
    }

    const progress = getManualImageProgress(nextState.comparisonImages);
    const sideLabel = classified.side === "left" ? "trái" : "phải";
    const pair = nextState.comparisonImages[classified.pairIndex];
    await sendTelegramMessage(
      chatId,
      `✅ Đã gán ảnh vào cặp ${classified.pairIndex + 1} ${sideLabel}: ${classified.title || pair?.[`${classified.side}Title`] || ""}\n` +
      `📸 Tiến độ ảnh: ${progress.done}/${progress.total}.` +
      (nextState.sessionId ? "\nMở lại link Web Tool/Preview là thấy ảnh đã cập nhật." : "\nSau khi chọn giọng, ảnh này sẽ tự nạp vào Web Tool.")
      ,
      token
    );
    return true;
  } catch (err) {
    await sendTelegramMessage(chatId, `❌ Lỗi nhận diện ảnh: ${err.message}`, token);
    return true;
  }
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

  if (await handleManualComparisonImage(message, token, env)) {
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
      if (!imgRes.ok) {
        throw new Error("Không tải được ảnh từ Telegram CDN.");
      }
      const imgBuffer = await imgRes.arrayBuffer();
      const base64Image = arrayBufferToBase64(imgBuffer);

      scriptResult = await requestGeminiContent({
        apiKey: geminiKey,
        parts: [
          { text: `${promptInstruction}\n\nChủ đề: ${message.caption || "Phân tích và viết kịch bản so sánh dựa trên hình ảnh này"}` },
          {
            inlineData: {
              mimeType: inferImageMimeType(imgRes.headers.get("Content-Type"), filePath),
              data: base64Image
            }
          }
        ]
      });
    } else {
      scriptResult = await requestGeminiContent({
        apiKey: geminiKey,
        parts: [
          { text: `${promptInstruction}\n\nChủ đề: ${text}` }
        ]
      });
    }

    if (!scriptResult) {
      throw new Error("Không nhận được nội dung kịch bản từ phản hồi của Gemini.");
    }

    const manualImageState = buildManualImageState(chatId, scriptResult);
    await writeManualImageState(chatId, manualImageState, env);

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
      `📝 **Kịch bản đề xuất:**\n\n${scriptResult}\n\n` +
      `📸 Có thể gửi ảnh minh họa lên Telegram ngay bây giờ. Bot sẽ tự nhận diện ảnh thuộc đối tượng nào và nạp vào đúng ô trái/phải.\n\n` +
      `👇 **Bước 1/2: Vui lòng chọn Mẫu Kênh để sản xuất video:**`, 
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
async function handleCallbackQuery(callbackQuery, token, env, options = {}) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageText = callbackQuery.message.text || "";
  if (callbackQuery.id && options.answerCallback !== false) {
    try {
      await answerTelegramCallbackQuery(callbackQuery.id, token);
    } catch (e) {}
  }

  if (data.startsWith("img_")) {
    const [pendingPart, pairIndexText, sideText] = data.split("|");
    const pendingId = pendingPart.replace("img_", "");
    const pairIndex = Number(pairIndexText);
    const side = sideText === "right" ? "right" : "left";

    try {
      const pending = env.VICOMPARE_KV
        ? await env.VICOMPARE_KV.get(getPendingManualImageKey(chatId, pendingId), "json")
        : null;
      if (!pending?.imageFileId || !Number.isFinite(pairIndex)) {
        await sendTelegramMessage(chatId, "⚠️ Ảnh chờ gán đã hết hạn hoặc không hợp lệ. Gửi lại ảnh đó giúp tao.", token);
        return;
      }

      const state = await assignManualImageToTarget(chatId, pending.imageFileId, { pairIndex, side }, env);
      if (!state) {
        await sendTelegramMessage(chatId, "⚠️ Không tìm thấy phiên kịch bản để gán ảnh. Gửi lại chủ đề rồi thử lại nhé.", token);
        return;
      }

      const progress = getManualImageProgress(state.comparisonImages);
      const pair = state.comparisonImages[pairIndex];
      const title = side === "left" ? pair?.leftTitle : pair?.rightTitle;
      await sendTelegramMessage(
        chatId,
        `✅ Đã gán ảnh thủ công vào cặp ${pairIndex + 1} ${side === "left" ? "trái" : "phải"}: ${title || ""}\n` +
        `📸 Tiến độ ảnh: ${progress.done}/${progress.total}.`,
        token
      );
      return;
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Lỗi gán ảnh thủ công: ${err.message}`, token);
      return;
    }
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

    const voiceMarkup = buildTtsEngineKeyboard(channelId);

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
      let audioSegments = [];

      const syncedCreds = await getSyncedCredentials(env);
      const ttsConfig = resolveTtsConfig(engineType, syncedCreds, env);

      const segmentedResult = await requestSegmentedTtsAudio(engineType, ttsConfig, scriptText, {
        timeoutMs: options.ttsTimeoutMs
      });
      audioBuffer = segmentedResult.audioBuffer;
      audioUrlResult = segmentedResult.audioUrlResult;
      audioSegments = segmentedResult.audioSegments;
      fileName = ttsConfig.fileName;

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
          base64Audio = arrayBufferToBase64(audioBuffer);
        } catch (e) {}

        const manualImageState = await readManualImageState(chatId, env);
        const autoComparisonImages = await fetchComparisonImages(scriptText);
        const comparisonImages = mergeManualComparisonImages(autoComparisonImages, manualImageState);

        const compactAudioSegments = JSON.stringify(audioSegments).length <= 18 * 1024 * 1024 ? audioSegments : [];
        const sessionPayload = {
          sessionId,
          chatId,
          channelId,
          scriptText,
          audioBase64: base64Audio,
          audioSegments: compactAudioSegments,
          audioUrl: webAudioUrl || null,
          voiceSyncMode: syncedCreds.voiceSyncMode || "segment",
          actionSfxEnabled: syncedCreds.actionSfxEnabled !== false,
          actionSfxVolume: Number.isFinite(Number(syncedCreds.actionSfxVolume)) ? Number(syncedCreds.actionSfxVolume) : 0.2,
          actionSfxPresets: syncedCreds.actionSfxPresets || null,
          comparisonImages,
          createdAt: new Date().toISOString()
        };

        let sessionSaved = false;
        if (env.VICOMPARE_KV) {
          await env.VICOMPARE_KV.put(`session:${sessionId}`, JSON.stringify(sessionPayload), { expirationTtl: 86400 });
          sessionSaved = true;
          if (manualImageState) {
            await writeManualImageState(chatId, {
              ...manualImageState,
              sessionId,
              comparisonImages,
              updatedAt: new Date().toISOString()
            }, env);
          }
        }

        // Tạo link chuyển hướng 1-Click sang Web App (Auto Render 0-Click hoặc Preview xem trước)
        const { autoUrl: webAppAutoUrl, previewUrl: webAppPreviewUrl } = buildWebAppUrls({
          sessionId,
          chatId,
          channelId,
          scriptText,
          audioUrl: webAudioUrl || null,
          audioSegments: compactAudioSegments,
          voiceSyncMode: syncedCreds.voiceSyncMode || "segment",
          actionSfxEnabled: syncedCreds.actionSfxEnabled !== false,
          actionSfxVolume: Number.isFinite(Number(syncedCreds.actionSfxVolume)) ? Number(syncedCreds.actionSfxVolume) : 0.2,
          actionSfxPresets: syncedCreds.actionSfxPresets || null,
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
      const storedCredentials = (await env.VICOMPARE_KV.get("app_credentials", "json")) || {};
      const settings = (await env.VICOMPARE_KV.get("app_settings", "json")) || {};
      return mergeSyncedCredentials(storedCredentials, buildCredentialsFromAppSettings(settings));
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_LUCYLAB_DEFAULT_VOICE_ID,
  buildGeminiGenerationBody,
  requestGeminiContent,
  buildCredentialsFromAppSettings,
  resolveTtsConfig,
  pickVoiceCandidate,
  readExportResult,
  buildWebAppUrls,
  buildTtsEngineKeyboard,
  buildImageSearchQueries,
  buildManualImageTargetKeyboard,
  cleanTelegramScriptText,
  splitVoicefreeTextSegments,
  extractComparisonPairs,
  getTelegramImageFileId,
  getTikTokApiErrorMessage,
  inferImageMimeType,
  mergeSyncedCredentials,
  pickTikTokPrivacyLevel,
  pickManualImageTargetFromText,
  arrayBufferToBase64,
  readImageClassificationResult,
  requestSegmentedTtsAudio,
  resolveTikTokCredentials,
  enqueueTelegramUpdate,
  processTelegramQueueBatch
} from "./index.js";

describe("Telegram background queue", () => {
  it("enqueues the complete Telegram update for background processing", async () => {
    const sent = [];
    const update = { update_id: 123, callback_query: { id: "callback-1" } };

    const queued = await enqueueTelegramUpdate(update, {
      TELEGRAM_JOBS: {
        send: async (body) => sent.push(body)
      }
    });

    assert.equal(queued, true);
    assert.deepEqual(sent, [{ update }]);
  });

  it("falls back to direct processing when the queue write fails", async () => {
    const queued = await enqueueTelegramUpdate({ update_id: 124 }, {
      TELEGRAM_JOBS: {
        send: async () => { throw new Error("queue unavailable"); }
      }
    });

    assert.equal(queued, false);
  });

  it("uses a long TTS deadline and acknowledges a processed queue message", async () => {
    const calls = [];
    let acknowledged = false;
    const message = {
      body: { update: { update_id: 456, callback_query: { id: "callback-2" } } },
      ack: () => { acknowledged = true; }
    };

    await processTelegramQueueBatch({ messages: [message] }, {
      TELEGRAM_BOT_TOKEN: "telegram-token"
    }, {
      dispatchUpdate: async (_update, _token, _env, options) => calls.push(options)
    });

    assert.equal(acknowledged, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ttsTimeoutMs, 120000);
    assert.equal(calls[0].answerCallback, false);
  });

  it("does not process the same Telegram update twice", async () => {
    const stored = new Map();
    let dispatchCount = 0;
    const env = {
      TELEGRAM_BOT_TOKEN: "telegram-token",
      VICOMPARE_KV: {
        get: async (key) => stored.get(key) || null,
        put: async (key, value) => stored.set(key, value)
      }
    };
    const createMessage = () => ({
      body: { update: { update_id: 789, message: { message_id: 3 } } },
      ack() {}
    });

    await processTelegramQueueBatch({ messages: [createMessage()] }, env, {
      dispatchUpdate: async () => { dispatchCount += 1; }
    });
    await processTelegramQueueBatch({ messages: [createMessage()] }, env, {
      dispatchUpdate: async () => { dispatchCount += 1; }
    });

    assert.equal(dispatchCount, 1);
  });
});

describe("Telegram Gemini script generation", () => {
  it("uses minimal thinking and a bounded output for fast Telegram responses", () => {
    const body = buildGeminiGenerationBody([{ text: "So sánh bác sĩ và dược sĩ" }]);

    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
    assert.equal(body.generationConfig.maxOutputTokens, 1400);
    assert.deepEqual(body.contents, [{ parts: [{ text: "So sánh bác sĩ và dược sĩ" }] }]);
  });

  it("falls back to the fast model when the primary Gemini request stalls", async () => {
    const requestedUrls = [];
    const fetchImpl = (url, options) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length === 1) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }

      return Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Đây là Bác sĩ." }] } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    };

    const result = await requestGeminiContent({
      apiKey: "gemini-key",
      parts: [{ text: "So sánh bác sĩ và dược sĩ" }],
      fetchImpl,
      timeoutMs: 5
    });

    assert.equal(result, "Đây là Bác sĩ.");
    assert.match(requestedUrls[0], /gemini-3\.5-flash/);
    assert.match(requestedUrls[1], /gemini-3\.1-flash-lite/);
  });
});

describe("Telegram TTS config resolution", () => {
  it("uses the synced ElevenLabs voice instead of a hardcoded default", () => {
    const config = resolveTtsConfig("tts_eleven", {
      elevenLabsApiKey: "eleven-key",
      elevenLabsVoiceId: "synced-eleven-voice"
    }, {
      DEFAULT_ELEVEN_KEY: "env-eleven-key"
    });

    assert.equal(config.apiKey, "eleven-key");
    assert.equal(config.voiceId, "synced-eleven-voice");
    assert.equal(config.host, "api.elevenlabs.io");
  });

  it("accepts selectedVoiceId as the synced ElevenLabs voice from the Web Tool", () => {
    const config = resolveTtsConfig("tts_eleven", {
      elevenLabsApiKey: "eleven-key",
      selectedVoiceId: "selected-eleven-voice"
    }, {});

    assert.equal(config.voiceId, "selected-eleven-voice");
  });

  it("requires a synced ElevenLabs voice ID", () => {
    assert.throws(
      () => resolveTtsConfig("tts_eleven", { elevenLabsApiKey: "eleven-key" }, {}),
      /Chưa đồng bộ Voice ID ElevenLabs/
    );
  });

  it("does not use the LucyLab default voice as VClip userVoiceId", () => {
    assert.throws(
      () => resolveTtsConfig("tts_vclip", {
        vclipApiKey: "vclip-key",
        vclipVoiceId: LEGACY_LUCYLAB_DEFAULT_VOICE_ID
      }, {
        DEFAULT_VOICE_ID: LEGACY_LUCYLAB_DEFAULT_VOICE_ID
      }),
      /Chưa đồng bộ userVoiceId VClip/
    );
  });

  it("resolves VClip only from the synced Web Tool voice ID", () => {
    const config = resolveTtsConfig(
      "tts_vclip",
      { vclipApiKey: "vclip-key", vclipVoiceId: "synced-vclip-voice" },
      {},
      "vclip-fetched-voice"
    );

    assert.equal(config.apiKey, "vclip-key");
    assert.equal(config.voiceId, "synced-vclip-voice");
    assert.equal(config.host, "api-tts.vclip.io");
  });

  it("uses the synced LucyLab voice", () => {
    const config = resolveTtsConfig("tts_lucy", {
      lucyLabApiKey: "lucy-key",
      lucyLabVoiceId: "synced-lucy-voice"
    }, {});

    assert.equal(config.voiceId, "synced-lucy-voice");
    assert.equal(config.host, "api.lucylab.io");
  });

  it("requires a synced LucyLab voice ID", () => {
    assert.throws(
      () => resolveTtsConfig("tts_lucy", { lucyLabApiKey: "lucy-key" }, {}),
      /Chưa đồng bộ Voice ID LucyLab/
    );
  });

  it("uses the synced Voicefree voice and options", () => {
    const config = resolveTtsConfig("tts_voicefree", {
      voicefreeApiKey: "voicefree-key",
      voicefreeVoiceId: "12345",
      voicefreeProvider: "elevenlabs",
      voicefreeModelId: "eleven_multilingual_v2",
      voicefreeSpeed: "1.1"
    }, {});

    assert.equal(config.apiKey, "voicefree-key");
    assert.equal(config.voiceId, "12345");
    assert.equal(config.host, "api.taovoicefree.com");
    assert.equal(config.provider, "elevenlabs");
    assert.equal(config.modelId, "eleven_multilingual_v2");
    assert.equal(config.speed, 1.1);
  });

  it("requires a synced Voicefree voice ID", () => {
    assert.throws(
      () => resolveTtsConfig("tts_voicefree", { voicefreeApiKey: "voicefree-key" }, {}),
      /Chưa đồng bộ Voice ID Voicefree/
    );
  });

  it("uses Eleven v3 as the Voicefree default model to match the Web Tool", () => {
    const config = resolveTtsConfig("tts_voicefree", {
      voicefreeApiKey: "voicefree-key",
      voicefreeVoiceId: "voicefree-id"
    }, {});

    assert.equal(config.modelId, "eleven_v3");
  });
});

describe("Voicefree Telegram text segmentation", () => {
  it("splits multi-line scripts into sentence-like Voicefree fallback segments", () => {
    assert.deepEqual(splitVoicefreeTextSegments("Đây là A\n\nĐây là B.\nSự khác nhau là gì?"), [
      "Đây là A.",
      "Đây là B.",
      "Sự khác nhau là gì?"
    ]);
  });

  it("generates sentence audio concurrently while preserving script order", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestAudio = async (engineType, ttsConfig, text) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const index = Number(text.match(/\d+/)?.[0] || 0);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeRequests -= 1;
      return { buffer: new Uint8Array([index]).buffer, audioUrl: `audio-${index}` };
    };

    const result = await requestSegmentedTtsAudio(
      "tts_voicefree",
      {},
      "Câu 1\nCâu 2\nCâu 3\nCâu 4\nCâu 5\nCâu 6",
      { concurrency: 3, minRequestIntervalMs: 0, requestAudio }
    );

    assert.equal(maxActiveRequests, 3);
    assert.deepEqual(Array.from(new Uint8Array(result.audioBuffer)), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.audioSegments.map(segment => segment.text), [
      "Câu 1.", "Câu 2.", "Câu 3.", "Câu 4.", "Câu 5.", "Câu 6."
    ]);
  });

  it("paces Voicefree request starts below the provider limit", async () => {
    let clock = 0;
    const starts = [];
    const requestAudio = async (_engineType, _ttsConfig, text) => {
      starts.push({ text, at: clock });
      return { buffer: new Uint8Array([starts.length]).buffer, audioUrl: null };
    };

    await requestSegmentedTtsAudio(
      "tts_voicefree",
      {},
      "Câu 1\nCâu 2\nCâu 3\nCâu 4",
      {
        concurrency: 3,
        minRequestIntervalMs: 1700,
        now: () => clock,
        delay: async (ms) => { clock += ms; },
        requestAudio
      }
    );

    assert.deepEqual(starts.map(item => item.at), [0, 1700, 3400, 5100]);
  });

  it("aborts the segmented voice job before Cloudflare cancels the Telegram callback", async () => {
    const requestAudio = (engineType, ttsConfig, text, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

    await assert.rejects(
      requestSegmentedTtsAudio(
        "tts_voicefree",
        {},
        "Câu 1\nCâu 2",
        { concurrency: 2, requestAudio, timeoutMs: 5 }
      ),
      /quá thời gian tạo voice/i
    );
  });
});

describe("Telegram TTS engine keyboard", () => {
  it("includes Voicefree as a selectable Telegram TTS engine", () => {
    const keyboard = buildTtsEngineKeyboard("cat-thong-thai");
    const callbackData = keyboard.inline_keyboard.flat().map(button => button.callback_data);

    assert.ok(callbackData.includes("tts_voicefree|cat-thong-thai"));
  });
});

describe("voice list candidate picking", () => {
  it("prefers provider userVoiceId fields over generic item ids", () => {
    const voice = pickVoiceCandidate({
      id: "internal-row-id",
      userVoiceId: "actual-user-voice-id"
    });

    assert.equal(voice, "actual-user-voice-id");
  });
});

describe("synced credential merging", () => {
  it("does not overwrite existing voice settings with empty boot sync values", () => {
    const merged = mergeSyncedCredentials({
      vclipApiKey: "old-vclip-key",
      vclipVoiceId: "8GNXzqzEk4AXq64rmSwqtW",
      lucyLabVoiceId: "old-lucy-voice"
    }, {
      vclipApiKey: "",
      vclipVoiceId: "",
      lucyLabVoiceId: "new-lucy-voice"
    });

    assert.equal(merged.vclipApiKey, "old-vclip-key");
    assert.equal(merged.vclipVoiceId, "8GNXzqzEk4AXq64rmSwqtW");
    assert.equal(merged.lucyLabVoiceId, "new-lucy-voice");
  });

  it("mirrors current Voicefree app settings over stale Telegram credentials", () => {
    const mirrored = buildCredentialsFromAppSettings({
      credentials: {
        voicefreeApiKey: "voicefree-key",
        voicefreeVoiceId: "voice-id",
        voicefreeProvider: "elevenlabs",
        voicefreeModelId: "eleven_v3",
        voicefreeSpeed: 1
      },
      voicefreeVoiceId: "voice-id",
      voicefreeProvider: "minimax",
      voicefreeModelId: "speech-2.8-hd",
      voicefreeSpeed: 0.95
    });

    const config = resolveTtsConfig("tts_voicefree", mirrored, {});
    assert.equal(config.provider, "minimax");
    assert.equal(config.modelId, "speech-2.8-hd");
    assert.equal(config.speed, 0.95);
  });
});

describe("export polling result parsing", () => {
  it("accepts VClip uppercase status with audioUrl", () => {
    const result = readExportResult({
      status: "COMPLETED",
      audioUrl: "https://cdn.example.com/audio.mp3"
    });

    assert.deepEqual(result, {
      state: "completed",
      audioUrl: "https://cdn.example.com/audio.mp3",
      failed: false,
      completed: true
    });
  });

  it("accepts downloadUrl even when status is missing", () => {
    const result = readExportResult({
      downloadUrl: "https://cdn.example.com/audio.mp3"
    });

    assert.equal(result.completed, true);
    assert.equal(result.audioUrl, "https://cdn.example.com/audio.mp3");
  });
});

describe("web app link fallback payload", () => {
  it("extracts comparison pairs from generated scripts", () => {
    const pairs = extractComparisonPairs(`Đây là Chó Doberman.
Đây là Chó Rottweiler.
Sự khác nhau là gì?
Doberman nhanh nhẹn.
Rottweiler mạnh mẽ.
Đây là Chó Pitbull.
Đây là Chó American Bully.`);

    assert.deepEqual(pairs, [
      { leftTitle: "Chó Doberman", rightTitle: "Chó Rottweiler", startIndex: 0 },
      { leftTitle: "Chó Pitbull", rightTitle: "Chó American Bully", startIndex: 5 }
    ]);
  });

  it("removes Telegram workflow footer before packing script payload", () => {
    const dirtyScript = `📝 **Kịch bản đề xuất:**

Đây là Chó Doberman.
Đây là Chó Rottweiler.

📸 Có thể gửi ảnh minh họa lên Telegram ngay bây giờ.

👇 Bước 1/2: Vui lòng chọn Mẫu Kênh để sản xuất video:

📺 Kênh đã chọn: 🐱 Mèo Thông Thái
👇 Bước 2/2: Chọn Động cơ Giọng đọc TTS:`;

    assert.equal(
      cleanTelegramScriptText(dirtyScript),
      "Đây là Chó Doberman.\nĐây là Chó Rottweiler."
    );
  });

  it("packs script and audio URL into hash payload when KV is unavailable", () => {
    const urls = buildWebAppUrls({
      sessionId: "s_test",
      chatId: 123,
      channelId: "cat-thong-thai",
      scriptText: "Đây là Chó Doberman.\nĐây là Chó Rottweiler.",
      audioUrl: "https://cdn.example.com/voice.mp3",
      audioSegments: [{ text: "Đây là Chó Doberman.", base64: "AAAA" }],
      voiceSyncMode: "segment",
      actionSfxEnabled: true,
      actionSfxVolume: 0.35,
      actionSfxPresets: { point_left: "capcut_swoosh_pop", point_right: "camera_tick" },
      comparisonImages: [{
        leftTitle: "Chó Doberman",
        rightTitle: "Chó Rottweiler",
        startIndex: 0,
        leftImageUrl: "https://upload.wikimedia.org/doberman.jpg",
        rightImageUrl: "https://upload.wikimedia.org/rottweiler.jpg"
      }],
      includeInlinePayload: true
    });

    const preview = new URL(urls.previewUrl);
    assert.equal(preview.searchParams.get("session"), "s_test");
    const hashParams = new URLSearchParams(preview.hash.slice(1));
    const encodedPayload = hashParams.get("tdata");
    assert.ok(encodedPayload);

    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    assert.equal(decoded.channelId, "cat-thong-thai");
    assert.equal(decoded.audioUrl, "https://cdn.example.com/voice.mp3");
    assert.deepEqual(decoded.audioSegments, [{ text: "Đây là Chó Doberman.", base64: "AAAA" }]);
    assert.equal(decoded.voiceSyncMode, "segment");
    assert.equal(decoded.actionSfxEnabled, true);
    assert.equal(decoded.actionSfxVolume, 0.35);
    assert.deepEqual(decoded.actionSfxPresets, { point_left: "capcut_swoosh_pop", point_right: "camera_tick" });
    assert.equal(decoded.scriptText, "Đây là Chó Doberman.\nĐây là Chó Rottweiler.");
    assert.equal(decoded.comparisonImages[0].leftImageUrl, "https://upload.wikimedia.org/doberman.jpg");
  });
});

describe("comparison image search queries", () => {
  it("normalizes Vietnamese dog breed titles into precise English image queries", () => {
    assert.deepEqual(buildImageSearchQueries("Chó Rottweiler").slice(0, 3), [
      "Rottweiler dog breed",
      "Rottweiler dog",
      "Rottweiler"
    ]);
    assert.ok(buildImageSearchQueries("Chó Pitbull").includes("American Pit Bull Terrier dog breed"));
  });

  it("maps common Vietnamese abstract comparison titles before searching images", () => {
    assert.ok(buildImageSearchQueries("Trí tuệ nhân tạo").includes("Artificial intelligence"));
    assert.ok(buildImageSearchQueries("Trí tuệ con người").includes("Thinking"));
  });
});

describe("manual Telegram image classification", () => {
  it("normalizes octet-stream Telegram image files into Gemini-supported MIME types", () => {
    assert.equal(inferImageMimeType("application/octet-stream", "documents/file_1.webp"), "image/webp");
    assert.equal(inferImageMimeType("application/octet-stream", "photos/file_2.jpg"), "image/jpeg");
    assert.equal(inferImageMimeType("image/png", "photos/file_3"), "image/png");
  });

  it("base64-encodes large image buffers without spreading the whole array", () => {
    const bytes = new Uint8Array(120_000);
    bytes[0] = 1;
    bytes[119_999] = 255;

    assert.equal(arrayBufferToBase64(bytes.buffer), Buffer.from(bytes).toString("base64"));
  });

  it("accepts Telegram image documents, not only compressed photo messages", () => {
    assert.equal(
      getTelegramImageFileId({
        document: {
          file_id: "doc-webp-file",
          mime_type: "image/webp",
          file_name: "doberman.webp"
        }
      }),
      "doc-webp-file"
    );

    assert.equal(
      getTelegramImageFileId({
        document: {
          file_id: "text-file",
          mime_type: "text/plain",
          file_name: "note.txt"
        }
      }),
      ""
    );
  });

  it("accepts a confident Gemini JSON target for a comparison image slot", () => {
    const result = readImageClassificationResult(
      '{"pairIndex":1,"side":"right","confidence":0.88}',
      [
        { pairIndex: 0, side: "left", title: "Chó Doberman" },
        { pairIndex: 1, side: "right", title: "Chó American Bully" }
      ]
    );

    assert.deepEqual(result, {
      pairIndex: 1,
      side: "right",
      confidence: 0.88,
      title: "Chó American Bully"
    });
  });

  it("uses Telegram file names/captions to match abstract Vietnamese targets", () => {
    const target = pickManualImageTargetFromText("dan-quan-tu-ve-1715568.webp", [
      { pairIndex: 0, side: "left", title: "Quân nhân" },
      { pairIndex: 0, side: "right", title: "Dân quân" }
    ]);

    assert.deepEqual(target, { pairIndex: 0, side: "right", title: "Dân quân" });
  });

  it("accepts Gemini title matches and one-based pair indexes", () => {
    const result = readImageClassificationResult(
      '{"pairIndex":1,"side":"phải","title":"Dân quân","confidence":0.25}',
      [
        { pairIndex: 0, side: "left", title: "Quân nhân" },
        { pairIndex: 0, side: "right", title: "Dân quân" }
      ]
    );

    assert.deepEqual(result, {
      pairIndex: 0,
      side: "right",
      confidence: 0.25,
      title: "Dân quân"
    });
  });

  it("builds fallback assignment buttons for uncertain Telegram images", () => {
    const keyboard = buildManualImageTargetKeyboard([
      { pairIndex: 0, side: "left", title: "Quân nhân" },
      { pairIndex: 0, side: "right", title: "Dân quân" },
      { pairIndex: 1, side: "left", title: "Anh hùng liệt sĩ" }
    ], "abc123");

    assert.deepEqual(keyboard.inline_keyboard[0].map(button => button.callback_data), [
      "img_abc123|0|left",
      "img_abc123|0|right"
    ]);
    assert.equal(keyboard.inline_keyboard[1][0].callback_data, "img_abc123|1|left");
  });

  it("rejects very low-confidence or unknown image matches", () => {
    assert.equal(
      readImageClassificationResult('{"pairIndex":0,"side":"left","confidence":0.1}', [
        { pairIndex: 0, side: "left", title: "Chó Doberman" }
      ]),
      null
    );
  });
});

describe("Telegram TikTok publish config", () => {
  it("resolves TikTok credentials from synced web app keys before env", () => {
    const creds = resolveTikTokCredentials({
      ttClientKey: "web-client",
      ttClientSecret: "web-secret",
      ttRefreshToken: "web-refresh",
      ttAccessToken: "web-access"
    }, {
      TT_CLIENT_KEY: "env-client",
      TT_CLIENT_SECRET: "env-secret",
      TT_REFRESH_TOKEN: "env-refresh"
    });

    assert.deepEqual(creds, {
      clientKey: "web-client",
      clientSecret: "web-secret",
      refreshToken: "web-refresh",
      accessToken: "web-access"
    });
  });

  it("requires either access token or refresh-token credential set", () => {
    assert.throws(
      () => resolveTikTokCredentials({}, {}),
      /Chưa cấu hình TikTok/
    );
  });

  it("formats TikTok API errors and privacy fallback", () => {
    assert.equal(
      getTikTokApiErrorMessage({ error: { code: "scope_not_authorized", message: "missing scope" } }),
      "missing scope"
    );
    assert.equal(pickTikTokPrivacyLevel(["SELF_ONLY", "PUBLIC_TO_EVERYONE"]), "PUBLIC_TO_EVERYONE");
  });
});

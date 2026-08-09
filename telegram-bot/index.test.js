import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_LUCYLAB_DEFAULT_VOICE_ID,
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
  resolveTikTokCredentials
} from "./index.js";

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

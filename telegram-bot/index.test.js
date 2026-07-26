import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_LUCYLAB_DEFAULT_VOICE_ID,
  resolveTtsConfig,
  pickVoiceCandidate,
  readExportResult,
  buildWebAppUrls,
  cleanTelegramScriptText,
  extractComparisonPairs,
  getTikTokApiErrorMessage,
  pickTikTokPrivacyLevel,
  resolveTikTokCredentials
} from "./index.js";

describe("Telegram TTS config resolution", () => {
  it("does not use the LucyLab default voice as VClip userVoiceId", () => {
    assert.throws(
      () => resolveTtsConfig("tts_vclip", {
        vclipApiKey: "vclip-key",
        vclipVoiceId: LEGACY_LUCYLAB_DEFAULT_VOICE_ID
      }, {
        DEFAULT_VOICE_ID: LEGACY_LUCYLAB_DEFAULT_VOICE_ID
      }),
      /Chưa cấu hình userVoiceId VClip/
    );
  });

  it("resolves VClip from VClip-specific env before fetched voice", () => {
    const config = resolveTtsConfig(
      "tts_vclip",
      { vclipApiKey: "vclip-key" },
      { DEFAULT_VCLIP_VOICE_ID: " vclip-env-voice " },
      "vclip-fetched-voice"
    );

    assert.equal(config.apiKey, "vclip-key");
    assert.equal(config.voiceId, "vclip-env-voice");
    assert.equal(config.host, "api-tts.vclip.io");
  });

  it("keeps LucyLab fallback isolated to LucyLab", () => {
    const config = resolveTtsConfig("tts_lucy", {
      lucyLabApiKey: "lucy-key"
    }, {});

    assert.equal(config.voiceId, LEGACY_LUCYLAB_DEFAULT_VOICE_ID);
    assert.equal(config.host, "api.lucylab.io");
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
    assert.equal(decoded.scriptText, "Đây là Chó Doberman.\nĐây là Chó Rottweiler.");
    assert.equal(decoded.comparisonImages[0].leftImageUrl, "https://upload.wikimedia.org/doberman.jpg");
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

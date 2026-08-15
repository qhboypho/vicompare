export function buildTelegramFallbackSession({ inlinePayload = {}, urlParams }) {
  const params = urlParams || new URLSearchParams();
  return {
    scriptText: inlinePayload.scriptText || params.get('scriptText') || params.get('script') || '',
    channelId: inlinePayload.channelId || params.get('channelId') || '',
    audioBase64: '',
    audioUrl: inlinePayload.audioUrl || params.get('audioUrl') || '',
    audioSegments: Array.isArray(inlinePayload.audioSegments) ? inlinePayload.audioSegments : [],
    voiceSyncMode: inlinePayload.voiceSyncMode || 'segment',
    actionSfxEnabled: inlinePayload.actionSfxEnabled,
    actionSfxVolume: inlinePayload.actionSfxVolume,
    actionSfxPresets: inlinePayload.actionSfxPresets,
    comparisonImages: Array.isArray(inlinePayload.comparisonImages) ? inlinePayload.comparisonImages : []
  };
}

export function pickTelegramChannelProfile(channelId, preferredProfiles = [], fallbackProfiles = []) {
  if (!channelId) return null;
  return preferredProfiles.find(profile => profile.id === channelId)
    || fallbackProfiles.find(profile => profile.id === channelId)
    || null;
}

export function waitForTelegramAudioSync({ audioUrl, createAudio, syncTimeline, timeoutMs = 12000 }) {
  if (!audioUrl) return Promise.resolve(0);

  return new Promise((resolve, reject) => {
    const audio = createAudio(audioUrl);
    const timeoutId = setTimeout(() => {
      reject(new Error('Qua thoi gian cho metadata cua voice Telegram.'));
    }, timeoutMs);
    const finish = (callback) => (value) => {
      clearTimeout(timeoutId);
      callback(value);
    };
    audio.onloadedmetadata = () => {
      const metadataDuration = Number(audio.duration);
      const duration = Number.isFinite(metadataDuration) ? metadataDuration : 0;
      Promise.resolve(syncTimeline(audioUrl, duration)).then(
        () => finish(resolve)(duration),
        finish(reject)
      );
    };
    audio.onerror = finish(() => reject(new Error('Khong doc duoc metadata cua voice Telegram.')));
  });
}

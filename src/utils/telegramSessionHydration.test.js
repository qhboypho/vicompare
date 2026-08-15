import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTelegramFallbackSession,
  pickTelegramChannelProfile,
  waitForTelegramAudioSync
} from './telegramSessionHydration.js';

test('keeps inline audio segments and sync mode when the Telegram session API is unavailable', () => {
  const audioSegments = [
    { text: 'Day la ben trai.', base64: 'AAAA' },
    { text: 'Day la ben phai.', base64: 'BBBB' }
  ];
  const params = new URLSearchParams({
    scriptText: 'fallback script',
    channelId: 'fallback-channel'
  });

  const fallback = buildTelegramFallbackSession({
    inlinePayload: {
      scriptText: 'inline script',
      channelId: 'cat-thong-thai',
      audioUrl: 'https://cdn.example.com/voice.mp3',
      audioSegments,
      voiceSyncMode: 'segment'
    },
    urlParams: params
  });

  assert.deepEqual(fallback.audioSegments, audioSegments);
  assert.equal(fallback.voiceSyncMode, 'segment');
  assert.equal(fallback.scriptText, 'inline script');
});

test('uses the freshly loaded cloud channel profile when opening a Telegram preview', () => {
  const staleProfiles = [{ id: 'cat-thong-thai', headerLogoUrl: '', logoFileName: '' }];
  const cloudProfiles = [{
    id: 'cat-thong-thai',
    headerLogoUrl: 'data:image/png;base64,cloud-logo',
    logoFileName: 'meo-logo.png'
  }];

  assert.deepEqual(
    pickTelegramChannelProfile('cat-thong-thai', cloudProfiles, staleProfiles),
    cloudProfiles[0]
  );
});

test('waits for metadata and timeline synchronization before resolving Telegram audio hydration', async () => {
  let metadataHandler;
  let syncFinished = false;
  const audio = {
    duration: 12.4,
    set onloadedmetadata(handler) { metadataHandler = handler; },
    set onerror(_handler) {}
  };

  const pending = waitForTelegramAudioSync({
    audioUrl: 'blob:telegram-voice',
    createAudio: () => audio,
    syncTimeline: async (_url, duration) => {
      assert.equal(duration, 12.4);
      await Promise.resolve();
      syncFinished = true;
    }
  });

  assert.equal(syncFinished, false);
  await metadataHandler();
  const duration = await pending;

  assert.equal(duration, 12.4);
  assert.equal(syncFinished, true);
});

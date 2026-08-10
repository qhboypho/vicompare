import test from 'node:test';
import assert from 'node:assert/strict';

import { publishFacebookReel } from './facebookPublisher.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('publishes a Facebook reel through start, binary upload and finish phases', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return jsonResponse({
        video_id: 'video-123',
        upload_url: 'https://video-rupload.facebook.com/video-upload/v1'
      });
    }
    if (calls.length === 2) return jsonResponse({ success: true });
    return jsonResponse({ success: true, fb_id: 'reel-456' });
  };

  const result = await publishFacebookReel({
    pageId: 'page-1',
    accessToken: 'token-1',
    videoBlob: new Blob(['video']),
    caption: 'Caption #reels',
    fetchImpl
  });

  assert.equal(result.id, 'reel-456');
  assert.equal(result.videoId, 'video-123');
  assert.equal(calls[1].url, '/fb-upload/video-upload/v1');
  assert.equal(calls[1].options.headers.Authorization, 'OAuth token-1');
  assert.match(String(calls[2].options.body), /description=Caption/);
});

test('rejects a start response that omits the Facebook upload target', async () => {
  await assert.rejects(
    publishFacebookReel({
      pageId: 'page-1',
      accessToken: 'token-1',
      videoBlob: new Blob(['video']),
      caption: 'Caption',
      fetchImpl: async () => jsonResponse({ success: true })
    }),
    /video_id\/upload_url/
  );
});

test('surfaces Facebook Graph API errors with their phase', async () => {
  await assert.rejects(
    publishFacebookReel({
      pageId: 'page-1',
      accessToken: 'expired',
      videoBlob: new Blob(['video']),
      caption: 'Caption',
      fetchImpl: async () => jsonResponse({ error: { message: 'Session has expired' } }, 401)
    }),
    /Khởi tạo Facebook Reel: Session has expired/
  );
});


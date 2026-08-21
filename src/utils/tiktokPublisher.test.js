import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTikTokVideoInitPayload,
  getProxiedTikTokUploadUrl,
  getTikTokApiErrorMessage,
  pickTikTokPrivacyLevel,
  publishTikTokVideo
} from './tiktokPublisher.js';

test('picks SELF_ONLY when app is unaudited (default)', () => {
  // Mặc định app chưa audit → luôn SELF_ONLY dù có option công khai
  assert.equal(pickTikTokPrivacyLevel(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']), 'SELF_ONLY');
  assert.equal(pickTikTokPrivacyLevel(['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']), 'SELF_ONLY');
  assert.equal(pickTikTokPrivacyLevel([]), 'SELF_ONLY');
});

test('picks the broadest option when app is audited', () => {
  assert.equal(pickTikTokPrivacyLevel(['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], { unaudited: false }), 'PUBLIC_TO_EVERYONE');
  assert.equal(pickTikTokPrivacyLevel(['FOLLOWER_OF_CREATOR', 'SELF_ONLY'], { unaudited: false }), 'FOLLOWER_OF_CREATOR');
  assert.equal(pickTikTokPrivacyLevel([], { unaudited: false }), 'SELF_ONLY');
});

test('builds TikTok direct post init payload for a one chunk file upload', () => {
  const payload = buildTikTokVideoInitPayload({
    caption: 'Hello TikTok #shorts',
    videoSize: 1234,
    privacyLevel: 'SELF_ONLY'
  });

  assert.equal(payload.post_info.title, 'Hello TikTok #shorts');
  assert.equal(payload.post_info.privacy_level, 'SELF_ONLY');
  // Không có ràng buộc account → mọi tương tác đều bật (disable = false)
  assert.equal(payload.post_info.disable_comment, false);
  assert.equal(payload.post_info.disable_duet, false);
  assert.equal(payload.post_info.disable_stitch, false);
  assert.deepEqual(payload.source_info, {
    source: 'FILE_UPLOAD',
    video_size: 1234,
    chunk_size: 1234,
    total_chunk_count: 1
  });
});

test('proxies TikTok upload URLs through the local upload route', () => {
  assert.equal(
    getProxiedTikTokUploadUrl('https://open-upload.tiktokapis.com/video/?upload_id=abc&token=def'),
    '/tiktok-upload/video/?upload_id=abc&token=def&__tt_host=open-upload.tiktokapis.com'
  );
});

test('proxies region-specific TikTok upload URLs (sg/eu) with real host', () => {
  assert.equal(
    getProxiedTikTokUploadUrl('https://open-upload-sg.tiktokapis.com/upload?upload_id=xyz'),
    '/tiktok-upload/upload?upload_id=xyz&__tt_host=open-upload-sg.tiktokapis.com'
  );
});

test('extracts useful TikTok API error messages', () => {
  // Error code không nằm trong danh sách friendly → dùng message gốc
  assert.equal(
    getTikTokApiErrorMessage({ error: { code: 'some_other_error', message: 'missing video.publish' } }),
    'missing video.publish'
  );
  // Error code có sẵn hướng dẫn tiếng Việt → dịch sang thông báo rõ ràng
  assert.match(
    getTikTokApiErrorMessage({ error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'Please review' } }),
    /chưa qua audit/
  );
});

test('publishTikTokVideo uses existing access token directly and uploads', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v2/oauth/token/')) {
      return Response.json({ access_token: 'fresh-token', refresh_token: 'fresh-refresh', open_id: 'open-id' });
    }
    if (url.endsWith('/v2/post/publish/creator_info/query/')) {
      return Response.json({
        data: { privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false },
        error: { code: 'ok', message: '' }
      });
    }
    if (url.endsWith('/v2/post/publish/video/init/')) {
      return Response.json({
        data: {
          publish_id: 'v_pub_123',
          upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=abc'
        },
        error: { code: 'ok', message: '' }
      });
    }
    if (url.startsWith('/tiktok-upload/video/') && url.includes('upload_id=abc')) {
      return new Response('', { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  };

  const result = await publishTikTokVideo({
    credentials: {
      accessToken: 'old-token',
      clientKey: 'client-key',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token'
    },
    videoBlob: new Blob(['video'], { type: 'video/mp4' }),
    caption: 'Caption',
    fetchImpl
  });

  assert.equal(result.publishId, 'v_pub_123');
  // accessToken có sẵn → dùng trực tiếp, KHÔNG gọi refresh token
  const creatorCall = calls.find(c => c.url.endsWith('/v2/post/publish/creator_info/query/'));
  const initCall = calls.find(c => c.url.endsWith('/v2/post/publish/video/init/'));
  const uploadCall = calls.find(c => c.url.startsWith('/tiktok-upload/video/'));
  assert.ok(!calls.some(c => c.url.endsWith('/v2/oauth/token/')), 'không được refresh khi có accessToken');
  assert.equal(creatorCall.options.headers.Authorization, 'Bearer old-token');
  assert.equal(initCall.options.headers.Authorization, 'Bearer old-token');
  // init payload tôn trọng creator_info: duet bị tắt
  const initBody = JSON.parse(initCall.options.body);
  assert.equal(initBody.post_info.disable_duet, true);
  assert.equal(initBody.post_info.disable_comment, false);
  assert.equal(uploadCall.options.method, 'PUT');
  assert.equal(uploadCall.options.headers['Content-Range'], 'bytes 0-4/5');
});

test('publishTikTokVideo refreshes token when no access token provided', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v2/oauth/token/')) {
      return Response.json({ access_token: 'fresh-token', refresh_token: 'fresh-refresh', open_id: 'open-id' });
    }
    if (url.endsWith('/v2/post/publish/creator_info/query/')) {
      return Response.json({
        data: { privacy_level_options: ['SELF_ONLY'] },
        error: { code: 'ok', message: '' }
      });
    }
    if (url.endsWith('/v2/post/publish/video/init/')) {
      return Response.json({
        data: { publish_id: 'v_pub_123', upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=abc' },
        error: { code: 'ok', message: '' }
      });
    }
    if (url.startsWith('/tiktok-upload/video/') && url.includes('upload_id=abc')) {
      return new Response('', { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  };

  const result = await publishTikTokVideo({
    credentials: {
      accessToken: '',
      clientKey: 'client-key',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token'
    },
    videoBlob: new Blob(['video'], { type: 'video/mp4' }),
    caption: 'Caption',
    fetchImpl
  });

  assert.equal(result.publishId, 'v_pub_123');
  // Không có accessToken → phải refresh, các call sau dùng fresh-token
  assert.ok(calls.some(c => c.url.endsWith('/v2/oauth/token/')), 'phải refresh khi thiếu accessToken');
  const creatorCall = calls.find(c => c.url.endsWith('/v2/post/publish/creator_info/query/'));
  assert.equal(creatorCall.options.headers.Authorization, 'Bearer fresh-token');
});

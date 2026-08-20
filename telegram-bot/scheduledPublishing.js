const SCHEDULE_PREFIX = 'scheduled_post:';
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

const clean = value => typeof value === 'string' ? value.trim() : '';
const jsonHeaders = corsHeaders => ({ ...corsHeaders, 'Content-Type': 'application/json' });

async function readPayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function responseError(payload, response) {
  return payload?.error?.message || payload?.error_description || payload?.message || response.statusText || `HTTP ${response.status}`;
}

function getAccounts(schedule, platform) {
  return Array.isArray(schedule?.selectedAccounts?.[platform])
    ? schedule.selectedAccounts[platform]
    : [];
}

export function collectDueSchedules(schedules = [], now = Date.now()) {
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (schedule?.status !== 'pending') return false;
    const dueAt = Date.parse(schedule.dueAt);
    return Number.isFinite(dueAt) && dueAt <= now;
  });
}

export async function executeScheduledPost(schedule, dependencies) {
  const deps = dependencies || {};
  const publishers = {
    facebook: deps.publishFacebook,
    youtube: deps.publishYouTube,
    tiktok: deps.publishTikTok
  };
  const postIds = {};

  for (const platform of schedule.platforms || []) {
    const publish = publishers[platform];
    if (typeof publish !== 'function') continue;
    const accounts = getAccounts(schedule, platform);
    if (accounts.length === 0) {
      const error = new Error(`Không có tài khoản ${platform} trong lịch hẹn.`);
      error.platform = platform;
      throw error;
    }

    for (const account of accounts) {
      try {
        const video = await deps.getVideo(schedule, platform, account);
        if (!video) throw new Error('Không tìm thấy video đã lưu trên cloud.');
        const result = await publish({ schedule, account, video, caption: schedule.caption || '' });
        postIds[platform] = [...(postIds[platform] || []), {
          accountId: account.id || '',
          label: account.label || platform,
          postId: result.postId || result.id || '',
          ...(result.videoId ? { videoId: result.videoId } : {}),
          ...(result.publishId ? { publishId: result.publishId } : {})
        }];
      } catch (cause) {
        const error = new Error(`${platform}: ${cause.message || String(cause)}`);
        error.platform = platform;
        error.cause = cause;
        throw error;
      }
    }
  }

  return { ...schedule, status: 'published', postIds, publishedAt: new Date().toISOString(), error: '' };
}

async function publishFacebook({ account, video, caption, fetchImpl = fetch }) {
  const pageId = clean(account?.credentials?.pageId);
  const accessToken = clean(account?.credentials?.accessToken);
  if (!pageId || !accessToken) throw new Error('Thiếu Page ID hoặc Access Token Facebook.');

  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/video_reels`;
  const startResponse = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken, upload_phase: 'start' })
  });
  const startPayload = await readPayload(startResponse);
  if (!startResponse.ok) throw new Error(`Khởi tạo Facebook Reel: ${responseError(startPayload, startResponse)}`);
  if (!startPayload.video_id || !startPayload.upload_url) throw new Error('Facebook không trả về video_id/upload_url.');

  const uploadResponse = await fetchImpl(startPayload.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: '0',
      file_size: String(video.size),
      'Content-Type': video.httpMetadata?.contentType || 'video/webm'
    },
    body: video.body
  });
  const uploadPayload = await readPayload(uploadResponse);
  if (!uploadResponse.ok || uploadPayload.success === false) {
    throw new Error(`Tải video Facebook: ${responseError(uploadPayload, uploadResponse)}`);
  }

  const finishResponse = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'finish',
      video_id: String(startPayload.video_id),
      video_state: 'PUBLISHED',
      description: caption
    })
  });
  const finishPayload = await readPayload(finishResponse);
  if (!finishResponse.ok || finishPayload.success === false) {
    throw new Error(`Hoàn tất Facebook Reel: ${responseError(finishPayload, finishResponse)}`);
  }
  return { postId: String(finishPayload.fb_id || finishPayload.id || startPayload.video_id), videoId: String(startPayload.video_id) };
}

async function refreshYouTubeToken(credentials, fetchImpl) {
  const refreshToken = clean(credentials.refreshToken);
  const clientId = clean(credentials.clientId);
  const clientSecret = clean(credentials.clientSecret);
  if (!refreshToken || !clientId || !clientSecret) return clean(credentials.accessToken);
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const payload = await readPayload(response);
  if (!response.ok || !payload.access_token) throw new Error(`Làm mới YouTube token: ${responseError(payload, response)}`);
  return payload.access_token;
}

async function publishYouTube({ account, video, caption, fetchImpl = fetch }) {
  const accessToken = await refreshYouTubeToken(account?.credentials || {}, fetchImpl);
  if (!accessToken) throw new Error('Thiếu YouTube Access Token hoặc Refresh Token.');
  const metadata = {
    snippet: {
      title: caption.slice(0, 100) || 'Video So Sanh',
      description: caption,
      tags: ['shorts', 'videososanh'],
      categoryId: '22'
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
  };
  const initResponse = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(video.size),
      'X-Upload-Content-Type': video.httpMetadata?.contentType || 'video/webm'
    },
    body: JSON.stringify(metadata)
  });
  const initPayload = await readPayload(initResponse);
  const uploadUrl = initResponse.headers.get('Location');
  if (!initResponse.ok || !uploadUrl) throw new Error(`Khởi tạo YouTube upload: ${responseError(initPayload, initResponse)}`);
  const uploadResponse = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(video.size),
      'Content-Type': video.httpMetadata?.contentType || 'video/webm'
    },
    body: video.body
  });
  const payload = await readPayload(uploadResponse);
  if (!uploadResponse.ok || !payload.id) throw new Error(`Tải video YouTube: ${responseError(payload, uploadResponse)}`);
  return { postId: String(payload.id) };
}

async function publishTikTok({ account, video, caption, fetchImpl = fetch }) {
  const credentials = account?.credentials || {};
  let accessToken = clean(credentials.accessToken);
  if (clean(credentials.clientKey) && clean(credentials.clientSecret) && clean(credentials.refreshToken)) {
    const tokenResponse = await fetchImpl('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: clean(credentials.clientKey),
        client_secret: clean(credentials.clientSecret),
        refresh_token: clean(credentials.refreshToken),
        grant_type: 'refresh_token'
      })
    });
    const tokenPayload = await readPayload(tokenResponse);
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(`Làm mới TikTok token: ${responseError(tokenPayload, tokenResponse)}`);
    accessToken = tokenPayload.access_token;
  }
  if (!accessToken) throw new Error('Thiếu TikTok Access Token hoặc Refresh Token.');

  const creatorResponse = await fetchImpl('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }
  });
  const creatorPayload = await readPayload(creatorResponse);
  if (!creatorResponse.ok || creatorPayload.error?.code !== 'ok') throw new Error(`TikTok creator info: ${responseError(creatorPayload, creatorResponse)}`);
  const privacyOptions = creatorPayload.data?.privacy_level_options || [];
  const privacyLevel = privacyOptions.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : privacyOptions[0] || 'SELF_ONLY';
  const initResponse = await fetchImpl('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000
      },
      source_info: { source: 'FILE_UPLOAD', video_size: video.size, chunk_size: video.size, total_chunk_count: 1 }
    })
  });
  const initPayload = await readPayload(initResponse);
  if (!initResponse.ok || initPayload.error?.code !== 'ok' || !initPayload.data?.upload_url) {
    throw new Error(`Khởi tạo TikTok upload: ${responseError(initPayload, initResponse)}`);
  }
  const uploadResponse = await fetchImpl(initPayload.data.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': video.httpMetadata?.contentType || 'video/webm',
      'Content-Range': `bytes 0-${video.size - 1}/${video.size}`
    },
    body: video.body
  });
  if (!uploadResponse.ok) throw new Error(`Tải video TikTok: ${await uploadResponse.text().catch(() => uploadResponse.statusText)}`);
  return { postId: String(initPayload.data.publish_id), publishId: String(initPayload.data.publish_id) };
}

function isAuthorized(request, env) {
  const expected = clean(env.APP_SETTINGS_SYNC_TOKEN);
  if (!expected) return true;
  const auth = request.headers.get('Authorization') || '';
  return request.headers.get('X-Sync-Token') === expected || auth === `Bearer ${expected}`;
}

function publicSchedule(schedule) {
  return {
    id: schedule.id,
    status: schedule.status,
    dueAt: schedule.dueAt,
    postIds: schedule.postIds || {},
    error: schedule.error || '',
    updatedAt: schedule.updatedAt || schedule.createdAt || ''
  };
}

async function listSchedules(env) {
  const list = await env.VICOMPARE_KV.list({ prefix: SCHEDULE_PREFIX });
  const schedules = await Promise.all(list.keys.map(key => env.VICOMPARE_KV.get(key.name, 'json')));
  return schedules.filter(Boolean);
}

export async function handleScheduleApiRequest(request, env, corsHeaders = {}) {
  if (!isAuthorized(request, env)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized schedule request.' }), {
      status: 401,
      headers: jsonHeaders(corsHeaders)
    });
  }
  if (!env.VICOMPARE_KV || !env.SCHEDULED_VIDEOS) {
    return new Response(JSON.stringify({ success: false, error: 'Worker chưa có KV hoặc R2 binding cho lịch hẹn.' }), {
      status: 503,
      headers: jsonHeaders(corsHeaders)
    });
  }

  const url = new URL(request.url);
  if (request.method === 'GET') {
    const schedules = (await listSchedules(env)).map(publicSchedule);
    return new Response(JSON.stringify({ success: true, schedules }), { headers: jsonHeaders(corsHeaders) });
  }
  if (request.method === 'DELETE') {
    const id = clean(url.searchParams.get('id'));
    const key = `${SCHEDULE_PREFIX}${id}`;
    const schedule = id ? await env.VICOMPARE_KV.get(key, 'json') : null;
    if (schedule?.videoKey) await env.SCHEDULED_VIDEOS.delete(schedule.videoKey);
    if (id) await env.VICOMPARE_KV.delete(key);
    return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders(corsHeaders) });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed.' }), { status: 405, headers: jsonHeaders(corsHeaders) });
  }

  const form = await request.formData();
  const video = form.get('video');
  const metadata = JSON.parse(clean(form.get('metadata')) || '{}');
  const id = clean(metadata.id);
  const dueAt = new Date(metadata.dueAt).toISOString();
  if (!id || !video || typeof video.stream !== 'function') throw new Error('Thiếu ID hoặc file video cho lịch hẹn.');
  if (!Array.isArray(metadata.platforms) || metadata.platforms.length === 0) throw new Error('Lịch hẹn chưa chọn nền tảng.');
  if (video.size <= 0 || video.size > MAX_VIDEO_BYTES) throw new Error('Video lịch hẹn phải lớn hơn 0 và không quá 95 MB.');
  const videoKey = `scheduled-videos/${id}`;
  await env.SCHEDULED_VIDEOS.put(videoKey, video, { httpMetadata: { contentType: video.type || 'video/webm' } });
  const schedule = {
    id,
    caption: clean(metadata.caption),
    platforms: metadata.platforms,
    selectedAccounts: metadata.selectedAccounts || {},
    dueAt,
    videoKey,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    postIds: {},
    error: ''
  };
  await env.VICOMPARE_KV.put(`${SCHEDULE_PREFIX}${id}`, JSON.stringify(schedule));
  return new Response(JSON.stringify({ success: true, schedule: publicSchedule(schedule) }), {
    status: 201,
    headers: jsonHeaders(corsHeaders)
  });
}

export async function processDueSchedules(env, options = {}) {
  if (!env.VICOMPARE_KV || !env.SCHEDULED_VIDEOS) return [];
  const schedules = await listSchedules(env);
  const due = collectDueSchedules(schedules, options.now ?? Date.now());
  const results = [];

  for (const schedule of due) {
    const key = `${SCHEDULE_PREFIX}${schedule.id}`;
    const publishing = { ...schedule, status: 'publishing', updatedAt: new Date().toISOString(), error: '' };
    await env.VICOMPARE_KV.put(key, JSON.stringify(publishing));
    try {
      const result = await executeScheduledPost(publishing, {
        getVideo: () => env.SCHEDULED_VIDEOS.get(schedule.videoKey),
        publishFacebook: args => publishFacebook(args),
        publishYouTube: args => publishYouTube(args),
        publishTikTok: args => publishTikTok(args),
        ...(options.dependencies || {})
      });
      const completed = { ...result, updatedAt: new Date().toISOString() };
      await env.VICOMPARE_KV.put(key, JSON.stringify(completed));
      await env.SCHEDULED_VIDEOS.delete(schedule.videoKey);
      results.push(completed);
    } catch (error) {
      const failed = {
        ...publishing,
        status: 'failed',
        error: error.message || String(error),
        failedPlatform: error.platform || '',
        updatedAt: new Date().toISOString()
      };
      await env.VICOMPARE_KV.put(key, JSON.stringify(failed));
      results.push(failed);
    }
  }
  return results;
}

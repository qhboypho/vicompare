const GRAPH_PROXY_BASE = '/fb-api/v21.0';

async function readResponsePayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getResponseError(payload, response) {
  return payload?.error?.message || payload?.message || response.statusText || `HTTP ${response.status}`;
}

function toUploadProxyUrl(uploadUrl) {
  const url = new URL(uploadUrl);
  if (url.hostname === 'video-rupload.facebook.com') {
    return `/fb-upload${url.pathname}${url.search}`;
  }
  if (url.hostname === 'rupload.facebook.com') {
    return `/fb-rupload${url.pathname}${url.search}`;
  }
  return uploadUrl;
}

async function postFacebookForm(url, fields, fetchImpl) {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
}

export async function publishFacebookReel({
  pageId,
  accessToken,
  videoBlob,
  caption = '',
  fetchImpl = fetch,
  onStatus = () => {}
}) {
  const cleanPageId = String(pageId || '').trim();
  const cleanToken = String(accessToken || '').trim();
  if (!cleanPageId || !cleanToken) {
    throw new Error('Thiếu Page ID hoặc Access Token Facebook.');
  }
  if (!videoBlob || !Number.isFinite(Number(videoBlob.size))) {
    throw new Error('Không có file video hợp lệ để đăng Facebook.');
  }

  onStatus('Đang khởi tạo phiên Facebook Reel...');
  const endpoint = `${GRAPH_PROXY_BASE}/${encodeURIComponent(cleanPageId)}/video_reels`;
  const startResponse = await postFacebookForm(endpoint, {
    access_token: cleanToken,
    upload_phase: 'start'
  }, fetchImpl);
  const startPayload = await readResponsePayload(startResponse);
  if (!startResponse.ok) {
    throw new Error(`Khởi tạo Facebook Reel: ${getResponseError(startPayload, startResponse)}`);
  }

  const videoId = String(startPayload.video_id || '');
  const uploadUrl = String(startPayload.upload_url || '');
  if (!videoId || !uploadUrl) {
    throw new Error('Khởi tạo Facebook Reel: API không trả về video_id/upload_url.');
  }

  onStatus('Đang tải video lên Facebook...');
  const uploadResponse = await fetchImpl(toUploadProxyUrl(uploadUrl), {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${cleanToken}`,
      offset: '0',
      file_size: String(videoBlob.size),
      'Content-Type': 'application/octet-stream'
    },
    body: videoBlob
  });
  const uploadPayload = await readResponsePayload(uploadResponse);
  if (!uploadResponse.ok || uploadPayload.success === false) {
    throw new Error(`Tải video lên Facebook: ${getResponseError(uploadPayload, uploadResponse)}`);
  }

  onStatus('Đang hoàn tất xuất bản Facebook Reel...');
  const finishResponse = await postFacebookForm(endpoint, {
    access_token: cleanToken,
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: String(caption || '')
  }, fetchImpl);
  const finishPayload = await readResponsePayload(finishResponse);
  if (!finishResponse.ok || finishPayload.success === false) {
    throw new Error(`Hoàn tất Facebook Reel: ${getResponseError(finishPayload, finishResponse)}`);
  }

  return {
    id: String(finishPayload.fb_id || finishPayload.id || videoId),
    videoId,
    response: finishPayload
  };
}

const DEFAULT_API_BASE = '/tiktok-api';
const DEFAULT_UPLOAD_BASE = '/tiktok-upload';
const MAX_TIKTOK_CAPTION_LENGTH = 2200;

export const TIKTOK_DIRECT_POST_ENDPOINTS = {
  token: '/v2/oauth/token/',
  creatorInfo: '/v2/post/publish/creator_info/query/',
  videoInit: '/v2/post/publish/video/init/'
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export const getTikTokApiErrorMessage = (payload = {}, fallback = 'TikTok API error') => {
  const error = payload.error || {};
  return clean(payload.error_description)
    || clean(payload.error)
    || clean(error.message)
    || clean(error.code)
    || fallback;
};

export const normalizeTikTokCaption = (caption) => clean(caption).slice(0, MAX_TIKTOK_CAPTION_LENGTH);

export const pickTikTokPrivacyLevel = (options = []) => {
  const allowed = Array.isArray(options) ? options.map(clean).filter(Boolean) : [];
  return allowed.find(item => item === 'PUBLIC_TO_EVERYONE')
    || allowed.find(item => item === 'MUTUAL_FOLLOW_FRIENDS')
    || allowed.find(item => item === 'FOLLOWER_OF_CREATOR')
    || allowed.find(item => item === 'SELF_ONLY')
    || 'SELF_ONLY';
};

export const buildTikTokVideoInitPayload = ({ caption, videoSize, privacyLevel, chunkSize }) => ({
  post_info: {
    title: normalizeTikTokCaption(caption),
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
    source: 'FILE_UPLOAD',
    video_size: videoSize,
    chunk_size: chunkSize || videoSize,
    total_chunk_count: 1
  }
});

export const getProxiedTikTokUploadUrl = (uploadUrl, uploadBase = DEFAULT_UPLOAD_BASE) => {
  const parsed = new URL(uploadUrl);
  if (parsed.hostname !== 'open-upload.tiktokapis.com') return uploadUrl;
  return `${uploadBase}${parsed.pathname}${parsed.search}`;
};

export const refreshTikTokAccessToken = async ({
  clientKey,
  clientSecret,
  refreshToken,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch
}) => {
  const cleanClientKey = clean(clientKey);
  const cleanClientSecret = clean(clientSecret);
  const cleanRefreshToken = clean(refreshToken);
  if (!cleanClientKey || !cleanClientSecret || !cleanRefreshToken) {
    return null;
  }

  const res = await fetchImpl(`${apiBase}${TIKTOK_DIRECT_POST_ENDPOINTS.token}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: new URLSearchParams({
      client_key: cleanClientKey,
      client_secret: cleanClientSecret,
      refresh_token: cleanRefreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(getTikTokApiErrorMessage(data, 'Không gia hạn được TikTok access token.'));
  }
  return data;
};

export const queryTikTokCreatorInfo = async ({
  accessToken,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch
}) => {
  const token = clean(accessToken);
  if (!token) throw new Error('Thiếu TikTok access token.');

  const res = await fetchImpl(`${apiBase}${TIKTOK_DIRECT_POST_ENDPOINTS.creatorInfo}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error?.code !== 'ok') {
    throw new Error(getTikTokApiErrorMessage(data, 'Không lấy được TikTok creator info.'));
  }
  return data.data || {};
};

export const initTikTokVideoPublish = async ({
  accessToken,
  caption,
  videoSize,
  privacyLevel,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch
}) => {
  const payload = buildTikTokVideoInitPayload({
    caption,
    videoSize,
    privacyLevel,
    chunkSize: videoSize
  });

  const res = await fetchImpl(`${apiBase}${TIKTOK_DIRECT_POST_ENDPOINTS.videoInit}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clean(accessToken)}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error?.code !== 'ok' || !data.data?.publish_id || !data.data?.upload_url) {
    throw new Error(getTikTokApiErrorMessage(data, 'Không khởi tạo được phiên đăng TikTok.'));
  }
  return data.data;
};

export const uploadTikTokVideoFile = async ({
  uploadUrl,
  videoBlob,
  uploadBase = DEFAULT_UPLOAD_BASE,
  fetchImpl = fetch
}) => {
  const size = videoBlob.size ?? videoBlob.byteLength;
  if (!size) throw new Error('File video TikTok rỗng hoặc không hợp lệ.');

  const proxiedUrl = getProxiedTikTokUploadUrl(uploadUrl, uploadBase);
  const contentType = videoBlob.type || 'video/mp4';
  const res = await fetchImpl(proxiedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes 0-${size - 1}/${size}`
    },
    body: videoBlob
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText || 'Upload file video lên TikTok thất bại.');
  }
};

export const publishTikTokVideo = async ({
  credentials,
  videoBlob,
  caption,
  apiBase = DEFAULT_API_BASE,
  uploadBase = DEFAULT_UPLOAD_BASE,
  setStatus = () => {},
  fetchImpl = fetch
}) => {
  const creds = credentials || {};
  let accessToken = clean(creds.accessToken);
  let refreshedTokenData = null;

  if (clean(creds.clientKey) && clean(creds.clientSecret) && clean(creds.refreshToken)) {
    setStatus('Đang tự động làm mới TikTok Access Token...');
    refreshedTokenData = await refreshTikTokAccessToken({
      clientKey: creds.clientKey,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      apiBase,
      fetchImpl
    });
    accessToken = refreshedTokenData.access_token;
  }

  if (!accessToken) {
    throw new Error('Thiếu TikTok Access Token hoặc Refresh Token.');
  }

  setStatus('Đang lấy thông tin tài khoản TikTok...');
  const creatorInfo = await queryTikTokCreatorInfo({ accessToken, apiBase, fetchImpl });
  const privacyLevel = pickTikTokPrivacyLevel(creatorInfo.privacy_level_options);

  setStatus('Đang khởi tạo phiên đăng TikTok...');
  const initData = await initTikTokVideoPublish({
    accessToken,
    caption,
    videoSize: videoBlob.size ?? videoBlob.byteLength,
    privacyLevel,
    apiBase,
    fetchImpl
  });

  setStatus('Đang tải video lên TikTok...');
  await uploadTikTokVideoFile({
    uploadUrl: initData.upload_url,
    videoBlob,
    uploadBase,
    fetchImpl
  });

  return {
    id: initData.publish_id,
    publishId: initData.publish_id,
    uploadUrl: initData.upload_url,
    privacyLevel,
    creatorInfo,
    refreshedTokenData
  };
};

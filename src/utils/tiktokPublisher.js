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

export const buildTikTokVideoInitPayload = ({ caption, videoSize, privacyLevel, chunkSize, creatorInfo = {} }) => ({
  post_info: {
    title: normalizeTikTokCaption(caption),
    privacy_level: privacyLevel,
    // Phải tôn trọng ràng buộc account trả về từ creator_info. Nếu creator
    // tắt comment/duet/stitch mà ta gửi false, TikTok từ chối với lỗi
    // "Please review our integration guidelines".
    disable_comment: creatorInfo.comment_disabled === true,
    disable_duet: creatorInfo.duet_disabled === true,
    disable_stitch: creatorInfo.stitch_disabled === true,
    video_cover_timestamp_ms: 1000
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
  console.log('[TikTok refresh token] HTTP', res.status, JSON.stringify(data));
  if (!res.ok || !data.access_token) {
    const detail = `HTTP ${res.status}: ${getTikTokApiErrorMessage(data, 'Không gia hạn được TikTok access token.')}`;
    throw new Error(detail);
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
  creatorInfo = {},
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch
}) => {
  const sendInit = async (level) => {
    const payload = buildTikTokVideoInitPayload({
      caption,
      videoSize,
      privacyLevel: level,
      chunkSize: videoSize,
      creatorInfo
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
    console.log('[TikTok video/init] level:', level, '| response:', res.status, JSON.stringify(data));
    return { res, data };
  };

  let { res, data } = await sendInit(privacyLevel);

  // App chưa audit → TikTok chỉ cho đăng SELF_ONLY. Tự động fallback để bài
  // vẫn lên (dạng riêng tư) thay vì fail hoàn toàn. Khi app audit xong,
  // PUBLIC_TO_EVERYONE sẽ thành công ngay ở lần gọi đầu.
  if (data.error?.code === 'unaudited_client_can_only_post_to_private_accounts' && privacyLevel !== 'SELF_ONLY') {
    console.warn('[TikTok] App chưa audit — fallback privacy_level về SELF_ONLY.');
    ({ res, data } = await sendInit('SELF_ONLY'));
  }

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

  const hasRefreshCreds = clean(creds.clientKey) && clean(creds.clientSecret) && clean(creds.refreshToken);

  // Nếu không có accessToken thì bắt buộc phải refresh
  if (!accessToken) {
    if (!hasRefreshCreds) {
      throw new Error('Thiếu TikTok Access Token. Vui lòng đăng nhập lại qua OAuth.');
    }
    setStatus('Đang tự động làm mới TikTok Access Token...');
    refreshedTokenData = await refreshTikTokAccessToken({
      clientKey: creds.clientKey,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      apiBase,
      fetchImpl
    });
    if (!refreshedTokenData?.access_token) {
      throw new Error('Refresh token hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại TikTok qua OAuth.');
    }
    accessToken = refreshedTokenData.access_token;
  }

  setStatus('Đang lấy thông tin tài khoản TikTok...');
  let creatorInfo;
  try {
    creatorInfo = await queryTikTokCreatorInfo({ accessToken, apiBase, fetchImpl });
  } catch (err) {
    // Access token hết hạn → thử refresh nếu có credentials
    if (!hasRefreshCreds) throw err;
    setStatus('Access token hết hạn, đang làm mới...');
    refreshedTokenData = await refreshTikTokAccessToken({
      clientKey: creds.clientKey,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      apiBase,
      fetchImpl
    });
    if (!refreshedTokenData?.access_token) {
      throw new Error('Refresh token hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại TikTok qua OAuth.');
    }
    accessToken = refreshedTokenData.access_token;
    creatorInfo = await queryTikTokCreatorInfo({ accessToken, apiBase, fetchImpl });
  }

  const privacyLevel = pickTikTokPrivacyLevel(creatorInfo.privacy_level_options);

  setStatus('Đang khởi tạo phiên đăng TikTok...');
  const initData = await initTikTokVideoPublish({
    accessToken,
    caption,
    videoSize: videoBlob.size ?? videoBlob.byteLength,
    privacyLevel,
    creatorInfo,
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

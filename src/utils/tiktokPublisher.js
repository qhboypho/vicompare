const DEFAULT_API_BASE = '/tiktok-api';
const DEFAULT_UPLOAD_BASE = '/tiktok-upload';
const MAX_TIKTOK_CAPTION_LENGTH = 2200;

// App TikTok chưa qua audit Content Posting API → CHỈ đăng được SELF_ONLY.
// SAU KHI TikTok duyệt audit xong, đổi thành false để đăng công khai
// (PUBLIC_TO_EVERYONE). Đây là công tắc duy nhất cần đổi.
export const TIKTOK_APP_UNAUDITED = true;

export const TIKTOK_DIRECT_POST_ENDPOINTS = {
  token: '/v2/oauth/token/',
  creatorInfo: '/v2/post/publish/creator_info/query/',
  videoInit: '/v2/post/publish/video/init/'
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export const getTikTokApiErrorMessage = (payload = {}, fallback = 'TikTok API error') => {
  const error = payload.error || {};
  const code = clean(error.code) || clean(payload.error);

  // Dịch một số error code khó hiểu của TikTok sang hướng dẫn tiếng Việt
  const FRIENDLY_MESSAGES = {
    unaudited_client_can_only_post_to_private_accounts:
      'App TikTok chưa qua audit nên chỉ đăng được vào tài khoản đang ở chế độ Riêng tư (Private). Cách xử lý: (1) Đặt tài khoản TikTok thành Private để đăng ngay, HOẶC (2) Nộp app cho TikTok audit (Developer Portal > App review > Submit for review) để đăng công khai.',
    spam_risk_too_many_pending_share:
      'Có quá nhiều video đang chờ đăng. Vui lòng đợi vài phút rồi thử lại.',
    spam_risk_user_banned_from_posting:
      'Tài khoản TikTok đang bị hạn chế đăng bài. Kiểm tra lại trạng thái tài khoản trên TikTok.',
    access_token_invalid:
      'Access token TikTok không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại qua OAuth.',
    scope_not_authorized:
      'App chưa được cấp quyền video.publish. Kiểm tra Products/Scopes trong TikTok Developer Portal.'
  };
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code];

  return clean(payload.error_description)
    || clean(payload.error)
    || clean(error.message)
    || clean(error.code)
    || fallback;
};

export const normalizeTikTokCaption = (caption) => clean(caption).slice(0, MAX_TIKTOK_CAPTION_LENGTH);

export const pickTikTokPrivacyLevel = (options = [], { unaudited = true } = {}) => {
  const allowed = Array.isArray(options) ? options.map(clean).filter(Boolean) : [];
  // App CHƯA audit chỉ được đăng SELF_ONLY. Chọn bất kỳ level nào khác đều bị
  // TikTok chặn với "unaudited_client_can_only_post_to_private_accounts".
  // Khi app audit xong, đặt unaudited=false để ưu tiên đăng công khai.
  if (unaudited) {
    return allowed.find(item => item === 'SELF_ONLY') || 'SELF_ONLY';
  }
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
  // TikTok trả upload_url theo region: open-upload.tiktokapis.com,
  // open-upload-sg.tiktokapis.com, open-upload-eu.tiktokapis.com, ...
  if (!/^open-upload[a-z0-9-]*\.tiktokapis\.com$/.test(parsed.hostname)) return uploadUrl;
  // Truyền host thật qua param để proxy forward đúng region
  const search = new URLSearchParams(parsed.search);
  search.set('__tt_host', parsed.hostname);
  return `${uploadBase}${parsed.pathname}?${search.toString()}`;
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
  console.log('[TikTok creator_info] HTTP', res.status, JSON.stringify(data.data || data));
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
  const payload = buildTikTokVideoInitPayload({
    caption,
    videoSize,
    privacyLevel,
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
  console.log('[TikTok video/init] level:', privacyLevel, '| response:', res.status, JSON.stringify(data));

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

  // TikTok CHỈ nhận MP4/MOV. Nếu video là WebM (Chrome cũ export), upload sẽ
  // "thành công" nhưng TikTok âm thầm hủy video → không bao giờ lên. Chặn sớm.
  const blobType = (videoBlob?.type || '').toLowerCase();
  if (blobType && !blobType.includes('mp4') && !blobType.includes('quicktime') && !blobType.includes('mov')) {
    throw new Error(`TikTok chỉ nhận video MP4/MOV nhưng video đang là định dạng "${blobType || 'không xác định'}". Trình duyệt của bạn xuất WebM — hãy dùng Chrome mới nhất (hỗ trợ xuất MP4) hoặc chuyển video sang MP4 trước khi đăng.`);
  }

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

  const privacyLevel = pickTikTokPrivacyLevel(creatorInfo.privacy_level_options, { unaudited: TIKTOK_APP_UNAUDITED });

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

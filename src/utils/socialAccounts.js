export const SOCIAL_ACCOUNT_STORAGE_KEY = 'social_accounts';
export const ACTIVE_SOCIAL_ACCOUNT_STORAGE_KEY = 'active_social_account_ids';
export const SELECTED_SOCIAL_ACCOUNT_STORAGE_KEY = 'selected_social_account_ids';

export const SOCIAL_PLATFORM_LABELS = {
  facebook: 'Facebook Reels',
  youtube: 'YouTube Shorts',
  tiktok: 'TikTok Video'
};

export const createSocialAccount = (platform, credentials, existingId = '') => {
  const now = Date.now();
  const id = existingId || `${platform}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const clean = Object.fromEntries(
    Object.entries(credentials || {}).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
  );

  return {
    id,
    platform,
    label: getSocialAccountLabel(platform, clean),
    credentials: clean,
    createdAt: existingId ? undefined : now,
    updatedAt: now
  };
};

export const getSocialAccountLabel = (platform, credentials = {}) => {
  if (credentials.displayName) return credentials.displayName;
  if (credentials.name) return credentials.name;
  if (platform === 'facebook') {
    return credentials.pageId ? `Page ${credentials.pageId}` : 'Facebook Page mới';
  }
  if (platform === 'youtube') {
    return credentials.channelId ? `Kênh ${credentials.channelId}` : 'YouTube Channel mới';
  }
  if (platform === 'tiktok') {
    return credentials.sessionId ? `@${credentials.sessionId.replace(/^@/, '')}` : 'TikTok mới';
  }
  return SOCIAL_PLATFORM_LABELS[platform] || 'Tài khoản mới';
};

export const emptySocialAccounts = () => ({
  facebook: [],
  youtube: [],
  tiktok: []
});

export const normalizeSocialAccounts = (rawAccounts, legacy = {}) => {
  const normalized = emptySocialAccounts();
  const source = rawAccounts && typeof rawAccounts === 'object' ? rawAccounts : {};

  for (const platform of Object.keys(normalized)) {
    const accounts = Array.isArray(source[platform]) ? source[platform] : [];
    normalized[platform] = accounts
      .filter(Boolean)
      .map((account) => createSocialAccount(platform, account.credentials || account, account.id))
      .map((account, index) => ({
        ...account,
        createdAt: accounts[index]?.createdAt || account.createdAt || Date.now(),
        updatedAt: accounts[index]?.updatedAt || account.updatedAt || Date.now()
      }));
  }

  if (legacy.facebook?.connected && legacy.facebook.pageId && normalized.facebook.length === 0) {
    normalized.facebook.push(createSocialAccount('facebook', legacy.facebook));
  }
  if (legacy.youtube?.connected && legacy.youtube.channelId && normalized.youtube.length === 0) {
    normalized.youtube.push(createSocialAccount('youtube', legacy.youtube));
  }
  if (legacy.tiktok?.connected && legacy.tiktok.sessionId && normalized.tiktok.length === 0) {
    normalized.tiktok.push(createSocialAccount('tiktok', legacy.tiktok));
  }

  return normalized;
};

export const getActiveSocialAccountIds = (accounts, rawActiveIds = {}) => {
  const activeIds = {};
  for (const platform of Object.keys(emptySocialAccounts())) {
    const list = accounts?.[platform] || [];
    const savedId = rawActiveIds?.[platform];
    activeIds[platform] = list.some((account) => account.id === savedId) ? savedId : (list[0]?.id || '');
  }
  return activeIds;
};

export const getSelectedSocialAccountIds = (accounts, rawSelectedIds = {}) => {
  const selectedIds = {};
  for (const platform of Object.keys(emptySocialAccounts())) {
    const list = accounts?.[platform] || [];
    const saved = Array.isArray(rawSelectedIds?.[platform]) ? rawSelectedIds[platform] : [];
    const validSaved = saved.filter((id) => list.some((account) => account.id === id));
    selectedIds[platform] = validSaved.length > 0 ? validSaved : (list[0]?.id ? [list[0].id] : []);
  }
  return selectedIds;
};

export const upsertSocialAccount = (accounts, platform, account) => {
  const next = normalizeSocialAccounts(accounts);
  const list = next[platform] || [];
  const idx = list.findIndex((item) => item.id === account.id);
  const normalizedAccount = createSocialAccount(platform, account.credentials || account, account.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...normalizedAccount, updatedAt: Date.now() };
  } else {
    list.push(normalizedAccount);
  }
  next[platform] = list;
  return next;
};

export const removeSocialAccount = (accounts, platform, accountId) => {
  const next = normalizeSocialAccounts(accounts);
  next[platform] = (next[platform] || []).filter((account) => account.id !== accountId);
  return next;
};

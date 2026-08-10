const cloneCredentials = (credentials = {}) => ({ ...credentials });

export function snapshotScheduledAccounts(accounts = []) {
  return (Array.isArray(accounts) ? accounts : []).map((account) => ({
    id: account?.id || '',
    label: account?.label || '',
    credentials: cloneCredentials(account?.credentials)
  }));
}

export function resolveScheduledAccounts(scheduledRefs = [], currentAccounts = []) {
  const currentById = new Map(
    (Array.isArray(currentAccounts) ? currentAccounts : [])
      .filter(Boolean)
      .map((account) => [account.id, account])
  );

  return (Array.isArray(scheduledRefs) ? scheduledRefs : [])
    .filter(Boolean)
    .map((snapshot) => {
      const current = currentById.get(snapshot.id);
      if (!current) {
        return {
          ...snapshot,
          credentials: cloneCredentials(snapshot.credentials)
        };
      }

      return {
        ...snapshot,
        ...current,
        credentials: {
          ...cloneCredentials(snapshot.credentials),
          ...cloneCredentials(current.credentials)
        }
      };
    });
}

export function getScheduledStatusView(post = {}) {
  if (post.status === 'published') {
    return { tone: 'success', label: 'Đã đăng', detail: '' };
  }
  if (post.status === 'publishing') {
    return { tone: 'progress', label: 'Đang đăng', detail: '' };
  }
  if (post.status === 'failed') {
    return { tone: 'error', label: 'Đăng lỗi', detail: String(post.error || 'Không rõ lỗi xuất bản') };
  }
  return { tone: 'pending', label: 'Đang chờ', detail: '' };
}

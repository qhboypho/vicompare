export function parseScheduleDateToIso(value) {
  const timestamp = new Date(String(value || '')).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error('Thời gian hẹn đăng không hợp lệ.');
  }
  return new Date(timestamp).toISOString();
}

function buildHeaders(syncToken = '') {
  const headers = {};
  const token = String(syncToken || '').trim();
  if (token) headers['X-Sync-Token'] = token;
  return headers;
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || response.statusText || `HTTP ${response.status}`);
  }
  return data;
}

export async function createCloudSchedule({
  endpoint,
  syncToken = '',
  post,
  videoBlob,
  fetchImpl = fetch
}) {
  if (!videoBlob || !Number.isFinite(Number(videoBlob.size)) || Number(videoBlob.size) <= 0) {
    throw new Error('Không có file video hợp lệ để đưa lên lịch cloud.');
  }

  const metadata = {
    id: post.id,
    caption: post.caption,
    platforms: post.platforms,
    selectedAccounts: post.selectedAccounts,
    affiliateLinks: Array.isArray(post.affiliateLinks) ? post.affiliateLinks : [],
    dueAt: post.dueAt
  };
  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));
  formData.append('video', videoBlob, `${post.id}.${videoBlob.type?.includes('mp4') ? 'mp4' : 'webm'}`);

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: buildHeaders(syncToken),
    body: formData
  });
  const data = await readJsonResponse(response);
  return data.schedule;
}

export async function fetchCloudSchedules({ endpoint, syncToken = '', fetchImpl = fetch }) {
  const response = await fetchImpl(endpoint, {
    headers: buildHeaders(syncToken)
  });
  const data = await readJsonResponse(response);
  return Array.isArray(data.schedules) ? data.schedules : [];
}

export async function deleteCloudSchedule({ endpoint, id, syncToken = '', fetchImpl = fetch }) {
  const url = new URL(endpoint);
  url.searchParams.set('id', id);
  const response = await fetchImpl(url.toString(), {
    method: 'DELETE',
    headers: buildHeaders(syncToken)
  });
  await readJsonResponse(response);
}

export function mergeCloudScheduleStatuses(localSchedules = [], cloudSchedules = []) {
  const cloudById = new Map((Array.isArray(cloudSchedules) ? cloudSchedules : []).map(item => [item.id, item]));
  return (Array.isArray(localSchedules) ? localSchedules : []).map((local) => {
    const cloud = cloudById.get(local.id);
    return cloud ? { ...local, ...cloud } : local;
  });
}

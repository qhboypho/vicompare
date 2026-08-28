// Affiliate comment helpers (dùng chung frontend + tham chiếu cho Worker).
//
// Mỗi trường affiliate gồm { description, link }. Một trường hợp lệ khi có link
// (mô tả có thể để trống). Comment message = mô tả + xuống dòng + link, mỗi
// trường thành một comment riêng biệt dưới video Facebook.

const GRAPH_PROXY_BASE = '/fb-api/v21.0';

// Chuẩn hóa danh sách affiliate về các message sẵn sàng để đăng comment.
// Bỏ qua trường không có link. Trả về mảng string.
export function buildAffiliateCommentMessages(affiliateLinks = []) {
  if (!Array.isArray(affiliateLinks)) return [];
  const messages = [];
  for (const item of affiliateLinks) {
    const link = String(item?.link || '').trim();
    if (!link) continue; // trường trống → bỏ qua
    const description = String(item?.description || '').trim();
    const message = description ? `${description}\n${link}` : link;
    messages.push(message);
  }
  return messages;
}

// Đăng lần lượt các comment lên một object Facebook (postId của video/reel).
// Lỗi từng comment được bỏ qua (log lại) để không chặn các comment sau.
// Trả về { posted, failed, errors } để caller báo cáo.
export async function postAffiliateComments({
  postId,
  accessToken,
  messages = [],
  graphBase = GRAPH_PROXY_BASE,
  fetchImpl = fetch,
  onStatus = () => {}
}) {
  const cleanPostId = String(postId || '').trim();
  const cleanToken = String(accessToken || '').trim();
  const result = { posted: 0, failed: 0, errors: [] };
  if (!cleanPostId || !cleanToken || messages.length === 0) return result;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    onStatus(`Đang đăng comment affiliate ${i + 1}/${messages.length}...`);
    try {
      const response = await fetchImpl(`${graphBase}/${encodeURIComponent(cleanPostId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: cleanToken, message })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        const errMsg = payload?.error?.message || response.statusText || `HTTP ${response.status}`;
        throw new Error(errMsg);
      }
      result.posted++;
    } catch (err) {
      // Bỏ qua, tiếp tục comment sau
      result.failed++;
      result.errors.push(`Comment ${i + 1}: ${err.message || String(err)}`);
      console.warn(`[Affiliate] Lỗi đăng comment ${i + 1}:`, err);
    }
  }
  return result;
}

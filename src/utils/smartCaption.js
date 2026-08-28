// Smart caption helpers cho Web Tool — mô phỏng cơ chế của Telegram bot:
// caption luôn kết thúc bằng hashtag mặc định #shorts #reels (bỏ tag trùng
// lặp trước khi gắn). Phần "thông minh" có 2 tầng:
//   1. Heuristic: dựng caption tức thì từ cặp so sánh đầu tiên của kịch bản.
//   2. AI: viết lại caption hấp dẫn hơn qua provider đã cấu hình cho bot
//      bình luận (gemini/groq/openrouter/openai). Lỗi AI được bỏ qua lặng lẽ —
//      caption heuristic vẫn đảm bảo có nội dung để đăng.

export const DEFAULT_CAPTION_HASHTAGS = '#shorts #reels';

export function ensurePublishHashtags(caption) {
  const base = String(caption || '').trim() || 'Video so sánh thú vị';
  const withoutTags = base
    .replace(/#shorts/gi, '')
    .replace(/#reels?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${withoutTags} ${DEFAULT_CAPTION_HASHTAGS}`.trim();
}

// Heuristic: dựng caption từ cặp so sánh đầu tiên của kịch bản đã parse.
// comparisons: [{ leftTitle, rightTitle, ... }] — cấu trúc của handleParseScript.
export function buildSmartCaptionFromScript(comparisons = [], headerTitle = '') {
  const first = Array.isArray(comparisons)
    ? comparisons.find(item => String(item?.leftTitle || '').trim() && String(item?.rightTitle || '').trim())
    : null;
  if (!first) {
    const topic = String(headerTitle || '').trim();
    return ensurePublishHashtags(
      topic
        ? `🔥 So sánh ${topic} — điểm khác biệt nằm ở đâu?\n✨ Xem hết video để biết câu trả lời nhé!\n👉 Follow để không bỏ lỡ video so sánh thú vị mỗi ngày!`
        : ''
    );
  }
  const left = String(first.leftTitle).trim();
  const right = String(first.rightTitle).trim();
  return ensurePublishHashtags(
    `🔥 ${left} hay ${right} — điểm khác biệt nằm ở đâu?\n✨ Xem hết video để biết câu trả lời nhé!\n👉 Follow để không bỏ lỡ video so sánh thú vị mỗi ngày!`
  );
}

export const CAPTION_AI_PROMPT = [
  'Bạn là chuyên gia nội dung video ngắn (TikTok/Shorts/Reels).',
  'Dựa trên kịch bản so sánh được cung cấp, hãy viết caption mô tả tiếng Việt gồm TỐI ĐA 3 DÒNG:',
  '- Dòng đầu: câu hook gây tò mò về cặp so sánh (kèm emoji phù hợp).',
  '- Các dòng sau: mời xem hết video và follow kênh.',
  'KHÔNG thêm bất kỳ hashtag nào (hệ thống tự gắn). CHỈ trả về nội dung caption, không giải thích.'
].join(' ');

const OPENAI_COMPATIBLE_PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile'
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3-8b-instruct:free'
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini'
  }
};

// Gọi AI theo provider đã chọn. Trả về caption đã gắn hashtag mặc định,
// hoặc '' khi lỗi/thiếu key/script — caller giữ nguyên caption heuristic.
export async function generateSmartCaption({ provider = 'gemini', apiKey = '', scriptText = '', fetchImpl = fetch } = {}) {
  const trimmedKey = String(apiKey || '').trim();
  const script = String(scriptText || '').trim();
  if (!trimmedKey || !script) return '';
  const userMessage = `Kịch bản video:\n${script.slice(0, 2500)}`;
  let text = '';
  try {
    if (provider === 'gemini') {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${trimmedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${CAPTION_AI_PROMPT}\n\n${userMessage}` }] }]
        })
      });
      if (!res.ok) return '';
      const data = await res.json();
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const config = OPENAI_COMPATIBLE_PROVIDERS[provider] || OPENAI_COMPATIBLE_PROVIDERS.openai;
      const res = await fetchImpl(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${trimmedKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: CAPTION_AI_PROMPT },
            { role: 'user', content: userMessage }
          ]
        })
      });
      if (!res.ok) return '';
      const data = await res.json();
      text = data.choices?.[0]?.message?.content || '';
    }
  } catch {
    return '';
  }
  const cleaned = String(text || '').trim();
  return cleaned ? ensurePublishHashtags(cleaned) : '';
}

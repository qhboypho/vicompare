export function normalizeSpeechText(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase('und');

  const tokens = normalized.match(/\p{L}[\p{L}\p{M}'’.-]*|\p{N}+(?:[.,]\p{N}+)*|[%&+]/gu) || [];
  return tokens
    .map((token) => {
      if (token === '%') return 'percent';
      if (token === '&') return 'and';
      if (token === '+') return 'plus';
      if (/^\p{N}/u.test(token)) return token.replace(',', '.');
      return token.replace(/[.'’-]/g, '');
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function alignAudioSegmentsToBlocks(blocks = [], audioSegments = []) {
  const sourceBlocks = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => String(block?.text || '').trim());
  const sourceSegments = (Array.isArray(audioSegments) ? audioSegments : [])
    .filter((segment) => segment && String(segment.text || '').trim());

  if (sourceBlocks.length !== sourceSegments.length) {
    return {
      ok: false,
      reason: `Số audio (${sourceSegments.length}) không khớp số dòng phụ đề (${sourceBlocks.length}).`,
      pairs: []
    };
  }

  // Số lượng đã khớp → ưu tiên ghép block i ↔ segment i (cùng thứ tự tách câu ở
  // bot và web). Text lệch NHẸ (bot thêm dấu chấm cuối, ký tự lạ) không được làm
  // hỏng căn khớp — nếu bỏ hết chỉ vì vài dòng lệch, Web rơi xuống silence-sync
  // (khớp kém hơn hẳn). NHƯNG nếu QUÁ NHIỀU dòng lệch (vd segment bị đảo thứ tự,
  // hoặc audio của kịch bản khác) thì thứ tự không còn đáng tin → reject để không
  // ghép nhầm phụ đề vào sai đoạn tiếng.
  const pairs = [];
  const mismatches = [];
  for (let index = 0; index < sourceBlocks.length; index += 1) {
    const block = sourceBlocks[index];
    const segment = sourceSegments[index];
    const blockText = normalizeSpeechText(block.text);
    const segmentText = normalizeSpeechText(segment.text);
    if (!blockText || !segmentText || blockText !== segmentText) {
      mismatches.push(index + 1);
    }
    pairs.push({ block, segment });
  }

  // Ngưỡng an toàn: cho phép tối đa ~30% số dòng lệch nhẹ (tối thiểu 1). Vượt ngưỡng
  // coi như thứ tự không đáng tin → reject.
  const maxAllowedMismatch = Math.max(1, Math.floor(sourceBlocks.length * 0.3));
  if (mismatches.length > maxAllowedMismatch) {
    return {
      ok: false,
      reason: `Quá nhiều dòng audio không khớp phụ đề (${mismatches.length}/${sourceBlocks.length}) → thứ tự không đáng tin.`,
      pairs: []
    };
  }

  return {
    ok: true,
    reason: mismatches.length > 0
      ? `Ghép theo thứ tự; ${mismatches.length} dòng text lệch nhẹ (dòng ${mismatches.join(', ')}).`
      : '',
    pairs
  };
}

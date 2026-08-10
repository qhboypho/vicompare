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

  const pairs = [];
  for (let index = 0; index < sourceBlocks.length; index += 1) {
    const block = sourceBlocks[index];
    const segment = sourceSegments[index];
    const blockText = normalizeSpeechText(block.text);
    const segmentText = normalizeSpeechText(segment.text);
    if (!blockText || !segmentText || blockText !== segmentText) {
      return {
        ok: false,
        reason: `Audio dòng ${index + 1} không khớp phụ đề: "${segment.text}" / "${block.text}".`,
        pairs: []
      };
    }
    pairs.push({ block, segment });
  }

  return { ok: true, reason: '', pairs };
}

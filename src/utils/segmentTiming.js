const DEFAULT_MIN_BLOCK_DURATION = 0.45;

export function getSpokenWeight(text) {
  const clean = String(text || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  if (!clean) return 1;
  const words = clean.split(/\s+/).filter(Boolean).length;
  return Math.max(1, words);
}

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function normalizeDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function estimateMissingDurations(blocks, durations, fallbackTotalDuration) {
  const normalized = blocks.map((_, index) => normalizeDuration(durations[index]));
  const knownTotal = normalized.reduce((sum, duration) => sum + (duration || 0), 0);
  const missingIndexes = normalized
    .map((duration, index) => duration ? -1 : index)
    .filter(index => index >= 0);

  if (missingIndexes.length === 0) return normalized;

  const missingWeight = missingIndexes.reduce((sum, index) => sum + getSpokenWeight(blocks[index]?.text), 0) || missingIndexes.length;
  const requestedTotal = normalizeDuration(fallbackTotalDuration);
  const remainingTotal = requestedTotal
    ? Math.max(DEFAULT_MIN_BLOCK_DURATION * missingIndexes.length, requestedTotal - knownTotal)
    : null;

  return normalized.map((duration, index) => {
    if (duration) return duration;
    const weight = getSpokenWeight(blocks[index]?.text);
    if (remainingTotal) {
      return Math.max(DEFAULT_MIN_BLOCK_DURATION, remainingTotal * (weight / missingWeight));
    }
    return Math.max(DEFAULT_MIN_BLOCK_DURATION, weight * 0.22);
  });
}

export function buildSegmentTimeline(blocks, segmentDurations = [], options = {}) {
  const sourceBlocks = Array.isArray(blocks) ? blocks : [];
  const introDelay = Math.max(0, Number(options.introDelay || 0));
  const segmentGap = Math.max(0, Number(options.segmentGap || 0));
  const outroPadding = Math.max(0, Number(options.outroPadding || 0));
  const durations = estimateMissingDurations(sourceBlocks, segmentDurations, options.fallbackTotalDuration);

  let cursor = introDelay;
  const timedBlocks = sourceBlocks.map((block, index) => {
    const start = roundTime(cursor);
    const duration = Math.max(DEFAULT_MIN_BLOCK_DURATION, durations[index] || DEFAULT_MIN_BLOCK_DURATION);
    const end = roundTime(start + duration);
    cursor = end + segmentGap;
    return {
      ...block,
      start,
      end
    };
  });

  const lastEnd = timedBlocks.length > 0 ? timedBlocks[timedBlocks.length - 1].end : introDelay;
  return {
    blocks: timedBlocks,
    duration: roundTime(lastEnd + outroPadding)
  };
}

function getActionType(block) {
  const override = String(block?.actionSfx || block?.sfx || 'auto').toLowerCase();
  if (['off', 'none', 'silent', 'tat', 'tắt'].includes(override)) return null;
  if (['point_left', 'point_right', 'shrug'].includes(override)) return override;

  const pose = String(block?.pose || '').toLowerCase();
  const highlight = String(block?.highlight || '').toLowerCase();
  if (pose === 'point_left' || highlight === 'left' || highlight === 'trai_sang') return 'point_left';
  if (pose === 'point_right' || highlight === 'right' || highlight === 'phai_sang') return 'point_right';
  if (pose === 'shrug' || pose === 'nhun_vai' || highlight === 'none' || highlight === 'khong_sang') return pose === 'shrug' ? 'shrug' : null;
  return null;
}

export function buildActionSfxEvents(blocks, options = {}) {
  if (options.enabled === false) return [];
  const offset = Math.max(0, Number(options.offset || 0));
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      const type = getActionType(block);
      if (!type) return null;
      return {
        id: block.id || `block-${index}`,
        type,
        time: roundTime(Math.max(0, Number(block.start || 0) + offset))
      };
    })
    .filter(Boolean);
}

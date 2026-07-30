import { UPLOADED_SOUND_EFFECT_DATA_URI } from '../assets/sounds/soundeffectData';

export async function decodeAudioBlob(blob) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Trình duyệt không hỗ trợ Web Audio API.');
  }
  const ctx = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (typeof ctx.close === 'function') {
      await ctx.close().catch(() => {});
    }
  }
}

export function audioBufferToWavBlob(buffer) {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numberOfChannels * 2;
  const wavBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(wavBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  const channelData = Array.from({ length: numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let sample = 0; sample < buffer.length; sample += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const clamped = Math.max(-1, Math.min(1, channelData[channel][sample]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export const ACTION_SFX_PRESETS = [
  { id: 'soft_whoosh', label: 'Whoosh nhẹ' },
  { id: 'pop_whoosh', label: 'Pop + Whoosh' },
  { id: 'capcut_swoosh_pop', label: 'Kiểu CapCut Swoosh Pop' },
  { id: 'capcut_tap_pop', label: 'Kiểu CapCut Tap Pop' },
  { id: 'capcut_bubble', label: 'Kiểu CapCut Bubble' },
  { id: 'camera_tick', label: 'Camera Tick' },
  { id: 'digital_blip', label: 'Digital Blip' },
  { id: 'cartoon_boing', label: 'Cartoon Boing' },
  { id: 'uploaded_soundeffect', label: 'Swish' }
];

const ACTION_SFX_FILE_PRESETS = {
  uploaded_soundeffect: UPLOADED_SOUND_EFFECT_DATA_URI
};

const actionSfxFileCache = new Map();

export const DEFAULT_ACTION_SFX_PRESETS = {
  point_left: 'capcut_swoosh_pop',
  point_right: 'capcut_swoosh_pop',
  shrug: 'capcut_bubble',
  default: 'capcut_tap_pop'
};

export function normalizeActionSfxPresets(value = {}) {
  const allowed = new Set(ACTION_SFX_PRESETS.map(preset => preset.id));
  const parsed = typeof value === 'string' ? safeJsonParse(value, {}) : value;
  return {
    point_left: allowed.has(parsed?.point_left) ? parsed.point_left : DEFAULT_ACTION_SFX_PRESETS.point_left,
    point_right: allowed.has(parsed?.point_right) ? parsed.point_right : DEFAULT_ACTION_SFX_PRESETS.point_right,
    shrug: allowed.has(parsed?.shrug) ? parsed.shrug : DEFAULT_ACTION_SFX_PRESETS.shrug,
    default: allowed.has(parsed?.default) ? parsed.default : DEFAULT_ACTION_SFX_PRESETS.default
  };
}

export async function playActionSfxPreview({ type = 'point_left', preset = 'soft_whoosh', volume = 0.25 } = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const ctx = new AudioContextCtor();
  try {
    const buffer = await createActionSfxBuffer(ctx, type, volume, preset);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    source.onended = () => {
      if (typeof ctx.close === 'function') ctx.close().catch(() => {});
    };
  } catch (err) {
    if (typeof ctx.close === 'function') ctx.close().catch(() => {});
    throw err;
  }
}

export async function renderSegmentedAudio({ audioBuffers, timelineBlocks, actionEvents = [], sfxVolume = 0.2, actionSfxPresets = {} }) {
  const AudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext để ghép audio.');
  }

  const sampleRate = audioBuffers.find(Boolean)?.sampleRate || 44100;
  const channelCount = 2;
  const totalDuration = Math.max(
    1,
    ...timelineBlocks.map(block => Number(block.end || 0)),
    ...actionEvents.map(event => Number(event.time || 0) + getActionSfxDurationHint(event.preset || normalizeActionSfxPresets(actionSfxPresets)[event.type] || normalizeActionSfxPresets(actionSfxPresets).default))
  );
  const offlineCtx = new AudioContextCtor(channelCount, Math.ceil(totalDuration * sampleRate), sampleRate);

  audioBuffers.forEach((buffer, index) => {
    const block = timelineBlocks[index];
    if (!buffer || !block) return;
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(Math.max(0, Number(block.start || 0)));
  });

  const presets = normalizeActionSfxPresets(actionSfxPresets);
  for (const event of actionEvents) {
    const preset = event.preset || presets[event.type] || presets.default;
    const sfxBuffer = await createActionSfxBuffer(offlineCtx, event.type, sfxVolume, preset);
    const source = offlineCtx.createBufferSource();
    source.buffer = sfxBuffer;
    source.connect(offlineCtx.destination);
    source.start(Math.max(0, Number(event.time || 0)));
  }

  return await offlineCtx.startRendering();
}

async function createActionSfxBuffer(ctx, type, volume, presetKey = 'soft_whoosh') {
  if (ACTION_SFX_FILE_PRESETS[presetKey]) {
    return await createFileActionSfxBuffer(ctx, presetKey, volume);
  }

  const sampleRate = ctx.sampleRate;
  const profile = getActionSfxProfile(type, presetKey);
  const duration = profile.duration;
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const safeVolume = Math.max(0, Math.min(1, Number(volume || 0)));
  let noiseSeed = profile.seed;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const progress = i / length;
    noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
    const noise = ((noiseSeed / 0xffffffff) * 2 - 1) * profile.noise;
    const popEnv = Math.exp(-progress * profile.popDecay);
    const whooshEnv = Math.sin(Math.PI * Math.min(1, progress / 0.92)) * Math.pow(1 - progress, profile.whooshDecay);
    const wobble = profile.wobble ? Math.sin(t * Math.PI * profile.wobble.rate) * profile.wobble.depth : 0;
    const sweepFreq = profile.startFreq + (profile.endFreq - profile.startFreq) * Math.min(1, progress * 1.25) + wobble;
    const pop = Math.sin(2 * Math.PI * profile.popFreq * t) * popEnv * profile.popGain;
    const whoosh = (Math.sin(2 * Math.PI * sweepFreq * t) * profile.toneGain + noise) * whooshEnv * profile.whooshGain;
    const click = profile.clicks.reduce((sum, clickDef) => {
      const clickT = Math.max(0, t - clickDef.time);
      if (t < clickDef.time) return sum;
      return sum + Math.sin(2 * Math.PI * clickDef.freq * clickT) * Math.exp(-clickT * clickDef.decay) * clickDef.gain;
    }, 0);
    const sample = (pop + whoosh + click) * safeVolume;
    const leftGain = Math.sqrt((1 - profile.pan) / 2);
    const rightGain = Math.sqrt((1 + profile.pan) / 2);
    left[i] = sample * leftGain;
    right[i] = sample * rightGain;
  }

  return buffer;
}

async function createFileActionSfxBuffer(ctx, presetKey, volume) {
  const url = ACTION_SFX_FILE_PRESETS[presetKey];
  const cacheKey = `${presetKey}:${ctx.sampleRate}`;
  let decoded = actionSfxFileCache.get(cacheKey);

  if (!decoded) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Không tải được file sound effect: ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    actionSfxFileCache.set(cacheKey, decoded);
  }

  const safeVolume = Math.max(0, Math.min(1, Number(volume || 0)));
  const channelCount = 2;
  const buffer = ctx.createBuffer(channelCount, decoded.length, ctx.sampleRate);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = decoded.getChannelData(Math.min(channel, decoded.numberOfChannels - 1));
    const target = buffer.getChannelData(channel);
    for (let i = 0; i < source.length; i += 1) {
      target[i] = Math.max(-1, Math.min(1, source[i] * safeVolume));
    }
  }

  return buffer;
}

function getActionSfxDurationHint(presetKey) {
  return ACTION_SFX_FILE_PRESETS[presetKey] ? 1.5 : 0.35;
}

function getActionSfxProfile(type, presetKey) {
  const pan = type === 'point_left' ? -0.48 : type === 'point_right' ? 0.48 : 0;
  const direction = type === 'point_left' ? -1 : 1;
  const base = {
    pan,
    duration: type === 'shrug' ? 0.36 : 0.28,
    startFreq: direction > 0 ? 420 : 1280,
    endFreq: direction > 0 ? 1280 : 420,
    popFreq: type === 'shrug' ? 620 : 860,
    popGain: 0.65,
    popDecay: 22,
    whooshGain: 0.6,
    toneGain: 0.45,
    whooshDecay: 1.8,
    noise: 0.18,
    clicks: [],
    wobble: type === 'shrug' ? { rate: 18, depth: 120 } : null,
    seed: type === 'point_right' ? 0x9e3779b9 : type === 'shrug' ? 0x7f4a7c15 : type === 'default' ? 0x31a53f2d : 0x45d9f3b
  };

  const presets = {
    soft_whoosh: {},
    pop_whoosh: {
      popGain: 0.95,
      popFreq: 1040,
      popDecay: 28,
      whooshGain: 0.72
    },
    capcut_swoosh_pop: {
      duration: 0.24,
      popGain: 1,
      popFreq: 1220,
      popDecay: 32,
      whooshGain: 0.78,
      toneGain: 0.5,
      noise: 0.22,
      clicks: [{ time: 0.04, freq: 1600, decay: 54, gain: 0.28 }]
    },
    capcut_tap_pop: {
      duration: 0.18,
      startFreq: 760,
      endFreq: 920,
      popFreq: 980,
      popGain: 1,
      popDecay: 42,
      whooshGain: 0.16,
      noise: 0.08,
      clicks: [{ time: 0.03, freq: 1800, decay: 70, gain: 0.42 }]
    },
    capcut_bubble: {
      duration: 0.34,
      startFreq: 520,
      endFreq: 760,
      popFreq: 620,
      popGain: 0.72,
      whooshGain: 0.2,
      noise: 0.05,
      wobble: { rate: 14, depth: 160 },
      clicks: [
        { time: 0.08, freq: 780, decay: 26, gain: 0.58 },
        { time: 0.18, freq: 1120, decay: 30, gain: 0.52 }
      ]
    },
    camera_tick: {
      duration: 0.22,
      startFreq: 900,
      endFreq: 680,
      popFreq: 1200,
      popGain: 0.55,
      popDecay: 38,
      whooshGain: 0.08,
      noise: 0.12,
      clicks: [
        { time: 0.02, freq: 2200, decay: 90, gain: 0.48 },
        { time: 0.09, freq: 1500, decay: 80, gain: 0.35 }
      ]
    },
    digital_blip: {
      duration: 0.2,
      startFreq: 1320,
      endFreq: 1760,
      popFreq: 1480,
      popGain: 0.8,
      popDecay: 25,
      whooshGain: 0.1,
      toneGain: 0.8,
      noise: 0.02,
      clicks: [{ time: 0.1, freq: 1960, decay: 44, gain: 0.3 }]
    },
    cartoon_boing: {
      duration: 0.38,
      startFreq: 440,
      endFreq: 520,
      popFreq: 360,
      popGain: 0.55,
      popDecay: 16,
      whooshGain: 0.28,
      noise: 0.03,
      wobble: { rate: 11, depth: 210 },
      clicks: [{ time: 0.14, freq: 520, decay: 18, gain: 0.5 }]
    }
  };

  return { ...base, ...(presets[presetKey] || presets.soft_whoosh) };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

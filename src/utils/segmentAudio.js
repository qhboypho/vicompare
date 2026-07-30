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

export async function renderSegmentedAudio({ audioBuffers, timelineBlocks, actionEvents = [], sfxVolume = 0.2 }) {
  const AudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext để ghép audio.');
  }

  const sampleRate = audioBuffers.find(Boolean)?.sampleRate || 44100;
  const channelCount = 2;
  const totalDuration = Math.max(
    1,
    ...timelineBlocks.map(block => Number(block.end || 0)),
    ...actionEvents.map(event => Number(event.time || 0) + 0.35)
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

  actionEvents.forEach(event => {
    const sfxBuffer = createActionSfxBuffer(offlineCtx, event.type, sfxVolume);
    const source = offlineCtx.createBufferSource();
    source.buffer = sfxBuffer;
    source.connect(offlineCtx.destination);
    source.start(Math.max(0, Number(event.time || 0)));
  });

  return await offlineCtx.startRendering();
}

function createActionSfxBuffer(ctx, type, volume) {
  const sampleRate = ctx.sampleRate;
  const duration = type === 'shrug' ? 0.36 : 0.3;
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const safeVolume = Math.max(0, Math.min(1, Number(volume || 0)));
  const profile = getActionSfxProfile(type);
  let noiseSeed = profile.seed;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const progress = i / length;
    noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
    const noise = ((noiseSeed / 0xffffffff) * 2 - 1) * 0.18;
    const popEnv = Math.exp(-progress * 22);
    const whooshEnv = Math.sin(Math.PI * Math.min(1, progress / 0.92)) * Math.pow(1 - progress, 1.8);
    const wobble = type === 'shrug' ? Math.sin(t * Math.PI * 18) * 120 : 0;
    const sweepFreq = profile.startFreq + (profile.endFreq - profile.startFreq) * Math.min(1, progress * 1.2) + wobble;
    const pop = Math.sin(2 * Math.PI * profile.popFreq * t) * popEnv;
    const whoosh = (Math.sin(2 * Math.PI * sweepFreq * t) * 0.45 + noise) * whooshEnv;
    const secondShrugTap = type === 'shrug'
      ? Math.sin(2 * Math.PI * 660 * Math.max(0, t - 0.16)) * Math.exp(-Math.max(0, t - 0.16) * 30) * (t > 0.16 ? 0.7 : 0)
      : 0;
    const sample = (pop * 0.85 + whoosh + secondShrugTap) * safeVolume;
    const leftGain = Math.sqrt((1 - profile.pan) / 2);
    const rightGain = Math.sqrt((1 + profile.pan) / 2);
    left[i] = sample * leftGain;
    right[i] = sample * rightGain;
  }

  return buffer;
}

function getActionSfxProfile(type) {
  if (type === 'point_right') {
    return {
      pan: 0.48,
      startFreq: 420,
      endFreq: 1280,
      popFreq: 980,
      seed: 0x9e3779b9
    };
  }
  if (type === 'shrug') {
    return {
      pan: 0,
      startFreq: 520,
      endFreq: 760,
      popFreq: 620,
      seed: 0x7f4a7c15
    };
  }
  return {
    pan: -0.48,
    startFreq: 1280,
    endFreq: 420,
    popFreq: 760,
    seed: 0x45d9f3b
  };
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

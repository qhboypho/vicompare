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
  const channelCount = Math.max(1, Math.min(2, ...audioBuffers.filter(Boolean).map(buffer => buffer.numberOfChannels || 1)));
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
  const duration = type === 'shrug' ? 0.34 : 0.18;
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const safeVolume = Math.max(0, Math.min(1, Number(volume || 0)));
  const baseFreq = type === 'point_right' ? 1040 : type === 'shrug' ? 520 : 780;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const env = Math.pow(1 - i / length, type === 'shrug' ? 1.2 : 2.8);
    const bend = type === 'shrug' ? Math.sin(t * Math.PI * 12) * 90 : 0;
    const click = Math.sin(2 * Math.PI * (baseFreq + bend) * t);
    const overtone = Math.sin(2 * Math.PI * (baseFreq * 1.8) * t) * 0.35;
    data[i] = (click + overtone) * env * safeVolume;
  }

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Speech-onset / offset detection for TTS segments.
//
// TTS + MP3 segments carry silence the timeline must not treat as speech:
//   - MP3/AAC encoder delay + padding (a few ms of digital silence per file)
//   - Natural pauses the voice model renders before and after the utterance
//
// If a subtitle is anchored to the raw file boundaries, the caption shows up
// slightly before the voice starts. Because each segment adds its own head/tail
// silence, the error accumulates across the clip — captions look ~right on the
// first line and visibly early by the last (the "only 95% in sync" symptom).
//
// This module finds the voiced region inside a decoded AudioBuffer so the
// caption can be pinned to real speech instead of the file edge.

const DEFAULT_FRAME_SECONDS = 0.02; // 20ms analysis window
const DEFAULT_SILENCE_FLOOR = 0.0025; // absolute RMS floor for pure digital silence
const DEFAULT_RELATIVE_FLOOR = 0.08; // fraction of peak RMS treated as "still silence"
const DEFAULT_HANGOVER_SECONDS = 0.06; // keep this much silence padding around speech

function toMonoRms(buffer, frameSize) {
  const channelCount = buffer.numberOfChannels || 1;
  const length = buffer.length;
  const frameCount = Math.max(1, Math.ceil(length / frameSize));
  const rms = new Float32Array(frameCount);

  const channels = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    const startSample = frame * frameSize;
    const endSample = Math.min(length, startSample + frameSize);
    let sumSquares = 0;
    let counted = 0;
    for (let sample = startSample; sample < endSample; sample += 1) {
      let mixed = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        mixed += channels[channel][sample];
      }
      mixed /= channelCount;
      sumSquares += mixed * mixed;
      counted += 1;
    }
    rms[frame] = counted > 0 ? Math.sqrt(sumSquares / counted) : 0;
  }

  return rms;
}

/**
 * Analyse a decoded AudioBuffer and locate its voiced region.
 *
 * Returns seconds relative to the start of the buffer:
 *   - leadIn:         silence before speech begins
 *   - speechStart:    onset of voiced audio (= leadIn)
 *   - speechEnd:      offset of voiced audio
 *   - speechDuration: speechEnd - speechStart
 *   - tailOut:        silence after speech ends
 *   - duration:       full buffer duration (unchanged)
 *
 * A buffer with no detectable speech (or a non-buffer input) is reported as
 * fully voiced so callers fall back to the previous whole-file behaviour
 * instead of collapsing the block to zero length.
 */
export function analyzeSegmentSpeech(buffer, options = {}) {
  const sampleRate = Number(buffer?.sampleRate) || 44100;
  const duration = Number(buffer?.duration) || (buffer?.length ? buffer.length / sampleRate : 0);

  const fallback = {
    leadIn: 0,
    speechStart: 0,
    speechEnd: duration,
    speechDuration: duration,
    tailOut: 0,
    duration
  };

  if (!buffer || typeof buffer.getChannelData !== 'function' || !buffer.length || duration <= 0) {
    return fallback;
  }

  const frameSeconds = Math.max(0.005, Number(options.frameSeconds) || DEFAULT_FRAME_SECONDS);
  const frameSize = Math.max(1, Math.round(frameSeconds * sampleRate));
  const rms = toMonoRms(buffer, frameSize);

  let peak = 0;
  for (let i = 0; i < rms.length; i += 1) {
    if (rms[i] > peak) peak = rms[i];
  }
  if (peak <= 0) return fallback;

  const relativeFloor = Math.max(0, Number(options.relativeFloor ?? DEFAULT_RELATIVE_FLOOR));
  const absoluteFloor = Math.max(0, Number(options.silenceFloor ?? DEFAULT_SILENCE_FLOOR));
  const threshold = Math.max(absoluteFloor, peak * relativeFloor);

  let firstVoiced = -1;
  let lastVoiced = -1;
  for (let i = 0; i < rms.length; i += 1) {
    if (rms[i] >= threshold) {
      if (firstVoiced === -1) firstVoiced = i;
      lastVoiced = i;
    }
  }

  if (firstVoiced === -1) return fallback;

  const secondsPerFrame = frameSize / sampleRate;
  const hangover = Math.max(0, Number(options.hangoverSeconds ?? DEFAULT_HANGOVER_SECONDS));

  let speechStart = firstVoiced * secondsPerFrame - hangover;
  let speechEnd = (lastVoiced + 1) * secondsPerFrame + hangover;

  speechStart = Math.max(0, Math.min(speechStart, duration));
  speechEnd = Math.max(speechStart, Math.min(speechEnd, duration));

  return {
    leadIn: speechStart,
    speechStart,
    speechEnd,
    speechDuration: Math.max(0, speechEnd - speechStart),
    tailOut: Math.max(0, duration - speechEnd),
    duration
  };
}

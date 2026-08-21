import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSegmentSpeech } from './speechOnset.js';

// Minimal AudioBuffer stand-in for node:test (no Web Audio in Node).
function makeBuffer({ sampleRate = 48000, channels }) {
  const length = channels[0].length;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (i) => channels[i]
  };
}

function tone({ sampleRate, leadSeconds, speechSeconds, tailSeconds, amp = 0.5, freq = 220 }) {
  const total = Math.round((leadSeconds + speechSeconds + tailSeconds) * sampleRate);
  const data = new Float32Array(total);
  const speechStart = Math.round(leadSeconds * sampleRate);
  const speechEnd = Math.round((leadSeconds + speechSeconds) * sampleRate);
  for (let i = speechStart; i < speechEnd; i += 1) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
  }
  return data;
}

test('detects leading and trailing silence around speech', () => {
  const sampleRate = 48000;
  const data = tone({ sampleRate, leadSeconds: 0.3, speechSeconds: 1.0, tailSeconds: 0.4 });
  const buffer = makeBuffer({ sampleRate, channels: [data] });

  const region = analyzeSegmentSpeech(buffer, { hangoverSeconds: 0 });

  // Onset within ~one analysis frame of the true 0.3s boundary.
  assert.ok(Math.abs(region.leadIn - 0.3) <= 0.03, `leadIn ${region.leadIn}`);
  assert.ok(Math.abs(region.tailOut - 0.4) <= 0.03, `tailOut ${region.tailOut}`);
  assert.ok(Math.abs(region.speechDuration - 1.0) <= 0.05, `speech ${region.speechDuration}`);
  assert.ok(Math.abs(region.duration - 1.7) <= 0.001);
});

test('treats an all-silent buffer as fully voiced so blocks never collapse', () => {
  const sampleRate = 48000;
  const data = new Float32Array(Math.round(1.5 * sampleRate)); // pure silence
  const buffer = makeBuffer({ sampleRate, channels: [data] });

  const region = analyzeSegmentSpeech(buffer);

  assert.equal(region.leadIn, 0);
  assert.equal(region.tailOut, 0);
  assert.ok(Math.abs(region.speechDuration - 1.5) <= 0.001);
});

test('non-buffer input falls back safely', () => {
  const region = analyzeSegmentSpeech(null);
  assert.equal(region.leadIn, 0);
  assert.equal(region.speechDuration, 0);
  assert.equal(region.duration, 0);
});

test('averages channels for stereo speech detection', () => {
  const sampleRate = 48000;
  const left = tone({ sampleRate, leadSeconds: 0.2, speechSeconds: 0.6, tailSeconds: 0.2 });
  const right = tone({ sampleRate, leadSeconds: 0.2, speechSeconds: 0.6, tailSeconds: 0.2 });
  const buffer = makeBuffer({ sampleRate, channels: [left, right] });

  const region = analyzeSegmentSpeech(buffer, { hangoverSeconds: 0 });
  assert.ok(Math.abs(region.leadIn - 0.2) <= 0.03, `leadIn ${region.leadIn}`);
});

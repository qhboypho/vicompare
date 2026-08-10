import test from 'node:test';
import assert from 'node:assert/strict';

import {
  alignAudioSegmentsToBlocks,
  normalizeSpeechText
} from './speechAlignment.js';

test('normalizes Vietnamese and provider-added terminal punctuation consistently', () => {
  assert.equal(
    normalizeSpeechText('  Đây là Chó Phú Quốc…  '),
    normalizeSpeechText('Đây là chó Phú Quốc.')
  );
});

test('keeps English numbers, decimals and percentages stable while matching punctuation variants', () => {
  assert.equal(
    normalizeSpeechText('In 2026, growth is 12.5%.'),
    normalizeSpeechText('In 2026 growth is 12.5 percent')
  );
});

test('aligns audio segments to subtitle blocks by normalized text identity', () => {
  const blocks = [
    { id: 'a', text: 'Đây là Chó Phú Quốc.' },
    { id: 'b', text: 'In 2026, growth is 12.5%.' }
  ];
  const segments = [
    { text: 'Đây là chó Phú Quốc', base64: 'AAA' },
    { text: 'In 2026 growth is 12.5 percent', base64: 'BBB' }
  ];

  const result = alignAudioSegmentsToBlocks(blocks, segments);

  assert.equal(result.ok, true);
  assert.deepEqual(result.pairs.map(pair => pair.block.id), ['a', 'b']);
  assert.deepEqual(result.pairs.map(pair => pair.segment.base64), ['AAA', 'BBB']);
});

test('rejects reordered or unrelated segments instead of silently syncing the wrong subtitle', () => {
  const result = alignAudioSegmentsToBlocks(
    [{ text: 'Left side' }, { text: 'Right side' }],
    [{ text: 'Right side' }, { text: 'Left side' }]
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /không khớp/i);
});

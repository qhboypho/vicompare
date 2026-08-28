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
  assert.match(result.reason, /không khớp|không đáng tin/i);
});

test('keeps order-based pairing when only a few lines drift slightly (avoids silence-sync fallback)', () => {
  // 5 dòng, chỉ 1 dòng lệch text hẳn → vẫn ghép theo thứ tự (không rơi silence-sync)
  const blocks = [
    { id: '1', text: 'Câu một.' },
    { id: '2', text: 'Câu hai.' },
    { id: '3', text: 'Câu ba khác hẳn.' },
    { id: '4', text: 'Câu bốn.' },
    { id: '5', text: 'Câu năm.' }
  ];
  const segments = [
    { text: 'Câu một', base64: 'A' },
    { text: 'Câu hai', base64: 'B' },
    { text: 'Nội dung bot đọc lệch', base64: 'C' },
    { text: 'Câu bốn', base64: 'D' },
    { text: 'Câu năm', base64: 'E' }
  ];
  const result = alignAudioSegmentsToBlocks(blocks, segments);
  assert.equal(result.ok, true);
  assert.deepEqual(result.pairs.map(p => p.segment.base64), ['A', 'B', 'C', 'D', 'E']);
});

test('rejects when too many lines drift (order untrustworthy)', () => {
  const blocks = [
    { id: '1', text: 'Alpha.' },
    { id: '2', text: 'Bravo.' },
    { id: '3', text: 'Charlie.' }
  ];
  const segments = [
    { text: 'Xxxx', base64: 'A' },
    { text: 'Yyyy', base64: 'B' },
    { text: 'Charlie', base64: 'C' }
  ];
  const result = alignAudioSegmentsToBlocks(blocks, segments);
  assert.equal(result.ok, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSegmentTimeline,
  buildActionSfxEvents,
  getSpokenWeight
} from './segmentTiming.js';

test('buildSegmentTimeline uses exact per-segment durations cumulatively', () => {
  const blocks = [
    { id: 'a', text: 'Day la cho Doberman.', start: 9, end: 12, pose: 'point_left', highlight: 'left' },
    { id: 'b', text: 'Day la cho Rottweiler.', start: 12, end: 15, pose: 'point_right', highlight: 'right' },
    { id: 'c', text: 'Su khac nhau la gi?', start: 15, end: 18, pose: 'shrug', highlight: 'none' }
  ];

  const result = buildSegmentTimeline(blocks, [1.25, 2.5, 0.75], {
    introDelay: 0.4,
    segmentGap: 0.1,
    outroPadding: 0.2
  });

  assert.deepEqual(result.blocks.map(block => [block.start, block.end]), [
    [0.4, 1.65],
    [1.75, 4.25],
    [4.35, 5.1]
  ]);
  assert.equal(result.duration, 5.3);
  assert.equal(result.blocks[0].pose, 'point_left');
  assert.equal(result.blocks[1].highlight, 'right');
});

test('buildSegmentTimeline falls back from missing durations without collapsing blocks', () => {
  const blocks = [
    { id: 'a', text: 'Mot cau ngan.' },
    { id: 'b', text: 'Mot cau dai hon rat nhieu de co trong so lon hon.' }
  ];

  const result = buildSegmentTimeline(blocks, [2], {
    introDelay: 0,
    segmentGap: 0,
    fallbackTotalDuration: 6
  });

  assert.equal(result.blocks[0].start, 0);
  assert.equal(result.blocks[0].end, 2);
  assert.equal(result.blocks[1].start, 2);
  assert.ok(result.blocks[1].end > result.blocks[1].start);
  assert.equal(result.duration, result.blocks[1].end);
});

test('buildSegmentTimeline anchors captions to voiced onset and strips silence drift', () => {
  const blocks = [
    { id: 'a', text: 'Cau mot.' },
    { id: 'b', text: 'Cau hai.' }
  ];

  // Each 2s file has 0.3s lead-in silence + 1.4s speech + 0.3s tail silence.
  const region = { leadIn: 0.3, speechDuration: 1.4, tailOut: 0.3, duration: 2 };
  const result = buildSegmentTimeline(blocks, [2, 2], {
    introDelay: 0,
    segmentGap: 0,
    speechRegions: [region, region]
  });

  // Caption 1: voiced onset at 0, lasts only the 1.4s of speech.
  assert.deepEqual([result.blocks[0].start, result.blocks[0].end], [0, 1.4]);
  // Buffer starts at 0 (cannot go before the timeline origin) even though its
  // voiced part begins 0.3s in — the leadIn is clamped at the start.
  assert.equal(result.blocks[0].audioStart, 0);

  // Caption 2 begins right where caption 1's speech ends — silence removed,
  // so there is NO accumulated drift between the two lines.
  assert.deepEqual([result.blocks[1].start, result.blocks[1].end], [1.4, 2.8]);
  // Its buffer is pulled back by its own lead-in to stay voice-aligned.
  assert.equal(result.blocks[1].audioStart, 1.1);
});

test('buildSegmentTimeline stays backward compatible without speech regions', () => {
  const blocks = [{ id: 'a', text: 'Mot.' }, { id: 'b', text: 'Hai.' }];
  const result = buildSegmentTimeline(blocks, [1, 1], { introDelay: 0, segmentGap: 0 });

  assert.deepEqual([result.blocks[0].start, result.blocks[0].end], [0, 1]);
  assert.deepEqual([result.blocks[1].start, result.blocks[1].end], [1, 2]);
  // No lead-in known → audio plays exactly at caption start.
  assert.equal(result.blocks[0].audioStart, 0);
  assert.equal(result.blocks[1].audioStart, 1);
});

test('buildActionSfxEvents maps mascot actions to stable audio cues', () => {
  const blocks = [
    { id: 'a', start: 0.5, end: 1.5, pose: 'point_left' },
    { id: 'b', start: 1.7, end: 2.4, pose: 'point_right' },
    { id: 'c', start: 2.6, end: 3.1, pose: 'shrug' },
    { id: 'd', start: 3.3, end: 4.1, pose: 'default', highlight: 'left' }
  ];

  assert.deepEqual(buildActionSfxEvents(blocks, { enabled: true }), [
    { id: 'a', type: 'point_left', time: 0.5 },
    { id: 'b', type: 'point_right', time: 1.7 },
    { id: 'c', type: 'shrug', time: 2.6 },
    { id: 'd', type: 'point_left', time: 3.3 }
  ]);
  assert.deepEqual(buildActionSfxEvents(blocks, { enabled: false }), []);
});

test('buildActionSfxEvents lets each timeline block override or disable its cue', () => {
  const blocks = [
    { id: 'a', start: 0.5, pose: 'point_left', actionSfx: 'off' },
    { id: 'b', start: 1.5, pose: 'default', actionSfx: 'point_right' },
    { id: 'c', start: 2.5, pose: 'point_left', actionSfx: 'shrug' },
    { id: 'd', start: 3.5, pose: 'point_right', actionSfx: 'auto' },
    { id: 'e', start: 4.5, pose: 'default', actionSfx: 'default' }
  ];

  assert.deepEqual(buildActionSfxEvents(blocks, { enabled: true, offset: 0.02 }), [
    { id: 'b', type: 'point_right', time: 1.52 },
    { id: 'c', type: 'shrug', time: 2.52 },
    { id: 'd', type: 'point_right', time: 3.52 },
    { id: 'e', type: 'default', time: 4.52 }
  ]);
});

test('getSpokenWeight treats punctuation-only text as a safe minimum', () => {
  assert.equal(getSpokenWeight('...'), 1);
  assert.ok(getSpokenWeight('Doberman co than hinh thon gon') > 1);
});

test('getSpokenWeight handles Vietnamese, English abbreviations and numeric expressions', () => {
  assert.ok(getSpokenWeight('Chó Phú Quốc rất thông minh.') >= 5);
  assert.ok(getSpokenWeight('API v2 reached 12.5% in 2026.') > getSpokenWeight('API reached twelve percent.'));
  assert.ok(getSpokenWeight('Năm 2026.') > getSpokenWeight('Năm nay.'));
  assert.ok(getSpokenWeight('API ready.') > getSpokenWeight('Tool ready.'));
});

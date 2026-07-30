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

test('getSpokenWeight treats punctuation-only text as a safe minimum', () => {
  assert.equal(getSpokenWeight('...'), 1);
  assert.ok(getSpokenWeight('Doberman co than hinh thon gon') > 1);
});

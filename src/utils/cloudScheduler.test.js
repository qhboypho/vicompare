import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCloudSchedule,
  mergeCloudScheduleStatuses,
  parseScheduleDateToIso
} from './cloudScheduler.js';

test('converts the datetime-local value to an absolute ISO timestamp', () => {
  const result = parseScheduleDateToIso('2026-08-17T08:30');
  assert.equal(result, new Date(2026, 7, 17, 8, 30, 0, 0).toISOString());
});

test('uploads schedule metadata and the rendered video to the Worker', async () => {
  let request = null;
  const video = new Blob(['video-data'], { type: 'video/webm' });
  const response = await createCloudSchedule({
    endpoint: 'https://worker.example.com/api/schedules',
    syncToken: 'secret-token',
    post: {
      id: 'post-1',
      caption: 'Bai viet',
      platforms: ['facebook'],
      selectedAccounts: { facebook: [{ id: 'page-1', credentials: { pageId: '1', accessToken: 'token' } }] },
      dueAt: '2026-08-17T01:30:00.000Z'
    },
    videoBlob: video,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ success: true, schedule: { id: 'post-1', status: 'pending' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.equal(request.url, 'https://worker.example.com/api/schedules');
  assert.equal(request.options.headers['X-Sync-Token'], 'secret-token');
  assert.equal(request.options.body.get('video').size, video.size);
  assert.equal(request.options.body.get('video').type, video.type);
  assert.deepEqual(JSON.parse(request.options.body.get('metadata')), {
    id: 'post-1',
    caption: 'Bai viet',
    platforms: ['facebook'],
    selectedAccounts: { facebook: [{ id: 'page-1', credentials: { pageId: '1', accessToken: 'token' } }] },
    dueAt: '2026-08-17T01:30:00.000Z'
  });
  assert.equal(response.status, 'pending');
});

test('merges Worker publishing results into the local schedule list', () => {
  const merged = mergeCloudScheduleStatuses(
    [{ id: 'post-1', status: 'pending', caption: 'Local caption' }, { id: 'legacy', status: 'pending' }],
    [{ id: 'post-1', status: 'published', postIds: { youtube: [{ postId: 'yt-1' }] } }]
  );

  assert.deepEqual(merged[0], {
    id: 'post-1',
    status: 'published',
    caption: 'Local caption',
    postIds: { youtube: [{ postId: 'yt-1' }] }
  });
  assert.equal(merged[1].status, 'pending');
});

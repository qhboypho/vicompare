import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDueSchedules,
  executeScheduledPost
} from './scheduledPublishing.js';

test('collects only pending schedules whose due time has passed', () => {
  const schedules = [
    { id: 'due', status: 'pending', dueAt: '2026-08-17T01:00:00.000Z' },
    { id: 'future', status: 'pending', dueAt: '2026-08-17T03:00:00.000Z' },
    { id: 'done', status: 'published', dueAt: '2026-08-17T00:00:00.000Z' }
  ];
  assert.deepEqual(
    collectDueSchedules(schedules, Date.parse('2026-08-17T02:00:00.000Z')).map(item => item.id),
    ['due']
  );
});

test('publishes every selected account and records platform results', async () => {
  const calls = [];
  const schedule = {
    id: 'post-1',
    caption: 'Caption',
    platforms: ['facebook', 'youtube'],
    selectedAccounts: {
      facebook: [{ id: 'fb-1', label: 'Page 1', credentials: { pageId: '1', accessToken: 'fb-token' } }],
      youtube: [{ id: 'yt-1', label: 'Kenh 1', credentials: { refreshToken: 'refresh' } }]
    }
  };

  const result = await executeScheduledPost(schedule, {
    getVideo: async () => ({ size: 123, type: 'video/webm', body: 'stream' }),
    publishFacebook: async ({ account }) => {
      calls.push(`facebook:${account.id}`);
      return { postId: 'fb-post' };
    },
    publishYouTube: async ({ account }) => {
      calls.push(`youtube:${account.id}`);
      return { postId: 'yt-post' };
    }
  });

  assert.deepEqual(calls, ['facebook:fb-1', 'youtube:yt-1']);
  assert.equal(result.status, 'published');
  assert.deepEqual(result.postIds, {
    facebook: [{ accountId: 'fb-1', label: 'Page 1', postId: 'fb-post' }],
    youtube: [{ accountId: 'yt-1', label: 'Kenh 1', postId: 'yt-post' }]
  });
});

test('records the failing platform instead of leaving the schedule stuck as publishing', async () => {
  await assert.rejects(
    executeScheduledPost({
      id: 'post-2',
      caption: '',
      platforms: ['facebook'],
      selectedAccounts: { facebook: [{ id: 'fb-1', credentials: {} }] }
    }, {
      getVideo: async () => ({ size: 1, body: 'stream' }),
      publishFacebook: async () => { throw new Error('token expired'); }
    }),
    error => error.platform === 'facebook' && /token expired/.test(error.message)
  );
});

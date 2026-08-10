import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getScheduledStatusView,
  resolveScheduledAccounts,
  snapshotScheduledAccounts
} from './scheduledPublishing.js';

test('scheduled account snapshots retain credentials needed after reload', () => {
  const snapshots = snapshotScheduledAccounts([
    {
      id: 'facebook-1',
      label: 'Meo Thong Thai',
      credentials: { pageId: '123', accessToken: 'page-token' }
    }
  ]);

  assert.deepEqual(snapshots, [{
    id: 'facebook-1',
    label: 'Meo Thong Thai',
    credentials: { pageId: '123', accessToken: 'page-token' }
  }]);
});

test('scheduled accounts fall back to their credential snapshot when current account is unavailable', () => {
  const resolved = resolveScheduledAccounts([
    {
      id: 'facebook-old-id',
      label: 'Meo Thong Thai',
      credentials: { pageId: '123', accessToken: 'saved-token' }
    }
  ], []);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].credentials.pageId, '123');
  assert.equal(resolved[0].credentials.accessToken, 'saved-token');
});

test('scheduled accounts prefer refreshed current credentials while preserving snapshot fields', () => {
  const resolved = resolveScheduledAccounts([
    {
      id: 'facebook-1',
      label: 'Old label',
      credentials: { pageId: '123', accessToken: 'saved-token' }
    }
  ], [
    {
      id: 'facebook-1',
      label: 'Current label',
      credentials: { pageId: '123', accessToken: 'fresh-token' }
    }
  ]);

  assert.equal(resolved[0].label, 'Current label');
  assert.equal(resolved[0].credentials.accessToken, 'fresh-token');
});

test('failed scheduled posts expose the real error instead of appearing pending', () => {
  assert.deepEqual(getScheduledStatusView({ status: 'failed', error: 'Facebook token expired' }), {
    tone: 'error',
    label: 'Đăng lỗi',
    detail: 'Facebook token expired'
  });
});

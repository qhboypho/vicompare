import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveSocialAccountIds,
  getSelectedSocialAccountIds,
  normalizeSocialAccounts,
  removeSocialAccount,
  upsertSocialAccount
} from './socialAccounts.js';

test('normalizes legacy connected social credentials into account lists', () => {
  const accounts = normalizeSocialAccounts(null, {
    facebook: { connected: true, pageId: '123', accessToken: 'fb-token' },
    youtube: { connected: true, channelId: 'UCabc', refreshToken: 'yt-refresh' },
    tiktok: { connected: false, sessionId: 'unused', accessToken: 'tt-token' }
  });

  assert.equal(accounts.facebook.length, 1);
  assert.equal(accounts.facebook[0].credentials.pageId, '123');
  assert.equal(accounts.youtube.length, 1);
  assert.equal(accounts.youtube[0].credentials.channelId, 'UCabc');
  assert.equal(accounts.tiktok.length, 0);
});

test('upserts and removes social accounts without touching other platforms', () => {
  const first = normalizeSocialAccounts(null);
  const withFacebook = upsertSocialAccount(first, 'facebook', {
    credentials: { pageId: 'page-a', accessToken: 'token-a' }
  });
  const withYoutube = upsertSocialAccount(withFacebook, 'youtube', {
    credentials: { channelId: 'channel-a', refreshToken: 'refresh-a' }
  });

  assert.equal(withYoutube.facebook.length, 1);
  assert.equal(withYoutube.youtube.length, 1);

  const removed = removeSocialAccount(withYoutube, 'facebook', withYoutube.facebook[0].id);
  assert.equal(removed.facebook.length, 0);
  assert.equal(removed.youtube.length, 1);
});

test('active ids fall back to the first available account', () => {
  const accounts = normalizeSocialAccounts(null, {
    youtube: { connected: true, channelId: 'UCabc', refreshToken: 'yt-refresh' }
  });
  const activeIds = getActiveSocialAccountIds(accounts, { youtube: 'missing-id' });

  assert.equal(activeIds.youtube, accounts.youtube[0].id);
  assert.equal(activeIds.facebook, '');
});

test('labels use display names before ids', () => {
  const accounts = normalizeSocialAccounts({
    facebook: [{ id: 'fb-1', credentials: { pageId: '123', displayName: 'Meo Thong Thai' } }],
    youtube: [{ id: 'yt-1', credentials: { channelId: 'UC123', displayName: 'Nam Huu Hoc Shorts' } }],
    tiktok: [{ id: 'tt-1', credentials: { sessionId: 'namhuu', displayName: '@namhuuhoc.official' } }]
  });

  assert.equal(accounts.facebook[0].label, 'Meo Thong Thai');
  assert.equal(accounts.youtube[0].label, 'Nam Huu Hoc Shorts');
  assert.equal(accounts.tiktok[0].label, '@namhuuhoc.official');
});

test('selected ids support checkbox-style multiple accounts', () => {
  const accounts = normalizeSocialAccounts({
    facebook: [
      { id: 'fb-1', credentials: { pageId: '1' } },
      { id: 'fb-2', credentials: { pageId: '2' } }
    ],
    youtube: [{ id: 'yt-1', credentials: { channelId: 'UC1' } }]
  });
  const selected = getSelectedSocialAccountIds(accounts, {
    facebook: ['fb-2', 'missing'],
    youtube: []
  });

  assert.deepEqual(selected.facebook, ['fb-2']);
  assert.deepEqual(selected.youtube, ['yt-1']);
});

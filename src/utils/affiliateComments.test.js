import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAffiliateCommentMessages, postAffiliateComments } from './affiliateComments.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('builds one message per field with a link, skips empty links', () => {
  const messages = buildAffiliateCommentMessages([
    { description: '🛒 Mua ngay', link: 'https://a.com' },
    { description: '', link: 'https://b.com' },
    { description: 'Không link', link: '' },
    { description: '   ', link: '   ' }
  ]);
  assert.deepEqual(messages, [
    '🛒 Mua ngay\nhttps://a.com',
    'https://b.com'
  ]);
});

test('returns empty array for non-array or empty input', () => {
  assert.deepEqual(buildAffiliateCommentMessages(null), []);
  assert.deepEqual(buildAffiliateCommentMessages([]), []);
});

test('posts each message as a comment and counts results', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'comment-1' });
  };
  const result = await postAffiliateComments({
    postId: 'post-99',
    accessToken: 'token-abc',
    messages: ['msg1', 'msg2'],
    fetchImpl
  });
  assert.equal(result.posted, 2);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /post-99\/comments$/);
  assert.equal(JSON.parse(calls[0].options.body).message, 'msg1');
});

test('skips failed comment and continues with the rest', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return jsonResponse({ error: { message: 'boom' } }, 400);
    return jsonResponse({ id: 'ok' });
  };
  const result = await postAffiliateComments({
    postId: 'p',
    accessToken: 't',
    messages: ['a', 'b'],
    fetchImpl
  });
  assert.equal(result.posted, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
});

test('does nothing without postId, token, or messages', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({}); };
  const r1 = await postAffiliateComments({ postId: '', accessToken: 't', messages: ['a'], fetchImpl });
  const r2 = await postAffiliateComments({ postId: 'p', accessToken: 't', messages: [], fetchImpl });
  assert.equal(r1.posted, 0);
  assert.equal(r2.posted, 0);
  assert.equal(called, false);
});

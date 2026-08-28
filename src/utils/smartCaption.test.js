import test from 'node:test';
import assert from 'node:assert';

const {
  DEFAULT_CAPTION_HASHTAGS,
  ensurePublishHashtags,
  buildSmartCaptionFromScript,
  generateSmartCaption
} = await import('./smartCaption.js');

test('ensurePublishHashtags appends default hashtags and removes duplicates', () => {
  assert.equal(ensurePublishHashtags('Video hay quá'), `Video hay quá ${DEFAULT_CAPTION_HASHTAGS}`);
  assert.equal(ensurePublishHashtags('Video #shorts hay'), 'Video hay #shorts #reels');
  assert.equal(ensurePublishHashtags('Video #SHORTS #reel'), 'Video #shorts #reels');
  assert.equal(ensurePublishHashtags(''), `Video so sánh thú vị ${DEFAULT_CAPTION_HASHTAGS}`);
  assert.equal(ensurePublishHashtags(null), `Video so sánh thú vị ${DEFAULT_CAPTION_HASHTAGS}`);
});

test('buildSmartCaptionFromScript uses the first valid comparison pair', () => {
  const comparisons = [
    { leftTitle: '', rightTitle: 'Bỏ qua' },
    { leftTitle: 'Bắc Cực', rightTitle: 'Nam Cực' }
  ];
  const caption = buildSmartCaptionFromScript(comparisons, 'Bắc Cực');
  assert.match(caption, /🔥 Bắc Cực hay Nam Cực/);
  assert.match(caption, /#shorts #reels$/);
});

test('buildSmartCaptionFromScript falls back to headerTitle then default', () => {
  const captionByTitle = buildSmartCaptionFromScript([], 'Mèo vs Chó');
  assert.match(captionByTitle, /So sánh Mèo vs Chó/);
  assert.match(captionByTitle, /#shorts #reels$/);

  const captionDefault = buildSmartCaptionFromScript([], '');
  assert.match(captionDefault, /Video so sánh thú vị #shorts #reels/);
});

test('generateSmartCaption returns empty string without key or script', async () => {
  assert.equal(await generateSmartCaption({ apiKey: '', scriptText: 'kịch bản' }), '');
  assert.equal(await generateSmartCaption({ apiKey: 'key', scriptText: '' }), '');
});

test('generateSmartCaption calls gemini and appends hashtags', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Caption từ AI' }] } }]
    }), { status: 200 });
  };
  const caption = await generateSmartCaption({ provider: 'gemini', apiKey: 'key', scriptText: 'kịch bản', fetchImpl });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes('generativelanguage.googleapis.com'));
  assert.match(caption, /^Caption từ AI #shorts #reels$/);
});

test('generateSmartCaption uses openai-compatible endpoint for groq/openrouter/openai', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'AI caption' } }] }), { status: 200 });
  };
  for (const provider of ['groq', 'openrouter', 'openai', 'khong-ngo']) {
    const caption = await generateSmartCaption({ provider, apiKey: 'key', scriptText: 'kịch bản', fetchImpl });
    assert.match(caption, /^AI caption #shorts #reels$/, `provider ${provider}`);
  }
  assert.equal(urls.length, 4);
  assert.ok(urls[0].includes('api.groq.com'));
  assert.ok(urls[1].includes('openrouter.ai'));
  assert.ok(urls[2].includes('api.openai.com'));
  assert.ok(urls[3].includes('api.openai.com'), 'unknown provider falls back to openai');
});

test('generateSmartCaption returns empty string on provider error', async () => {
  const fetchImpl = async () => new Response('{"error":{"message":"boom"}}', { status: 500 });
  assert.equal(await generateSmartCaption({ provider: 'gemini', apiKey: 'key', scriptText: 'kịch bản', fetchImpl }), '');
  const throwingFetch = async () => { throw new Error('network'); };
  assert.equal(await generateSmartCaption({ provider: 'openai', apiKey: 'key', scriptText: 'kịch bản', fetchImpl: throwingFetch }), '');
});

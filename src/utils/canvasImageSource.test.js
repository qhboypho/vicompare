import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanvasImageCandidates } from './canvasImageSource.js';

test('routes remote comparison images through the canvas-safe proxy first', () => {
  assert.deepEqual(
    buildCanvasImageCandidates('https://images.example.com/item.jpg', 'https://vicompare.pages.dev'),
    [
      '/cors-proxy?url=https%3A%2F%2Fimages.example.com%2Fitem.jpg',
      'https://images.example.com/item.jpg'
    ]
  );
});

test('uses the production proxy while previewing the app locally', () => {
  assert.equal(
    buildCanvasImageCandidates('https://images.example.com/item.jpg', 'http://127.0.0.1:5173')[0],
    'https://vicompare.pages.dev/cors-proxy?url=https%3A%2F%2Fimages.example.com%2Fitem.jpg'
  );
});

test('leaves local, inline and already-proxied image sources untouched', () => {
  assert.deepEqual(buildCanvasImageCandidates('data:image/png;base64,abc'), ['data:image/png;base64,abc']);
  assert.deepEqual(buildCanvasImageCandidates('blob:https://vicompare.pages.dev/123'), ['blob:https://vicompare.pages.dev/123']);
  assert.deepEqual(buildCanvasImageCandidates('/mascot/default.png'), ['/mascot/default.png']);
  assert.deepEqual(
    buildCanvasImageCandidates('/cors-proxy?url=https%3A%2F%2Fimages.example.com%2Fitem.jpg'),
    ['/cors-proxy?url=https%3A%2F%2Fimages.example.com%2Fitem.jpg']
  );
});

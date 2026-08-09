import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMascotWhiteBackingImageData,
  processMascotTransparencyImageData
} from './canvasRenderer.js';

function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fill(x, y);
      const offset = (y * width + x) * 4;
      data.set([r, g, b, a], offset);
    }
  }
  return { data };
}

function alphaAt(image, width, x, y) {
  return image.data[(y * width + x) * 4 + 3];
}

test('green screen removal keeps white facial details and enclosed green accents', () => {
  const width = 11;
  const height = 11;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 7 && y >= 2 && y <= 8) return [225, 112, 24, 255];
    return [0, 238, 35, 255];
  });

  // White muzzle touching the subject edge and a cyan/green desk light inside it.
  image.data.set([250, 250, 248, 255], (5 * width + 3) * 4);
  image.data.set([20, 210, 174, 255], (7 * width + 5) * 4);

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 0, 0), 0, 'green border background should be removed');
  assert.ok(alphaAt(image, width, 3, 5) >= 245, 'white muzzle must remain opaque');
  assert.deepEqual(Array.from(image.data.slice((5 * width + 3) * 4, (5 * width + 3) * 4 + 3)), [250, 250, 248], 'subject pixels must not be color-corrected');
  assert.ok(alphaAt(image, width, 5, 7) >= 245, 'green/cyan subject detail must remain opaque');
});

test('white screen removal keeps white subject details enclosed by the silhouette', () => {
  const width = 11;
  const height = 11;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 2 && x <= 8 && y >= 2 && y <= 8) return [35, 45, 68, 255];
    return [248, 247, 244, 255];
  });

  image.data.set([255, 255, 255, 255], (5 * width + 5) * 4);

  processMascotTransparencyImageData(image, width, height, { mode: 'white', threshold: 230 });

  assert.equal(alphaAt(image, width, 0, 0), 0, 'white border background should be removed');
  assert.equal(alphaAt(image, width, 5, 5), 255, 'white detail inside the subject must remain opaque');
});

test('green screen removal follows compressed green shades without crossing into the subject', () => {
  const width = 13;
  const height = 9;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 4 && x <= 8 && y >= 2 && y <= 7) return [17, 31, 48, 255];
    const variation = (x * 7 + y * 5) % 24;
    return [8 + variation, 214 + variation, 25 + Math.floor(variation / 2), 255];
  });

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 1, 4), 0);
  assert.equal(alphaAt(image, width, 11, 5), 0);
  assert.equal(alphaAt(image, width, 6, 4), 255);
});

test('green subject details enclosed by the silhouette are never removed or despilled', () => {
  const width = 11;
  const height = 11;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 2 && x <= 8 && y >= 2 && y <= 8) return [210, 105, 28, 255];
    return [0, 238, 35, 255];
  });

  for (let y = 4; y <= 5; y += 1) {
    for (let x = 4; x <= 5; x += 1) {
      image.data.set([20, 205, 25, 255], (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  const detailOffset = (4 * width + 4) * 4;
  assert.equal(alphaAt(image, width, 4, 4), 255);
  assert.deepEqual(Array.from(image.data.slice(detailOffset, detailOffset + 3)), [20, 205, 25]);
});

test('keeps a larger green foreground detail even when it resembles the screen hue', () => {
  const width = 15;
  const height = 13;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 11 && y >= 2 && y <= 10) return [28, 34, 52, 255];
    return [0, 238, 35, 255];
  });

  // A 3x3 green logo/accent inside the subject. Component size alone must not
  // make it background because real mascots can contain green clothing or props.
  for (let y = 5; y <= 7; y += 1) {
    for (let x = 6; x <= 8; x += 1) {
      image.data.set([20, 205, 25, 255], (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 7, 6), 255, 'enclosed foreground accent must remain opaque');
});

test('border selection does not grow into a differently lit green desk detail', () => {
  const width = 13;
  const height = 9;
  const image = makeImage(width, height, () => [0, 238, 35, 255]);

  // This green reflection touches the image border but is much darker/bluer than the screen.
  for (let x = 0; x <= 3; x += 1) {
    image.data.set([12, 170, 70, 255], (4 * width + x) * 4);
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 1, 4), 255);
});

test('neutralizes green spill only on the foreground edge without cutting its alpha', () => {
  const width = 9;
  const height = 7;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 6 && y >= 2 && y <= 5) return [220, 112, 28, 255];
    return [0, 238, 35, 255];
  });

  // Anti-aliased foreground pixel contaminated by the green screen.
  image.data.set([72, 164, 45, 255], (3 * width + 3) * 4);
  const interiorOffset = (3 * width + 4) * 4;
  const interiorBefore = Array.from(image.data.slice(interiorOffset, interiorOffset + 4));

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  const edgeOffset = (3 * width + 3) * 4;
  assert.equal(alphaAt(image, width, 3, 3), 255, 'edge foreground must not be cut away');
  assert.ok(image.data[edgeOffset + 1] < 164, 'green spill should be neutralized at the matte edge');
  assert.deepEqual(
    Array.from(image.data.slice(interiorOffset, interiorOffset + 4)),
    interiorBefore,
    'interior subject color must remain untouched'
  );
});

test('border selection follows a smooth green-screen shadow behind the mascot', () => {
  const width = 13;
  const height = 7;
  const image = makeImage(width, height, (x, y) => {
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return [0, 238, 35, 255];
    const step = Math.min(x, width - 1 - x);
    return [0, 238 - step * 14, 35 + step * 7, 255];
  });

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 6, 3), 0, 'smooth shadow is still part of the outside screen');
});

test('removes a shadowed green pocket enclosed by the mascot without touching its dark outline', () => {
  const width = 13;
  const height = 11;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 9 && y >= 2 && y <= 8) return [24, 30, 46, 255];
    return [12, 221, 18, 255];
  });

  // A closed gap under a chair: background starts at the verified screen color,
  // then darkens naturally toward the center.
  for (let y = 4; y <= 6; y += 1) {
    for (let x = 5; x <= 7; x += 1) {
      const isCenter = x === 6 && y === 5;
      image.data.set(isCenter ? [8, 196, 9, 255] : [12, 221, 18, 255], (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 6, 5), 0, 'shadowed pocket should be removed');
  assert.equal(alphaAt(image, width, 4, 5), 255, 'the dark chair outline must remain intact');
});

test('removes a deeply shadowed enclosed screen pocket behind furniture', () => {
  const width = 15;
  const height = 13;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 11 && y >= 2 && y <= 10) return [25, 31, 47, 255];
    return [0, 238, 35, 255];
  });

  // The screen seen through a chair can be much darker than the outer border.
  // It remains chromatically green, but no longer fits a simple RGB radius.
  for (let y = 5; y <= 8; y += 1) {
    for (let x = 6; x <= 9; x += 1) {
      image.data.set([4, 92, 8, 255], (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 7, 6), 0, 'dark enclosed screen pocket should be transparent');
  assert.equal(alphaAt(image, width, 5, 6), 255, 'adjacent furniture must remain opaque');
});

test('removes a multi-tone enclosed green pocket with abrupt shadow changes', () => {
  const width = 15;
  const height = 13;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 11 && y >= 2 && y <= 10) return [24, 30, 46, 255];
    return [0, 238, 35, 255];
  });

  // Real chair gaps contain sharp alternating green tones. They are one screen
  // region chromatically even when adjacent RGB values differ substantially.
  for (let y = 5; y <= 8; y += 1) {
    for (let x = 6; x <= 9; x += 1) {
      const color = (x + y) % 2 === 0 ? [27, 151, 21, 255] : [2, 92, 6, 255];
      image.data.set(color, (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 7, 6), 0, 'all tones in the trapped screen pocket should be transparent');
  assert.equal(alphaAt(image, width, 5, 6), 255, 'the surrounding chair must remain opaque');
});

test('removes near-black green screen pixels trapped in a chair gap', () => {
  const width = 15;
  const height = 13;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 3 && x <= 11 && y >= 2 && y <= 10) return [24, 30, 46, 255];
    return [0, 238, 35, 255];
  });

  for (let y = 5; y <= 8; y += 1) {
    for (let x = 6; x <= 9; x += 1) {
      const color = (x + y) % 2 === 0 ? [19, 154, 26, 255] : [4, 44, 3, 255];
      image.data.set(color, (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 7, 6), 0, 'near-black screen shadow should remain part of the background region');
  assert.equal(alphaAt(image, width, 5, 6), 255, 'dark chair pixels around the gap must remain opaque');
});

test('removes a large vertical screen pocket while preserving surrounding furniture', () => {
  const width = 48;
  const height = 72;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 5 && x <= 42 && y >= 4 && y <= 67) return [24, 30, 46, 255];
    return [0, 238, 35, 255];
  });

  // Equivalent to the sizeable screen window trapped between a chair, leg and desk side.
  for (let y = 20; y <= 54; y += 1) {
    for (let x = 17; x <= 36; x += 1) {
      const color = (x + y) % 3 === 0 ? [22, 158, 24, 255] : [4, 48, 5, 255];
      image.data.set(color, (y * width + x) * 4);
    }
  }

  processMascotTransparencyImageData(image, width, height, { mode: 'green', threshold: 230 });

  assert.equal(alphaAt(image, width, 25, 35), 0, 'large vertical screen window should be transparent');
  assert.equal(alphaAt(image, width, 15, 35), 255, 'furniture bordering the screen window must remain opaque');
});

test('none mode leaves the original pixels untouched', () => {
  const width = 3;
  const height = 2;
  const image = makeImage(width, height, (x, y) => (
    x === 1 && y === 0 ? [255, 255, 255, 255] : [0, 240, 30, 255]
  ));
  const original = Array.from(image.data);

  processMascotTransparencyImageData(image, width, height, { mode: 'none' });

  assert.deepEqual(Array.from(image.data), original);
});

test('white backing repairs holes in white mascot details without filling dark chair or desk gaps', () => {
  const width = 9;
  const height = 7;
  const image = makeImage(width, height, (x, y) => {
    if (x >= 2 && x <= 4 && y >= 2 && y <= 4) return [248, 248, 246, 255];
    return [0, 0, 0, 0];
  });
  image.data.set([0, 0, 0, 0], (3 * width + 3) * 4);

  // Separate dark enclosed gap, equivalent to the space inside a chair/desk.
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 5; x <= 7; x += 1) {
      image.data.set([40, 50, 70, 255], (y * width + x) * 4);
    }
  }
  image.data.set([0, 0, 0, 0], (3 * width + 6) * 4);

  buildMascotWhiteBackingImageData(image, width, height);

  assert.equal(alphaAt(image, width, 3, 3), 255, 'enclosed hole should receive backing');
  assert.deepEqual(Array.from(image.data.slice((3 * width + 3) * 4, (3 * width + 3) * 4 + 4)), [255, 255, 255, 255]);
  assert.equal(alphaAt(image, width, 6, 3), 0, 'dark chair/desk gaps must stay transparent');
  assert.equal(alphaAt(image, width, 0, 0), 0, 'outer background must stay transparent');
});

// src/utils/canvasRenderer.js

/**
 * Draws rounded rectangles on a canvas context
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Helper to split text into lines that fit within a max width
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function getCanvasFontFamily(fontFamily, fallback = '"Be Vietnam Pro", Arial, sans-serif') {
  const value = typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily.trim() : fallback;
  return value.includes(',') ? value : `"${value.replace(/"/g, '\\"')}", Arial, sans-serif`;
}

const MASCOT_TRANSPARENCY_VERSION = 'v22';
const mascotTransparencyCache = new WeakMap();

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
    else hue = 60 * (((red - green) / delta) + 4);
  }
  if (hue < 0) hue += 360;

  return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
}

function hueDistance(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
}

function isGreenCandidate(r, g, b) {
  const hsv = rgbToHsv(r, g, b);
  return hsv.hue >= 72 && hsv.hue <= 168 && hsv.saturation >= 0.28 && g - Math.max(r, b) >= 8;
}

function isWhiteCandidate(r, g, b, threshold = 230) {
  const hsv = rgbToHsv(r, g, b);
  return hsv.value >= Math.max(0.72, (threshold - 18) / 255) && hsv.saturation <= 0.2;
}

function getBorderPositions(width, height) {
  const positions = [];
  const inset = Math.max(1, Math.min(5, Math.floor(Math.min(width, height) * 0.01)));
  for (let offset = 0; offset < inset; offset += 1) {
    for (let x = offset; x < width - offset; x += 1) {
      positions.push(offset * width + x, (height - 1 - offset) * width + x);
    }
    for (let y = offset + 1; y < height - 1 - offset; y += 1) {
      positions.push(y * width + offset, y * width + (width - 1 - offset));
    }
  }
  return positions;
}

function detectMascotBackgroundMode(data, borderPositions, requestedMode = 'auto', threshold = 230) {
  if (requestedMode === 'green' || requestedMode === 'white' || requestedMode === 'none') {
    return requestedMode;
  }

  let green = 0;
  let white = 0;
  let visible = 0;
  for (const pos of borderPositions) {
    const i = pos * 4;
    if (data[i + 3] < 10) continue;
    visible += 1;
    if (isGreenCandidate(data[i], data[i + 1], data[i + 2])) green += 1;
    if (isWhiteCandidate(data[i], data[i + 1], data[i + 2], threshold)) white += 1;
  }

  if (!visible) return 'none';
  if (white > green && white / visible >= 0.12) return 'white';
  if (green / visible >= 0.12) return 'green';
  return 'none';
}

function buildGreenBackgroundModel(data, borderPositions) {
  let hueX = 0;
  let hueY = 0;
  let saturation = 0;
  let value = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (const pos of borderPositions) {
    const i = pos * 4;
    if (data[i + 3] < 10 || !isGreenCandidate(data[i], data[i + 1], data[i + 2])) continue;
    const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    const radians = hsv.hue * Math.PI / 180;
    hueX += Math.cos(radians);
    hueY += Math.sin(radians);
    saturation += hsv.saturation;
    value += hsv.value;
    red += data[i];
    green += data[i + 1];
    blue += data[i + 2];
    count += 1;
  }

  if (!count) {
    return {
      hue: 120,
      saturation: 0.75,
      value: 0.75,
      red: 0,
      green: 220,
      blue: 25,
      colorRadius: 42
    };
  }
  let hue = Math.atan2(hueY / count, hueX / count) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  const model = {
    hue,
    saturation: saturation / count,
    value: value / count,
    red: red / count,
    green: green / count,
    blue: blue / count
  };
  let totalDistance = 0;
  let totalDistanceSquared = 0;
  for (const pos of borderPositions) {
    const i = pos * 4;
    if (data[i + 3] < 10 || !isGreenCandidate(data[i], data[i + 1], data[i + 2])) continue;
    const distance = Math.hypot(data[i] - model.red, data[i + 1] - model.green, data[i + 2] - model.blue);
    totalDistance += distance;
    totalDistanceSquared += distance * distance;
  }
  const averageDistance = totalDistance / count;
  const standardDeviation = Math.sqrt(Math.max(0, (totalDistanceSquared / count) - (averageDistance * averageDistance)));
  model.colorRadius = Math.min(78, Math.max(26, averageDistance + standardDeviation * 2.2 + 12));
  return model;
}

export function processMascotTransparencyImageData(imgData, width, height, options = {}) {
  if (!imgData || !imgData.data || !width || !height) return imgData;

  const threshold = Number.isFinite(options.threshold) ? options.threshold : 230;
  const borderPositions = getBorderPositions(width, height);
  const effectiveMode = detectMascotBackgroundMode(
    imgData.data,
    borderPositions,
    options.mode || 'auto',
    threshold
  );
  if (effectiveMode === 'none') return imgData;

  const data = imgData.data;
  const pixelCount = width * height;
  const removed = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;
  const greenModel = effectiveMode === 'green'
    ? buildGreenBackgroundModel(data, borderPositions)
    : null;

  const matchesBorderGreen = (pos) => {
    const i = pos * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isGreenCandidate(r, g, b)) return false;
    const hsv = rgbToHsv(r, g, b);
    const colorDistance = Math.hypot(r - greenModel.red, g - greenModel.green, b - greenModel.blue);
    return (
      hueDistance(hsv.hue, greenModel.hue) <= 30 &&
      hsv.saturation >= Math.max(0.24, greenModel.saturation * 0.32) &&
      hsv.value >= Math.max(0.18, greenModel.value * 0.2) &&
      colorDistance <= greenModel.colorRadius
    );
  };

  const isBackground = (pos, fromPos = null) => {
    const i = pos * 4;
    const a = data[i + 3];
    if (a < 12) return true;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (effectiveMode === 'white') return isWhiteCandidate(r, g, b, threshold);

    const matchesBorderColor = matchesBorderGreen(pos);
    if (matchesBorderColor || fromPos === null) return matchesBorderColor;

    const hsv = rgbToHsv(r, g, b);
    const fromIndex = fromPos * 4;
    const fromHsv = rgbToHsv(data[fromIndex], data[fromIndex + 1], data[fromIndex + 2]);
    const localColorDistance = Math.hypot(r - data[fromIndex], g - data[fromIndex + 1], b - data[fromIndex + 2]);
    return (
      hueDistance(hsv.hue, fromHsv.hue) <= 12 &&
      localColorDistance <= 34 &&
      hsv.saturation >= 0.24 &&
      g - Math.max(r, b) >= 8
    );
  };

  const isPotentialEnclosedGreenBackground = (pos) => {
    const i = pos * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isGreenCandidate(r, g, b)) return false;
    const hsv = rgbToHsv(r, g, b);
    const colorDistance = Math.hypot(r - greenModel.red, g - greenModel.green, b - greenModel.blue);
    return (
      hueDistance(hsv.hue, greenModel.hue) <= 34 &&
      hsv.saturation >= Math.max(0.4, greenModel.saturation * 0.42) &&
      hsv.value >= 0.04 &&
      colorDistance <= Math.max(230, greenModel.colorRadius * 7)
    );
  };

  const enqueue = (pos, fromPos = null) => {
    if (pos < 0 || pos >= pixelCount) return;
    if (visited[pos] || !isBackground(pos, fromPos)) return;
    visited[pos] = 1;
    removed[pos] = 1;
    queue[queueTail] = pos;
    queueTail += 1;
  };

  for (const pos of borderPositions) enqueue(pos);

  while (queueHead < queueTail) {
    const pos = queue[queueHead];
    queueHead += 1;
    const x = pos % width;
    const y = Math.floor(pos / width);
    if (x + 1 < width) enqueue(pos + 1, pos);
    if (x > 0) enqueue(pos - 1, pos);
    if (y + 1 < height) enqueue(pos + width, pos);
    if (y > 0) enqueue(pos - width, pos);
  }

  // Remove enclosed pockets only when their pixels still match the exact border-screen model.
  // A greener/darker object detail is deliberately excluded from this pass.
  if (effectiveMode === 'green') {
    const componentVisited = new Uint8Array(pixelCount);
    const componentQueue = new Int32Array(pixelCount);
    for (let start = 0; start < pixelCount; start += 1) {
      if (removed[start] || componentVisited[start] || !isPotentialEnclosedGreenBackground(start)) continue;
      let head = 0;
      let tail = 0;
      componentQueue[tail++] = start;
      componentVisited[start] = 1;
      while (head < tail) {
        const pos = componentQueue[head++];
        const x = pos % width;
        const y = Math.floor(pos / width);
        const neighbors = [
          x + 1 < width ? pos + 1 : -1,
          x > 0 ? pos - 1 : -1,
          y + 1 < height ? pos + width : -1,
          y > 0 ? pos - width : -1
        ];
        for (const next of neighbors) {
          if (
            next < 0 ||
            removed[next] ||
            componentVisited[next] ||
            !isPotentialEnclosedGreenBackground(next)
          ) continue;
          componentVisited[next] = 1;
          componentQueue[tail++] = next;
        }
      }
      let screenLikePixels = 0;
      let shadowPixels = 0;
      for (let index = 0; index < tail; index += 1) {
        const pos = componentQueue[index];
        const i = pos * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const hsv = rgbToHsv(r, g, b);
        const modelDistance = Math.hypot(
          r - greenModel.red,
          g - greenModel.green,
          b - greenModel.blue
        );
        if (
          modelDistance <= greenModel.colorRadius * 1.18 &&
          hsv.value >= greenModel.value * 0.62
        ) {
          screenLikePixels += 1;
        }
        if (
          hueDistance(hsv.hue, greenModel.hue) <= 24 &&
          hsv.saturation >= Math.max(0.55, greenModel.saturation * 0.58) &&
          hsv.value <= greenModel.value * 0.78
        ) {
          shadowPixels += 1;
        }
      }

      const screenLikeRatio = screenLikePixels / tail;
      const shadowRatio = shadowPixels / tail;
      // Trapped screen areas either retain a strong sample of the calibrated
      // border color or form a consistently darker shadow of that same chroma.
      // Component size alone is never evidence: a mascot may contain green props.
      if (tail >= 5 && (screenLikeRatio >= 0.35 || shadowRatio >= 0.68)) {
        for (let index = 0; index < tail; index += 1) removed[componentQueue[index]] = 1;
      }
    }

    // A narrow chair/desk gap can mix near-black and bright screen pixels into
    // a small island that a broader foreground-colored component protects.
    // Clean only compact, two-dimensional islands with a large screen-shadow
    // luminance range; uniform green props and one-pixel neon trims are kept.
    const residualVisited = new Uint8Array(pixelCount);
    const residualQueue = new Int32Array(pixelCount);
    for (let start = 0; start < pixelCount; start += 1) {
      if (removed[start] || residualVisited[start]) continue;
      const startIndex = start * 4;
      if (!isGreenCandidate(data[startIndex], data[startIndex + 1], data[startIndex + 2])) continue;

      let head = 0;
      let tail = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let minValue = 1;
      let maxValue = 0;
      let valueSum = 0;
      let screenHuePixels = 0;
      residualQueue[tail++] = start;
      residualVisited[start] = 1;

      while (head < tail) {
        const pos = residualQueue[head++];
        const x = pos % width;
        const y = Math.floor(pos / width);
        const i = pos * 4;
        const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        minValue = Math.min(minValue, hsv.value);
        maxValue = Math.max(maxValue, hsv.value);
        valueSum += hsv.value;
        if (hueDistance(hsv.hue, greenModel.hue) <= 30) screenHuePixels += 1;

        const neighbors = [
          x + 1 < width ? pos + 1 : -1,
          x > 0 ? pos - 1 : -1,
          y + 1 < height ? pos + width : -1,
          y > 0 ? pos - width : -1
        ];
        for (const next of neighbors) {
          if (next < 0 || removed[next] || residualVisited[next]) continue;
          const nextIndex = next * 4;
          if (!isGreenCandidate(data[nextIndex], data[nextIndex + 1], data[nextIndex + 2])) continue;
          residualVisited[next] = 1;
          residualQueue[tail++] = next;
        }
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const componentAspect = componentWidth / componentHeight;
      const averageValue = valueSum / tail;
      const screenHueRatio = screenHuePixels / tail;
      const isTrappedScreenShadow = (
        tail >= 5 &&
        tail <= 5000 &&
        componentWidth >= 2 &&
        componentHeight >= 2 &&
        componentAspect >= 0.25 &&
        componentAspect <= 3.5 &&
        screenHueRatio >= 0.8 &&
        averageValue <= greenModel.value * 0.72 &&
        maxValue - minValue >= 0.25
      );
      if (isTrappedScreenShadow) {
        for (let index = 0; index < tail; index += 1) removed[residualQueue[index]] = 1;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pos = y * width + x;
      const i = pos * 4;

      if (removed[pos]) {
        data[i + 3] = 0;
      } else if (effectiveMode === 'green') {
        let touchesRemovedBackground = false;
        for (let offsetY = -2; offsetY <= 2 && !touchesRemovedBackground; offsetY += 1) {
          const neighborY = y + offsetY;
          if (neighborY < 0 || neighborY >= height) continue;
          for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const neighborX = x + offsetX;
            if (neighborX < 0 || neighborX >= width) continue;
            if (removed[neighborY * width + neighborX]) {
              touchesRemovedBackground = true;
              break;
            }
          }
        }

        if (touchesRemovedBackground) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const hsv = rgbToHsv(r, g, b);
          const neutralGreen = Math.max(r, b) + 8;
          const greenExcess = g - neutralGreen;
          if (
            greenExcess > 0 &&
            hsv.saturation >= 0.28 &&
            hueDistance(hsv.hue, greenModel.hue) <= 62
          ) {
            const spillStrength = Math.min(1, greenExcess / 72);
            data[i + 1] = Math.round(g + (neutralGreen - g) * spillStrength * 0.9);
          }
        }
      }
    }
  }

  return imgData;
}

/**
 * Helper to capitalize the first letter of a string
 */
function capitalizeFirstLetter(str) {
  if (!str) return '';
  const trimmed = str.trim();
  if (trimmed.length === 0) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Automatically processes mascot image to remove white/off-white or green background
 * Caches the transparent canvas on img._transparentCanvas to avoid re-processing every frame
 */
export function getTransparentMascotCanvas(img, mode = 'green', threshold = 230) {
  if (!img || !img.width || !img.height) return img;
  if (mode === 'none') return img;

  const cacheKey = `${MASCOT_TRANSPARENCY_VERSION}_${mode}_${threshold}_${img.currentSrc || img.src || ''}_${img.width}x${img.height}`;
  const cached = mascotTransparencyCache.get(img);
  if (cached?.key === cacheKey) {
    return cached.canvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  try {
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    processMascotTransparencyImageData(imgData, canvas.width, canvas.height, { mode, threshold });
    ctx.putImageData(imgData, 0, 0);
    mascotTransparencyCache.set(img, { key: cacheKey, canvas });
    return canvas;
  } catch (e) {
    console.warn('Mascot transparency processing failed:', e);
    return img;
  }
}

/**
 * Creates a solid white silhouette backing inside the mascot body
 * Fills any semi-transparent holes in shirt, beard, collar, etc. caused by external image cutters
 */
export function buildMascotWhiteBackingImageData(imgData, width, height) {
  if (!imgData?.data || !width || !height) return imgData;

  const data = imgData.data;
  const pixelCount = width * height;
  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueue = (pos) => {
    if (pos < 0 || pos >= pixelCount || exterior[pos] || data[pos * 4 + 3] >= 220) return;
    exterior[pos] = 1;
    queue[tail++] = pos;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pos = queue[head++];
    const x = pos % width;
    const y = Math.floor(pos / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) enqueue(ny * width + nx);
      }
    }
  }

  const inspected = exterior.slice();
  const fillWhite = new Uint8Array(pixelCount);
  const componentQueue = new Int32Array(pixelCount);

  for (let start = 0; start < pixelCount; start += 1) {
    if (inspected[start] || data[start * 4 + 3] >= 220) continue;

    let componentHead = 0;
    let componentTail = 0;
    let boundaryPixels = 0;
    let lightBoundaryPixels = 0;
    componentQueue[componentTail++] = start;
    inspected[start] = 1;

    while (componentHead < componentTail) {
      const pos = componentQueue[componentHead++];
      const x = pos % width;
      const y = Math.floor(pos / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          const nextIndex = next * 4;
          if (data[nextIndex + 3] < 220) {
            if (!inspected[next]) {
              inspected[next] = 1;
              componentQueue[componentTail++] = next;
            }
          } else {
            boundaryPixels += 1;
            const minChannel = Math.min(data[nextIndex], data[nextIndex + 1], data[nextIndex + 2]);
            if (minChannel >= 165) lightBoundaryPixels += 1;
          }
        }
      }
    }

    if (boundaryPixels > 0 && lightBoundaryPixels / boundaryPixels >= 0.58) {
      for (let index = 0; index < componentTail; index += 1) fillWhite[componentQueue[index]] = 1;
    }
  }

  for (let pos = 0; pos < pixelCount; pos += 1) {
    const i = pos * 4;
    if (fillWhite[pos]) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  return imgData;
}

export function getMascotWithWhiteBacking(mascotCanvas) {
  if (!mascotCanvas || !mascotCanvas.width || !mascotCanvas.height) return mascotCanvas;

  const cacheKey = '_white_backed_v5';
  if (mascotCanvas[cacheKey]) {
    return mascotCanvas[cacheKey];
  }

  const w = mascotCanvas.width;
  const h = mascotCanvas.height;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = w;
  resultCanvas.height = h;
  const ctx = resultCanvas.getContext('2d');

  try {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d');
    
    maskCtx.drawImage(mascotCanvas, 0, 0);
    const imgData = maskCtx.getImageData(0, 0, w, h);
    buildMascotWhiteBackingImageData(imgData, w, h);
    maskCtx.putImageData(imgData, 0, 0);

    // 3. Render solid white body backing first
    ctx.drawImage(maskCanvas, 0, 0);

    // 4. Render original mascot image on top
    ctx.drawImage(mascotCanvas, 0, 0);

    mascotCanvas[cacheKey] = resultCanvas;
    return resultCanvas;
  } catch (e) {
    console.warn('Mascot flood-fill white backing failed:', e);
    return mascotCanvas;
  }
}

/**
 * Vẽ nút "kêu gọi Follow" cho cảnh cuối video (outro CTA).
 * Gồm: (tuỳ chọn) tên kênh phía trên, nút bo tròn màu đỏ với icon chuông +
 * nhãn chữ tuỳ chỉnh, và hiệu ứng nhấp nháy/phóng nhẹ để thu hút bấm theo dõi.
 */
function drawFollowCta(ctx, w, currentTime, label, channelName) {
  const centerX = w / 2;
  const pulse = 1 + 0.05 * Math.sin(currentTime * Math.PI * 2.2);
  const glowPulse = 0.5 + 0.5 * Math.sin(currentTime * Math.PI * 2.2);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Tên kênh phía trên nút (nếu có)
  if (channelName) {
    ctx.font = '800 34px "Be Vietnam Pro", Arial, sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(channelName, centerX, 470);
    ctx.fillStyle = '#111827';
    ctx.fillText(channelName, centerX, 470);
  }

  const btnW = 360 * pulse;
  const btnH = 96 * pulse;
  const btnY = 560 - btnH / 2;
  const btnX = centerX - btnW / 2;
  const radius = btnH / 2;

  // Quầng sáng nhấp nháy quanh nút
  ctx.save();
  ctx.shadowColor = `rgba(255, 0, 0, ${0.35 + 0.4 * glowPulse})`;
  ctx.shadowBlur = 40 + 25 * glowPulse;
  drawRoundedRect(ctx, btnX, btnY, btnW, btnH, radius);
  ctx.fillStyle = '#FF0000';
  ctx.fill();
  ctx.restore();

  // Nút đỏ (YouTube subscribe style)
  drawRoundedRect(ctx, btnX, btnY, btnW, btnH, radius);
  const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
  btnGrad.addColorStop(0, '#FF3B30');
  btnGrad.addColorStop(1, '#CC0000');
  ctx.fillStyle = btnGrad;
  ctx.fill();

  // Icon chuông (bell) bên trái nhãn, rung nhẹ theo nhịp
  const bellCx = btnX + btnH * 0.62;
  const bellCy = btnY + btnH / 2;
  const bellScale = (btnH / 96);
  const bellTilt = 0.18 * Math.sin(currentTime * Math.PI * 6);
  ctx.save();
  ctx.translate(bellCx, bellCy);
  ctx.rotate(bellTilt);
  ctx.scale(bellScale, bellScale);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.bezierCurveTo(16, -20, 18, -4, 18, 8);
  ctx.lineTo(22, 16);
  ctx.lineTo(-22, 16);
  ctx.lineTo(-18, 8);
  ctx.bezierCurveTo(-18, -4, -16, -20, 0, -20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -24, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 22, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Nhãn chữ (ĐĂNG KÝ / THEO DÕI / ...)
  const labelText = String(label || 'ĐĂNG KÝ').toUpperCase();
  ctx.font = `900 ${Math.round(40 * (btnH / 96))}px "Be Vietnam Pro", Arial, sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(labelText, bellCx + btnW * 0.16, btnY + btnH / 2 + 2);

  // Emoji ngón tay chỉ nhấp nháy dưới nút (gợi ý bấm)
  ctx.font = `${Math.round(56 * pulse)}px sans-serif`;
  ctx.globalAlpha = 0.6 + 0.4 * glowPulse;
  ctx.fillText('👆', centerX, btnY + btnH + 60);
  ctx.globalAlpha = 1;

  ctx.restore();
}

/**
 * Main draw frame function
 * @param {HTMLCanvasElement} canvas
 * @param {Object} state - Current configuration & state
 * @param {number} currentTime - Current time in seconds
 * @param {Object} loadedImages - Pre-loaded Image elements
 */
export function drawFrame(canvas, state, currentTime, loadedImages = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width; // 720
  const h = canvas.height; // 1280

  // 1. Start every frame from a neutral drawing state. A leaked alpha, clip, filter or
  // composite mode otherwise leaves pixels from the previous mascot frame visible.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);

  // 2. Draw Background
  const bgColorStr = state.bgColor || '#FAF6F0';
  const comparisonPanelBackgroundColor = '#F8F4EC';
  if (bgColorStr.startsWith('linear-gradient')) {
    try {
      const colors = bgColorStr.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g);
      if (colors && colors.length >= 2) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        colors.forEach((col, idx) => {
          grad.addColorStop(idx / (colors.length - 1), col);
        });
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#FAF6F0';
      }
    } catch (e) {
      ctx.fillStyle = '#FAF6F0';
    }
  } else {
    ctx.fillStyle = bgColorStr;
  }
  ctx.fillRect(0, 0, w, h);

  // 2. Draw Top Header & Channel Watermark moved to the end of the drawing cycle to avoid overlaps

  // 3. Determine Active Comparison Round
  // Find current timeline block index
  const activeBlockIndex = state.timelineBlocks 
    ? state.timelineBlocks.findIndex(b => currentTime >= b.start && currentTime <= b.end)
    : -1;
  const activeIdx = activeBlockIndex !== -1 ? activeBlockIndex : 0;

  // Find active comparison based on activeIdx
  let activeComp = {
    leftTitle: capitalizeFirstLetter(state.leftTitle || 'Nghị định'),
    rightTitle: capitalizeFirstLetter(state.rightTitle || 'Thông tư'),
    leftImageUrl: state.leftImageUrl,
    rightImageUrl: state.rightImageUrl,
    leftColor: '#FF9800',
    rightColor: '#FF9800',
    leftZoom: 100,
    rightZoom: 100
  };

  if (state.comparisons && state.comparisons.length > 0) {
    const sortedComps = [...state.comparisons].sort((a, b) => a.startIndex - b.startIndex);
    let foundComp = null;
    for (let i = sortedComps.length - 1; i >= 0; i--) {
      if (sortedComps[i].startIndex <= activeIdx) {
        foundComp = sortedComps[i];
        break;
      }
    }
    if (foundComp) {
      activeComp = {
        leftTitle: capitalizeFirstLetter(foundComp.leftTitle || 'Trái'),
        rightTitle: capitalizeFirstLetter(foundComp.rightTitle || 'Phải'),
        leftImageUrl: foundComp.leftImageUrl,
        rightImageUrl: foundComp.rightImageUrl,
        leftColor: foundComp.leftColor || '#FF9800',
        rightColor: foundComp.rightColor || '#10B981',
        leftZoom: foundComp.leftZoom || 100,
        rightZoom: foundComp.rightZoom || 100
      };
    }
  }

  // 4. Draw Comparison Section (Labels & Images) with smooth transition animation
  const panelY = 230;
  const panelW = state.imageFrameWidth || 290;
  const panelH = state.imageFrameHeight || 390;
  
  // Set a clean 30px gap in the middle and center both panels symmetrically on the 720px canvas
  const midGap = 30;
  const leftX = 360 - midGap / 2 - panelW;
  const rightX = 360 + midGap / 2;

  // Smart fallback keyword matching for highlight when block highlight is missing or 'none'
  const getSmartHighlight = (block) => {
    if (!block) return 'none';
    if (block.highlight && block.highlight !== 'none') return block.highlight;
    
    const textLower = (block.text || '').toLowerCase();
    if (!textLower) return 'none';

    const getCleanWords = (str) => (str || '').toLowerCase().replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, '').split(/\s+/).filter(w => w.length > 1);

    const leftWords = getCleanWords(activeComp.leftTitle);
    const rightWords = getCleanWords(activeComp.rightTitle);

    const leftDistinct = leftWords.filter(w => !rightWords.includes(w));
    const rightDistinct = rightWords.filter(w => !leftWords.includes(w));

    const matchesLeft = leftDistinct.some(w => textLower.includes(w)) || (leftWords.length > 0 && textLower.includes(activeComp.leftTitle.toLowerCase()));
    const matchesRight = rightDistinct.some(w => textLower.includes(w)) || (rightWords.length > 0 && textLower.includes(activeComp.rightTitle.toLowerCase()));

    if (matchesLeft && !matchesRight) return 'left';
    if (matchesRight && !matchesLeft) return 'right';
    return 'none';
  };

  // Determine current and previous highlights for smooth interpolation
  let t = 1;
  let prevHighlight = 'none';
  let currHighlight = 'none';
  const currentBlock = state.timelineBlocks && activeBlockIndex !== -1 
    ? state.timelineBlocks[activeBlockIndex] 
    : null;
  const prevBlock = state.timelineBlocks && activeBlockIndex > 0 
    ? state.timelineBlocks[activeBlockIndex - 1] 
    : null;

  if (currentBlock) {
    currHighlight = getSmartHighlight(currentBlock);
    const timeInBlock = currentTime - currentBlock.start;
    const transitionDuration = 0.3; // 300ms transition
    if (timeInBlock < transitionDuration) {
      t = timeInBlock / transitionDuration;
      // Ease-in-out curve
      t = t * t * (3 - 2 * t);
      prevHighlight = prevBlock ? getSmartHighlight(prevBlock) : 'none';
    } else {
      t = 1;
      prevHighlight = currHighlight;
    }
  }

  // Helper to determine layout values (scale, opacity, blur) for left/right panels
  const getLayoutValues = (panelSide, highlightState) => {
    if (highlightState === 'none') {
      // Mặc định ban đầu: cả hai bên đều nhỏ đi một chút (0.93)
      return { scale: 0.93, opacity: 1.0, blur: 0 };
    }
    if (highlightState === panelSide) {
      // Chỉ đến cái nào: zoom to nhẹ cái đó lên (1.0)
      return { scale: 1.0, opacity: 1.0, blur: 0 };
    } else {
      // Cái còn lại: zoom bé đi một chút (0.86) và làm mờ hơn
      return { scale: 0.86, opacity: 0.55, blur: 4 };
    }
  };

  const leftStart = getLayoutValues('left', prevHighlight);
  const leftEnd = getLayoutValues('left', currHighlight);
  const leftScale = leftStart.scale + (leftEnd.scale - leftStart.scale) * t;
  const leftOpacity = leftStart.opacity + (leftEnd.opacity - leftStart.opacity) * t;
  const leftBlur = leftStart.blur + (leftEnd.blur - leftStart.blur) * t;

  const rightStart = getLayoutValues('right', prevHighlight);
  const rightEnd = getLayoutValues('right', currHighlight);
  const rightScale = rightStart.scale + (rightEnd.scale - rightStart.scale) * t;
  const rightOpacity = rightStart.opacity + (rightEnd.opacity - rightStart.opacity) * t;
  const rightBlur = rightStart.blur + (rightEnd.blur - rightStart.blur) * t;

  const getPanelRect = (x, y, w, h, scale) => {
    const newW = w * scale;
    const newH = h * scale;
    const newX = x + (w - newW) / 2;
    const newY = y + (h - newH) / 2;
    return { x: newX, y: newY, w: newW, h: newH };
  };

  const isLeftActive = currHighlight === 'left';
  const isRightActive = currHighlight === 'right';
  const leftGlowAlpha = currHighlight === 'left'
    ? (prevHighlight === 'left' ? 1 : t)
    : (prevHighlight === 'left' ? 1 - t : 0);
  const rightGlowAlpha = currHighlight === 'right'
    ? (prevHighlight === 'right' ? 1 : t)
    : (prevHighlight === 'right' ? 1 - t : 0);
  const glowOpacity = Math.max(0, Math.min(100, Number(state.imageGlowOpacity ?? 100))) / 100;

  const leftLayout = {
    ...getPanelRect(leftX, panelY, panelW, panelH, leftScale),
    scale: leftScale,
    opacity: leftOpacity,
    blur: leftBlur,
    isActive: isLeftActive
  };

  const rightLayout = {
    ...getPanelRect(rightX, panelY, panelW, panelH, rightScale),
    scale: rightScale,
    opacity: rightOpacity,
    blur: rightBlur,
    isActive: isRightActive
  };

  // Draw Labels dynamically matching their respective panel zoom with auto-fitting font size to prevent overlapping
  const baseFontSize = state.titleFontSize || 36;
  const titleFontFamily = getCanvasFontFamily(state.titleFontFamily);
  const outlineColor = state.titleOutlineColor || '#000000';
  const outlineW = state.titleOutlineWidth !== undefined ? state.titleOutlineWidth : 6;

  const drawFittedTitle = (titleText, centerX, centerY, scale, fillCol, opacityVal) => {
    ctx.save();
    const baseSize = Math.round(baseFontSize * scale);
    const maxW = panelW * 1.02;
    
    ctx.font = `900 ${baseSize}px ${titleFontFamily}`;
    let actualFontSize = baseSize;
    const measuredW = ctx.measureText(titleText).width;
    if (measuredW > maxW && measuredW > 0) {
      actualFontSize = Math.max(16, Math.floor(baseSize * (maxW / measuredW)));
    }

    ctx.font = `900 ${actualFontSize}px ${titleFontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = Math.round(outlineW * scale);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.fillStyle = fillCol;
    ctx.globalAlpha = opacityVal;
    ctx.strokeText(titleText, centerX, centerY);
    ctx.fillText(titleText, centerX, centerY);
    ctx.restore();
  };

  // Left Label
  drawFittedTitle(activeComp.leftTitle, leftLayout.x + leftLayout.w / 2, leftLayout.y - 25, leftScale, activeComp.leftColor || '#FF9800', leftOpacity);

  // Right Label
  drawFittedTitle(activeComp.rightTitle, rightLayout.x + rightLayout.w / 2, rightLayout.y - 25, rightScale, activeComp.rightColor || '#10B981', rightOpacity);

  const drawPanelGlow = (layout, color, alpha) => {
    const effectiveAlpha = Math.max(0, Math.min(1, alpha * glowOpacity));
    if (!layout || effectiveAlpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = effectiveAlpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 34;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    drawRoundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 16);
    ctx.fillStyle = comparisonPanelBackgroundColor;
    ctx.fill();
    ctx.shadowBlur = 16;
    ctx.globalAlpha = Math.min(0.75, effectiveAlpha * 0.75);
    drawRoundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 16);
    ctx.fill();
    ctx.restore();
  };

  // Helper to draw a panel image
  const drawPanelImage = (imgUrl, x, y, width, height, layout, side) => {
    ctx.save();
    
    // Apply blur filter if inactive
    if (layout.blur > 0) {
      ctx.filter = `blur(${layout.blur}px)`;
    }

    // Draw rounded clipping mask (acts as overflow: hidden)
    drawRoundedRect(ctx, x, y, width, height, 16);
    ctx.clip();
    ctx.fillStyle = comparisonPanelBackgroundColor;
    ctx.fillRect(x - 2, y - 2, width + 4, height + 4);

    const hasImage = Boolean(imgUrl && loadedImages[imgUrl]);

    if (hasImage) {
      const img = loadedImages[imgUrl];

      const naturalW = img.naturalWidth || img.videoWidth || img.width || 1;
      const naturalH = img.naturalHeight || img.videoHeight || img.height || 1;
      const edgeBleed = Math.max(4, Math.ceil(Math.max(width, height) * 0.025));
      const destX = x - edgeBleed;
      const destY = y - edgeBleed;
      const destW = width + edgeBleed * 2;
      const destH = height + edgeBleed * 2;
      const targetRatio = destW / destH;
      const imgRatio = naturalW / naturalH;
      const sideZoom = side === 'left' ? (activeComp.leftZoom || 100) : (activeComp.rightZoom || 100);
      const zoomFactor = Math.max(1, (state.globalImageZoom ?? 100) / 100) * Math.max(1, sideZoom / 100);

      let sourceW = naturalW;
      let sourceH = naturalH;
      if (imgRatio > targetRatio) {
        sourceW = naturalH * targetRatio;
      } else {
        sourceH = naturalW / targetRatio;
      }

      sourceW = Math.max(1, Math.min(naturalW, sourceW / zoomFactor));
      sourceH = Math.max(1, Math.min(naturalH, sourceH / zoomFactor));

      const sourceX = Math.max(0, (naturalW - sourceW) / 2);
      const sourceY = Math.max(0, (naturalH - sourceH) / 2);

      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH);
    } else {
      // Placeholder if no image
      ctx.font = 'italic 18px sans-serif';
      ctx.fillStyle = 'rgba(31, 41, 55, 0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa tải ảnh', x + width / 2, y + height / 2);
    }

    // Reset filter for overlays
    ctx.filter = 'none';

    // Apply dimmer overlay for inactive panel
    if (layout.opacity < 1.0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * (1 - layout.opacity / 2)})`;
      ctx.fillRect(x - 2, y - 2, width + 4, height + 4);
    }

    ctx.restore();
  };

  if (state.isOutro) {
    // Cảnh cuối video (CTA): không vẽ panel so sánh & VS. Vẽ nút Follow phía
    // trên mascot với hiệu ứng nhấp nháy để kêu gọi theo dõi.
    drawFollowCta(ctx, w, currentTime, state.followLabel || 'ĐĂNG KÝ', state.headerTitle || '');
  } else if (isLeftActive) {
    drawPanelImage(activeComp.rightImageUrl, rightLayout.x, rightLayout.y, rightLayout.w, rightLayout.h, rightLayout, 'right');
    drawPanelGlow(leftLayout, activeComp.leftColor || '#FF9800', leftGlowAlpha);
    drawPanelImage(activeComp.leftImageUrl, leftLayout.x, leftLayout.y, leftLayout.w, leftLayout.h, leftLayout, 'left');
  } else if (isRightActive) {
    drawPanelImage(activeComp.leftImageUrl, leftLayout.x, leftLayout.y, leftLayout.w, leftLayout.h, leftLayout, 'left');
    drawPanelGlow(rightLayout, activeComp.rightColor || '#10B981', rightGlowAlpha);
    drawPanelImage(activeComp.rightImageUrl, rightLayout.x, rightLayout.y, rightLayout.w, rightLayout.h, rightLayout, 'right');
  } else {
    drawPanelGlow(leftLayout, activeComp.leftColor || '#FF9800', leftGlowAlpha);
    drawPanelGlow(rightLayout, activeComp.rightColor || '#10B981', rightGlowAlpha);
    drawPanelImage(activeComp.leftImageUrl, leftLayout.x, leftLayout.y, leftLayout.w, leftLayout.h, leftLayout, 'left');
    drawPanelImage(activeComp.rightImageUrl, rightLayout.x, rightLayout.y, rightLayout.w, rightLayout.h, rightLayout, 'right');
  }

  // Draw central VS badge after panels so it stays visually centered above them.
  if (!state.isOutro) {
  ctx.save();
  const vsX = 360;
  const vsY = panelY + panelH / 2;
  const vsPulse = 1.0 + 0.035 * Math.sin(currentTime * Math.PI * 2.5);
  const vsRadius = 38 * vsPulse;

  ctx.shadowColor = '#FDE047';
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(vsX, vsY, vsRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#0B0F19';
  ctx.fill();

  const vsGrad = ctx.createLinearGradient(vsX - vsRadius, vsY - vsRadius, vsX + vsRadius, vsY + vsRadius);
  vsGrad.addColorStop(0, '#FDE047');
  vsGrad.addColorStop(0.5, '#EAB308');
  vsGrad.addColorStop(1, '#CA8A04');

  ctx.lineWidth = 5;
  ctx.strokeStyle = vsGrad;
  ctx.stroke();

  ctx.font = `900 ${Math.round(34 * vsPulse)}px "Impact", "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = vsGrad;
  ctx.shadowColor = '#EAB308';
  ctx.shadowBlur = 12;
  ctx.fillText('VS', vsX, vsY + 2);
  ctx.restore();
  }

  // 5. Draw Mascot (Bottom Center)
  let mascotPose = state.mascotPose || 'default';
  if ((!state.mascotPose || state.mascotPose === 'default') && currHighlight !== 'none') {
    mascotPose = currHighlight === 'left' ? 'point_left' : 'point_right';
  }
  const mascotImg = loadedImages[mascotPose] || loadedImages['default'];

  if (mascotImg) {
    ctx.save();
    
    let renderMascotDrawable = getTransparentMascotCanvas(
      mascotImg, 
      state.mascotChromaKey || 'green', 
      state.mascotChromaThreshold !== undefined ? state.mascotChromaThreshold : 230
    );

    // Safely restore only light enclosed holes left by old background-removal passes.
    // Dark chair/desk gaps remain transparent, so this is safe for green and white inputs.
    if (state.mascotChromaKey !== 'none') {
      renderMascotDrawable = getMascotWithWhiteBacking(renderMascotDrawable);
    }

    // Breathing animation & scaling preserving natural aspect ratio
    const breathScale = 1.0 + 0.012 * Math.sin(currentTime * Math.PI * 1.5);
    const scaleFactor = (state.mascotScale !== undefined ? state.mascotScale : 100) / 100;
    const baseHeight = 420 * scaleFactor * breathScale; // Increased default unzoomed base height from 340 to 420 for prominent display

    // Intrinsic mascot dimensions
    const nativeW = (renderMascotDrawable && renderMascotDrawable.width) || mascotImg.width || 320;
    const nativeH = (renderMascotDrawable && renderMascotDrawable.height) || mascotImg.height || 420;
    const aspect = nativeW / nativeH;

    let targetH = baseHeight;
    let targetW = targetH * aspect;

    // Safety cap for exceptionally wide assets
    if (targetW > 580 * scaleFactor) {
      targetW = 580 * scaleFactor;
      targetH = targetW / aspect;
    }

    const mascotX = w / 2;
    // Bottom Y position of mascot (configurable via state.mascotY, default 1280)
    const mascotBottomY = state.mascotY !== undefined ? state.mascotY : 1280; 
    
    ctx.translate(mascotX, mascotBottomY);

    ctx.drawImage(
      renderMascotDrawable, 
      -targetW / 2, 
      -targetH, 
      targetW, 
      targetH
    );
    
    ctx.restore();
  }

  // 6. Draw Subtitles (Above Mascot, centered)
  if (state.subtitleText && state.showSubtitles !== false) {
    const subtitleY = state.subtitleY !== undefined ? state.subtitleY : 770;
    const maxSubWidth = state.subtitleMaxWidth !== undefined ? state.subtitleMaxWidth : 450;
    
    const fontSize = state.subtitleFontSize || 38;
    const fontFamily = getCanvasFontFamily(state.subtitleFontFamily);
    const lineHeight = fontSize + 12;
    
    ctx.font = '900 ' + fontSize + 'px ' + fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const lines = wrapText(ctx, state.subtitleText, maxSubWidth);
    
    // Check if we can animate karaoke-style (word-by-word highlight)
    if (state.blockStart !== undefined && state.blockEnd !== undefined && state.blockEnd > state.blockStart) {
      const blockDuration = state.blockEnd - state.blockStart;
      const blockProgress = (currentTime - state.blockStart) / blockDuration;
      
      // Split complete subtitle into words
      const allWords = state.subtitleText.split(' ');
      const totalWords = allWords.length;
      // Calculate active word index
      const activeWordIndex = Math.min(
        Math.floor(blockProgress * totalWords),
        totalWords - 1
      );

      // Map word ranges to lines
      let wordIndexOffset = 0;
      const lineWordRanges = lines.map(line => {
        const lineWordsCount = line.split(' ').length;
        const startIdx = wordIndexOffset;
        const endIdx = wordIndexOffset + lineWordsCount - 1;
        wordIndexOffset += lineWordsCount;
        return { startIdx, endIdx };
      });

      // Find the active line index containing activeWordIndex
      let activeLineIdx = 0;
      for (let i = 0; i < lineWordRanges.length; i++) {
        if (activeWordIndex >= lineWordRanges[i].startIdx && activeWordIndex <= lineWordRanges[i].endIdx) {
          activeLineIdx = i;
          break;
        }
      }

      // Filter lines to draw based on subtitleMaxLines
      let linesToDraw = [];
      let drawLineStartWordIndices = [];
      const maxLinesToShow = state.subtitleMaxLines !== undefined ? state.subtitleMaxLines : 2;

      if (maxLinesToShow === 1 || lines.length === 1) {
        linesToDraw = [lines[activeLineIdx]];
        drawLineStartWordIndices = [lineWordRanges[activeLineIdx].startIdx];
      } else if (maxLinesToShow === 2) {
        if (activeLineIdx < lines.length - 1) {
          linesToDraw = [lines[activeLineIdx], lines[activeLineIdx + 1]];
          drawLineStartWordIndices = [lineWordRanges[activeLineIdx].startIdx, lineWordRanges[activeLineIdx + 1].startIdx];
        } else {
          // Last line, show previous and current
          if (activeLineIdx > 0) {
            linesToDraw = [lines[activeLineIdx - 1], lines[activeLineIdx]];
            drawLineStartWordIndices = [lineWordRanges[activeLineIdx - 1].startIdx, lineWordRanges[activeLineIdx].startIdx];
          } else {
            linesToDraw = [lines[activeLineIdx]];
            drawLineStartWordIndices = [lineWordRanges[activeLineIdx].startIdx];
          }
        }
      } else {
        // Show all lines
        linesToDraw = lines;
        drawLineStartWordIndices = lineWordRanges.map(r => r.startIdx);
      }

      // Draw subtitles line by line
      const totalHeight = linesToDraw.length * lineHeight;
      const startY = subtitleY - totalHeight / 2 + lineHeight / 2;

      linesToDraw.forEach((line, lineIndex) => {
        const lineStartWordIdx = drawLineStartWordIndices[lineIndex];
        const wordsInLine = line.split(' ');
        const lineY = startY + lineIndex * lineHeight;

        // Measure individual word widths and spacing using current configuration font
        ctx.font = '900 ' + fontSize + 'px ' + fontFamily;
        const wordsWidths = wordsInLine.map(wd => ctx.measureText(wd).width);
        const spaceWidth = ctx.measureText(' ').width;
        const totalLineWidth = wordsWidths.reduce((a, b) => a + b, 0) + (wordsInLine.length - 1) * spaceWidth;
        
        let currentX = w / 2 - totalLineWidth / 2;

        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';

        wordsInLine.forEach((word, wordIdx) => {
          const globalWordIdx = lineStartWordIdx + wordIdx;
          const isHighlighted = (globalWordIdx === activeWordIndex);
          const currentWordWidth = wordsWidths[wordIdx];
          
          if (isHighlighted && state.subtitleHighlightStyle === 'box-bg') {
            // Draw CapCut style solid highlight background box
            const boxPaddingX = 8;
            const boxPaddingY = 4;
            const boxW = currentWordWidth + boxPaddingX * 2;
            const boxH = fontSize + boxPaddingY * 2;
            const boxX = currentX - boxPaddingX;
            const boxY = lineY - boxH / 2;
            
            ctx.save();
            ctx.fillStyle = state.subtitleHighlightColor || '#FFFF00';
            drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 8);
            ctx.fill();
            ctx.restore();
            
            // Draw high-contrast text inside the box without outline
            ctx.save();
            ctx.font = '900 ' + fontSize + 'px ' + fontFamily;
            ctx.fillStyle = '#000000';
            ctx.fillText(word, currentX, lineY);
            ctx.restore();
          } else {
            // Normal word or other style text drawing
            ctx.save();
            
            let drawX = currentX;
            let drawY = lineY;
            let currentFontSize = fontSize;
            
            if (isHighlighted && state.subtitleHighlightStyle === 'grow') {
              currentFontSize = Math.floor(fontSize * 1.25);
              ctx.font = '900 ' + currentFontSize + 'px ' + fontFamily;
              // Shift Y down slightly to match font baselines
              drawY = lineY + (currentFontSize - fontSize) * 0.15;
            } else {
              ctx.font = '900 ' + fontSize + 'px ' + fontFamily;
            }
            
            // Determine colors
            let fillVal = state.subtitleColor || '#FFFFFF';
            let strokeVal = state.subtitleOutlineColor || '#000000';
            let strokeW = state.subtitleOutlineWidth !== undefined ? state.subtitleOutlineWidth : 8;
            
            if (isHighlighted) {
              if (state.subtitleHighlightStyle === 'outline-only') {
                strokeVal = state.subtitleHighlightColor || '#FFFF00';
              } else {
                fillVal = state.subtitleHighlightColor || '#FFFF00';
              }
            }
            
            // 1. Draw outline stroke
            if (strokeW > 0) {
              ctx.strokeStyle = strokeVal;
              ctx.lineWidth = strokeW;
              ctx.strokeText(word, drawX, drawY);
            }
            
            // 2. Draw fill color
            ctx.fillStyle = fillVal;
            ctx.fillText(word, drawX, drawY);
            
            ctx.restore();
          }
          
          currentX += wordsWidths[wordIdx] + spaceWidth;
        });
      });
    } else {
      // Fallback: simple text rendering
      const maxLinesToShow = state.subtitleMaxLines !== undefined ? state.subtitleMaxLines : 2;
      const linesToDraw = maxLinesToShow < lines.length ? lines.slice(0, maxLinesToShow) : lines;
      
      const totalHeight = linesToDraw.length * lineHeight;
      const startY = subtitleY - totalHeight / 2 + lineHeight / 2;

      linesToDraw.forEach((line, index) => {
        const lineY = startY + index * lineHeight;
        const strokeW = state.subtitleOutlineWidth !== undefined ? state.subtitleOutlineWidth : 8;
        ctx.font = '900 ' + fontSize + 'px ' + fontFamily;
        
        if (strokeW > 0) {
          ctx.strokeStyle = state.subtitleOutlineColor || '#000000';
          ctx.lineWidth = strokeW;
          ctx.strokeText(line, w / 2, lineY);
        }
        ctx.fillStyle = state.subtitleColor || '#FFFFFF';
        ctx.fillText(line, w / 2, lineY);
      });
    }
  }

  // 7. Draw Top Header & Channel Watermark at the very top layer to avoid overlaps
  const pos = state.headerPosition || 'top-center';
  if (pos !== 'hide') {
    const title = state.headerTitle ? state.headerTitle.toUpperCase() : '';
    const logoUrl = state.headerLogoUrl;
    const img = logoUrl && loadedImages[logoUrl] ? loadedImages[logoUrl] : null;

    ctx.save();
    ctx.lineJoin = 'round';

    if (pos === 'top-center') {
      const headerY = 25;
      const logoSize = 75;
      const logoX = w / 2 - logoSize / 2;

      // Draw Logo
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(w / 2, headerY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, logoX, headerY, logoSize, logoSize);
        ctx.restore();
      }

      // Draw Text
      if (title) {
        const titleFontSize = state.headerTitleFontSize || 28;
        ctx.font = 'bold ' + titleFontSize + 'px "Montserrat", Arial, sans-serif';
        ctx.fillStyle = state.headerTitleColor || '#4A3E3D';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(title, w / 2, headerY + logoSize + 25);
      }
    } else {
      // Corner positions: top-left, top-right, bottom-left, bottom-right
      const marginX = 60;
      const marginY = 60;
      const logoSize = 55;
      let logoX, logoY, textX, textY, textAlign;

      if (pos === 'top-left') {
        logoX = marginX;
        logoY = marginY;
        textX = logoX + (img ? logoSize + 12 : 0);
        textY = logoY + logoSize / 2;
        textAlign = 'left';
      } else if (pos === 'top-right') {
        logoX = w - marginX - logoSize;
        logoY = marginY;
        textX = logoX - 12;
        textY = logoY + logoSize / 2;
        textAlign = 'right';
      } else if (pos === 'bottom-left') {
        logoX = marginX;
        logoY = h - marginY - logoSize;
        textX = logoX + (img ? logoSize + 12 : 0);
        textY = logoY + logoSize / 2;
        textAlign = 'left';
      } else if (pos === 'bottom-right') {
        logoX = w - marginX - logoSize;
        logoY = h - marginY - logoSize;
        textX = logoX - 12;
        textY = logoY + logoSize / 2;
        textAlign = 'right';
      }

      // Draw Logo
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, logoX, logoY, logoSize, logoSize);
        ctx.restore();
      }

      // Draw Text
      if (title) {
        const titleFontSize = state.headerTitleFontSize ? Math.round(state.headerTitleFontSize * 0.8) : 22;
        ctx.font = 'bold ' + titleFontSize + 'px "Montserrat", Arial, sans-serif';
        ctx.fillStyle = state.headerTitleColor || '#4A3E3D';
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'middle';
        ctx.fillText(title, textX, textY);
      }
    }

    ctx.restore();
  }
}

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
export function getTransparentMascotCanvas(img, mode = 'auto', threshold = 230) {
  if (!img || !img.width || !img.height) return img;
  if (mode === 'none') return img;

  const cacheKey = `_transparent_${mode}_${threshold}`;
  if (img[cacheKey]) {
    return img[cacheKey];
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  try {
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 10) continue;

      let isBackground = false;

      // 1. Remove White / Off-White / Light Neutral Gray background
      if (mode === 'auto' || mode === 'white' || mode === 'both') {
        if (r >= threshold && g >= threshold && b >= threshold) {
          isBackground = true;
        } else if (r > 195 && g > 195 && b > 195 && Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && Math.abs(r - b) < 22) {
          isBackground = true;
        }
      }

      // 2. Remove Green Screen (Chroma Key Green #00FF00 / #00E600)
      if (mode === 'auto' || mode === 'green' || mode === 'both') {
        if (g > 100 && g > r * 1.25 && g > b * 1.25) {
          isBackground = true;
        } else if (g > 150 && r < 120 && b < 120) {
          isBackground = true;
        }
      }

      if (isBackground) {
        data[i + 3] = 0;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    img[cacheKey] = canvas;
    return canvas;
  } catch (e) {
    console.warn('Mascot transparency processing failed:', e);
    return img;
  }
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

  // 1. Draw Background
  const bgColorStr = state.bgColor || '#FAF6F0';
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
    currHighlight = currentBlock.highlight || 'none';
    const timeInBlock = currentTime - currentBlock.start;
    const transitionDuration = 0.3; // 300ms transition
    if (timeInBlock < transitionDuration) {
      t = timeInBlock / transitionDuration;
      // Ease-in-out curve
      t = t * t * (3 - 2 * t);
      prevHighlight = prevBlock ? (prevBlock.highlight || 'none') : 'none';
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

  // Draw Labels dynamically matching their respective panel zoom
  const baseFontSize = state.titleFontSize || 36;
  const outlineColor = state.titleOutlineColor || '#000000';
  const outlineW = state.titleOutlineWidth !== undefined ? state.titleOutlineWidth : 6;

  // Left Label
  ctx.save();
  const leftLabelSize = Math.round(baseFontSize * leftScale);
  ctx.font = `900 ${leftLabelSize}px "Montserrat", Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.round(outlineW * leftScale);
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.fillStyle = activeComp.leftColor || '#FF9800';
  ctx.globalAlpha = leftOpacity;
  ctx.strokeText(activeComp.leftTitle, leftLayout.x + leftLayout.w / 2, leftLayout.y - 25);
  ctx.fillText(activeComp.leftTitle, leftLayout.x + leftLayout.w / 2, leftLayout.y - 25);
  ctx.restore();

  // Right Label
  ctx.save();
  const rightLabelSize = Math.round(baseFontSize * rightScale);
  ctx.font = `900 ${rightLabelSize}px "Montserrat", Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.round(outlineW * rightScale);
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.fillStyle = activeComp.rightColor || '#10B981';
  ctx.globalAlpha = rightOpacity;
  ctx.strokeText(activeComp.rightTitle, rightLayout.x + rightLayout.w / 2, rightLayout.y - 25);
  ctx.fillText(activeComp.rightTitle, rightLayout.x + rightLayout.w / 2, rightLayout.y - 25);
  ctx.restore();

  // Helper to draw a panel image
  const drawPanelImage = (imgUrl, x, y, width, height, layout) => {
    ctx.save();
    
    // Apply blur filter if inactive
    if (layout.blur > 0) {
      ctx.filter = `blur(${layout.blur}px)`;
    }

    // Draw rounded clipping mask (acts as overflow: hidden)
    drawRoundedRect(ctx, x, y, width, height, 16);
    ctx.clip();

    if (imgUrl && loadedImages[imgUrl]) {
      const img = loadedImages[imgUrl];
      
      // Calculate cover dimensions (aspect ratio preservation)
      const imgRatio = img.width / img.height;
      const targetRatio = width / height;
      let drawW = width;
      let drawH = height;

      if (imgRatio > targetRatio) {
        // Image is wider than frame, so match height and scale width
        drawW = height * imgRatio;
      } else {
        // Image is taller than frame, so match width and scale height
        drawH = width / imgRatio;
      }

      // Apply Global Zoom factor
      const zoomFactor = (state.globalImageZoom !== undefined ? state.globalImageZoom : 100) / 100;
      const scaledW = drawW * zoomFactor;
      const scaledH = drawH * zoomFactor;

      // Center the scaled image inside the target frame bounds [x, y, width, height]
      const drawX = x + (width - scaledW) / 2;
      const drawY = y + (height - scaledH) / 2;

      ctx.drawImage(img, drawX, drawY, scaledW, scaledH);
    } else {
      // Placeholder if no image
      ctx.fillStyle = '#E3DCD5';
      ctx.fillRect(x, y, width, height);
      ctx.font = 'italic 18px sans-serif';
      ctx.fillStyle = '#888';
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

    // Draw premium active/inactive borders
    ctx.save();
    if (layout.isActive && (currHighlight === 'left' || currHighlight === 'right')) {
      // Active panel border: thicker white border with drop shadow
      ctx.strokeStyle = '#FFFFFF'; 
      ctx.lineWidth = 5;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
      ctx.shadowBlur = 10;
      drawRoundedRect(ctx, x, y, width, height, 16);
      ctx.stroke();
    } else {
      // Inactive or default panel border
      ctx.strokeStyle = layout.opacity < 1.0 ? 'rgba(208, 201, 192, 0.4)' : '#D0C9C0';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, x, y, width, height, 16);
      ctx.stroke();
    }
    ctx.restore();
  };

  drawPanelImage(activeComp.leftImageUrl, leftLayout.x, leftLayout.y, leftLayout.w, leftLayout.h, leftLayout);
  drawPanelImage(activeComp.rightImageUrl, rightLayout.x, rightLayout.y, rightLayout.w, rightLayout.h, rightLayout);

  // 5. Draw Mascot (Bottom Center)
  const mascotPose = state.mascotPose || 'default';
  const mascotImg = loadedImages[mascotPose];

  if (mascotImg) {
    ctx.save();
    
    // Breathing animation
    const breathScale = 1.0 + 0.012 * Math.sin(currentTime * Math.PI * 1.5);
    const scaleFactor = (state.mascotScale !== undefined ? state.mascotScale : 100) / 100;
    const targetW = 280 * breathScale * scaleFactor;
    const targetH = 340 * breathScale * scaleFactor;
    const mascotX = w / 2;
    // Set bottom coordinate fixed at y = 1200
    const mascotBottomY = 1220; 
    
    ctx.translate(mascotX, mascotBottomY);

    const renderMascotDrawable = getTransparentMascotCanvas(
      mascotImg, 
      state.mascotChromaKey || 'auto', 
      state.mascotChromaThreshold !== undefined ? state.mascotChromaThreshold : 230
    );

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
    const fontFamily = state.subtitleFontFamily || '"Montserrat", Arial, sans-serif';
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
        ctx.font = 'bold 28px "Montserrat", Arial, sans-serif';
        ctx.fillStyle = '#4A3E3D';
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
        ctx.font = 'bold 22px "Montserrat", Arial, sans-serif';
        ctx.fillStyle = '#4A3E3D';
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'middle';
        ctx.fillText(title, textX, textY);
      }
    }

    ctx.restore();
  }
}

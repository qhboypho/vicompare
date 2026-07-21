// src/utils/videoExporter.js
import { drawFrame } from './canvasRenderer';

/**
 * Preloads an image URL into an HTMLImageElement
 */
export function preloadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('Failed to load image:', url);
      resolve(null); // Resolve with null so loading doesn't break entirely
    };
    img.src = url;
  });
}

/**
 * Preloads all assets needed for the video render
 */
export async function preloadAllAssets(state, mascotPoses = {}) {
  const loaded = {};

  // 1. Load Header Logo
  if (state.headerLogoUrl) {
    loaded[state.headerLogoUrl] = await preloadImage(state.headerLogoUrl);
  }

  // 2. Load Left Panel Image (Global Fallback)
  if (state.leftImageUrl) {
    loaded[state.leftImageUrl] = await preloadImage(state.leftImageUrl);
  }

  // 3. Load Right Panel Image (Global Fallback)
  if (state.rightImageUrl) {
    loaded[state.rightImageUrl] = await preloadImage(state.rightImageUrl);
  }

  // 4. Load all comparison round images
  if (state.comparisons && state.comparisons.length > 0) {
    for (const comp of state.comparisons) {
      if (comp.leftImageUrl && !loaded[comp.leftImageUrl]) {
        loaded[comp.leftImageUrl] = await preloadImage(comp.leftImageUrl);
      }
      if (comp.rightImageUrl && !loaded[comp.rightImageUrl]) {
        loaded[comp.rightImageUrl] = await preloadImage(comp.rightImageUrl);
      }
    }
  }

  // 5. Load Mascot Poses
  const poses = ['default', 'point_left', 'point_right', 'shrug'];
  for (const pose of poses) {
    const url = mascotPoses[pose];
    if (url) {
      loaded[pose] = await preloadImage(url);
    }
  }

  return loaded;
}

/**
 * Exports the project to a WebM video file
 * @param {Object} options 
 * @param {HTMLCanvasElement} options.canvas - The source canvas
 * @param {Object} options.state - Current configuration (bgColor, titles, images, etc.)
 * @param {Array} options.timelineBlocks - Array of timeline segments
 * @param {string} options.audioUrl - Main voiceover audio url
 * @param {Object} options.mascotPoses - Object mapping pose names to image urls
 * @param {function} options.onProgress - Callback with progress percent (0 - 100)
 * @param {function} options.onComplete - Callback with blob URL
 * @param {function} options.onError - Callback with error message
 */
export async function exportVideo({
  canvas,
  state,
  timelineBlocks,
  audioUrl,
  mascotPoses,
  onProgress,
  onComplete,
  onError
}) {
  let audioContext = null;
  let bufferSourceNode = null;
  let audioDestination = null;
  let recorder = null;
  let animationFrameId = null;
  let previewAudioEl = null;

  try {
    onProgress(1); // Start loading

    // 1. Preload all images
    const loadedImages = await preloadAllAssets(state, mascotPoses);
    onProgress(10); // Finished loading assets

    // 2. Determine total duration
    let duration = 5; // Default fallback duration in seconds
    if (timelineBlocks && timelineBlocks.length > 0) {
      duration = Math.max(...timelineBlocks.map(b => b.end), 5);
    }

    // Set up canvas stream (30 FPS)
    const canvasStream = canvas.captureStream(30);
    const outputTracks = [...canvasStream.getVideoTracks()];

    // 3. Set up Audio if available (Pure AudioBuffer for silent record, Element for controllable preview)
    const hasAudio = !!audioUrl;
    if (hasAudio) {
      previewAudioEl = new Audio(audioUrl);
      if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        previewAudioEl.crossOrigin = 'anonymous';
      }

      // Khởi tạo AudioContext sớm để giải mã dữ liệu âm thanh
      let useAudioContext = false;
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (typeof audioContext.createMediaStreamAudioDestination === 'function') {
          useAudioContext = true;
        }
      } catch (e) {
        console.warn('AudioContext initialization failed, will use fallback:', e);
      }
      
      // Tải và giải mã âm thanh thành AudioBuffer để loại bỏ hoàn toàn lỗi rò rỉ âm thanh loa ngoài
      let audioBuffer = null;
      if (useAudioContext) {
        try {
          const isLocal = audioUrl.startsWith('blob:') || audioUrl.startsWith('data:');
          const requestUrl = isLocal ? audioUrl : `/cors-proxy?url=${encodeURIComponent(audioUrl)}`;
          const res = await fetch(requestUrl);
          const arrayBuffer = await res.arrayBuffer();
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          duration = audioBuffer.duration;
        } catch (decodeErr) {
          console.warn('Không thể giải mã tệp tin âm thanh để ghi, sẽ dùng fallback captureStream:', decodeErr);
          useAudioContext = false;
        }
      }

      // Thiết lập trạng thái tắt tiếng loa ngoài ban đầu từ giao diện người dùng
      previewAudioEl.muted = !!window.isExportMuted;
      window.exportPreviewAudio = previewAudioEl;

      if (useAudioContext && audioBuffer) {
        // Tạo bộ phát AudioBufferSourceNode chạy ngầm (chỉ truyền tín hiệu ghi hình, hoàn toàn im lặng với loa ngoài)
        bufferSourceNode = audioContext.createBufferSource();
        bufferSourceNode.buffer = audioBuffer;
        
        audioDestination = audioContext.createMediaStreamAudioDestination();
        bufferSourceNode.connect(audioDestination);
        
        // Đưa luồng âm thanh ghi âm vào MediaRecorder
        audioDestination.stream.getAudioTracks().forEach(track => {
          outputTracks.push(track);
        });
      } else {
        // FALLBACK: captureStream from previewAudioEl if AudioContext is unsupported/failed
        console.warn('Web Audio API AudioContext routing failed or unsupported, falling back to captureStream');
        let fallbackStream = null;
        if (typeof previewAudioEl.captureStream === 'function') {
          fallbackStream = previewAudioEl.captureStream();
        } else if (typeof previewAudioEl.mozCaptureStream === 'function') {
          fallbackStream = previewAudioEl.mozCaptureStream();
        }
        
        if (fallbackStream) {
          fallbackStream.getAudioTracks().forEach(track => {
            outputTracks.push(track);
          });
        } else {
          console.error('Audio captureStream is not supported in this browser.');
        }
      }
    }

    // 4. Create Combined Stream and Recorder
    const combinedStream = new MediaStream(outputTracks);
    
    // Choose optimal mimeType supported by the browser
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4' // Safari support
    ];
    
    let selectedMimeType = '';
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedMimeType = type;
        break;
      }
    }

    recorder = new MediaRecorder(combinedStream, {
      mimeType: selectedMimeType,
      videoBitsPerSecond: 4000000 // 4 Mbps (high quality 720p)
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      // Clean up animation loop
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      
      // Dừng phát âm thanh
      if (bufferSourceNode) {
        try {
          bufferSourceNode.stop();
        } catch (e) {}
      }
      if (previewAudioEl) {
        previewAudioEl.pause();
      }
      if (audioContext) {
        audioContext.close();
      }
      window.exportPreviewAudio = null;

      const fileExtension = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: selectedMimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      onComplete({ url, extension: fileExtension });
    };

    // 5. Start Rendering & Recording Loop
    if (hasAudio) {
      if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (resErr) {
          console.warn('Failed to resume AudioContext:', resErr);
        }
      }
      try {
        // Chạy song song: luồng ghi ngầm (không phát tiếng) và luồng loa ngoài (kiểm soát tắt/bật)
        if (bufferSourceNode) {
          bufferSourceNode.start(0);
        }
        await previewAudioEl.play();
      } catch (err) {
        console.error('Audio playback failed during export:', err);
        throw err;
      }
    }

    const startTime = Date.now();
    recorder.start();

    const renderLoop = () => {
      // Use the system clock as the master time source for rendering.
      // This is infinitely more robust than relying on audioEl.currentTime,
      // which can freeze if audio is buffering, blocked by autoplay, or has CORS issues.
      const relativeTime = (Date.now() - startTime) / 1000;

      // Check if finished (reaches total duration)
      const isFinished = relativeTime >= duration;
      
      if (isFinished) {
        recorder.stop();
        onProgress(100);
        return;
      }

      // Find the active subtitle block
      const activeBlock = timelineBlocks.find(
        block => relativeTime >= block.start && relativeTime <= block.end
      );

      // Construct current state for drawFrame
      const currentState = {
        ...state,
        subtitleText: activeBlock ? activeBlock.text : '',
        mascotPose: activeBlock ? activeBlock.pose : 'default',
        highlight: activeBlock ? activeBlock.highlight : 'none',
        blockStart: activeBlock ? activeBlock.start : 0,
        blockEnd: activeBlock ? activeBlock.end : 0
      };

      // Draw the frame
      drawFrame(canvas, currentState, relativeTime, loadedImages);

      // Report progress (scale between 10% and 99%)
      const pct = 10 + Math.floor((relativeTime / duration) * 89);
      onProgress(Math.min(pct, 99));

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    // Begin loop
    renderLoop();

  } catch (err) {
    console.error('Rendering failed:', err);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (bufferSourceNode) {
      try {
        bufferSourceNode.stop();
      } catch (e) {}
    }
    if (previewAudioEl) previewAudioEl.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (audioContext) audioContext.close();
    window.exportPreviewAudio = null;
    onError(err.message || 'Lỗi xảy ra trong quá trình xuất video');
  }
}

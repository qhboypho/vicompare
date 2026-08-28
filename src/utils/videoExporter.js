// src/utils/videoExporter.js
import { drawFrame } from './canvasRenderer';
import { buildCanvasImageCandidates } from './canvasImageSource';

/**
 * Preloads an image URL into an HTMLImageElement.
 *
 * QUAN TRỌNG: ảnh remote (http/https, vd ảnh tự tìm từ Telegram) phải load QUA
 * cors-proxy giống hệt luồng preview (buildCanvasImageCandidates). Nếu load thẳng
 * URL gốc với crossOrigin='anonymous', server ảnh thường KHÔNG trả CORS header →
 * onerror → ảnh null → khi render video canvas trống (dù preview vẫn hiện vì proxy).
 * Ta thử lần lượt: [proxy, url gốc] và trả về ảnh đầu tiên load được.
 */
export function preloadImage(url, appOrigin = '') {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }

    const candidates = buildCanvasImageCandidates(url, appOrigin);
    if (candidates.length === 0) {
      resolve(null);
      return;
    }

    const tryCandidate = (index) => {
      const candidateUrl = candidates[index];
      if (!candidateUrl) {
        console.warn('Failed to load image (all candidates):', url);
        resolve(null);
        return;
      }
      const img = new Image();
      if (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = async () => {
        try {
          await img.decode?.();
        } catch {
          // decode có thể bị từ chối với ảnh đã decode/SVG; onload là đủ.
        }
        resolve(img);
      };
      img.onerror = () => tryCandidate(index + 1);
      img.src = candidateUrl;
    };

    tryCandidate(0);
  });
}

/**
 * Preloads all assets needed for the video render
 */
export async function preloadAllAssets(state, mascotPoses = {}) {
  const loaded = {};
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  // 1. Load Header Logo
  if (state.headerLogoUrl) {
    loaded[state.headerLogoUrl] = await preloadImage(state.headerLogoUrl, appOrigin);
  }

  // 2. Load Left Panel Image (Global Fallback)
  if (state.leftImageUrl) {
    loaded[state.leftImageUrl] = await preloadImage(state.leftImageUrl, appOrigin);
  }

  // 3. Load Right Panel Image (Global Fallback)
  if (state.rightImageUrl) {
    loaded[state.rightImageUrl] = await preloadImage(state.rightImageUrl, appOrigin);
  }

  // 4. Load all comparison round images
  if (state.comparisons && state.comparisons.length > 0) {
    for (const comp of state.comparisons) {
      if (comp.leftImageUrl && !loaded[comp.leftImageUrl]) {
        loaded[comp.leftImageUrl] = await preloadImage(comp.leftImageUrl, appOrigin);
      }
      if (comp.rightImageUrl && !loaded[comp.rightImageUrl]) {
        loaded[comp.rightImageUrl] = await preloadImage(comp.rightImageUrl, appOrigin);
      }
    }
  }

  // 5. Load Mascot Poses
  const poses = ['default', 'point_left', 'point_right', 'shrug'];
  for (const pose of poses) {
    const url = mascotPoses[pose];
    if (url) {
      loaded[pose] = await preloadImage(url, appOrigin);
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
 * @param {boolean} options.monitorAudio - Whether to play export preview audio through speakers while rendering
 * @param {function} options.shouldMonitorAudio - Reads the latest monitor state while async audio setup is still running
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
  monitorAudio = false,
  shouldMonitorAudio,
  onProgress,
  onComplete,
  onError
}) {
  let audioContext = null;
  let audioBufferSource = null;
  let audioDestination = null;
  let recorder = null;
  let animationFrameId = null;
  let audioEl = null;
  let monitorAudioEl = null;
  let decodedAudioBuffer = null;
  let exportFailed = false;
  let errorReported = false;
  let startTime = 0;

  const reportErrorOnce = (err) => {
    if (errorReported) return;
    errorReported = true;
    onError(err?.message || err || 'Lỗi xảy ra trong quá trình xuất video');
  };

  const stopAudioPlayback = () => {
    if (audioEl) {
      try {
        audioEl.pause();
      } catch {}
    }
    if (monitorAudioEl) {
      try {
        monitorAudioEl.pause();
      } catch {}
    }
    if (audioBufferSource) {
      try {
        audioBufferSource.stop();
      } catch {}
    }
    if (audioContext && audioContext.state !== 'closed') {
      try {
        audioContext.close();
      } catch {}
    }
    window.exportMonitorGain = null;
    window.exportPreviewAudio = null;
    window.exportPreviewControls = null;
  };

  const getMonitorAudio = () => {
    if (typeof shouldMonitorAudio === 'function') {
      return !!shouldMonitorAudio();
    }
    return !!monitorAudio;
  };

  const setMonitorMuted = (muted) => {
    const monitorVolume = muted ? 0 : 0.4;
    if (window.exportMonitorGain?.gain) {
      window.exportMonitorGain.gain.value = monitorVolume;
    }
    if (window.exportPreviewAudio) {
      window.exportPreviewAudio.muted = muted;
      window.exportPreviewAudio.volume = monitorVolume;
    }
  };

  const resumeMonitorAudio = async () => {
    const elapsed = startTime ? Math.max(0, (performance.now() - startTime) / 1000) : 0;
    if (audioContext && audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (err) {
        console.warn('Failed to resume export monitor AudioContext:', err);
      }
    }
    if (window.exportPreviewAudio && window.exportPreviewAudio.paused) {
      try {
        if (Number.isFinite(window.exportPreviewAudio.duration) && elapsed < window.exportPreviewAudio.duration) {
          window.exportPreviewAudio.currentTime = elapsed;
        }
        await window.exportPreviewAudio.play();
      } catch (err) {
        console.warn('Failed to play export preview audio:', err);
      }
    }
  };

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
    const videoTracks = canvasStream.getVideoTracks();
    if (videoTracks.length === 0) {
      throw new Error('Không tạo được video track từ canvas.');
    }
    const canvasVideoTrack = videoTracks[0];
    const outputTracks = [...videoTracks];

    // 3. Set up Audio if available
    const hasAudio = !!audioUrl;
    if (hasAudio) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
          try {
            await audioContext.resume();
          } catch (resErr) {}
        }

        if (typeof audioContext.createMediaStreamAudioDestination !== 'function') {
          throw new Error('createMediaStreamAudioDestination is not supported');
        }

        const isLocalAudio = audioUrl.startsWith('blob:') || audioUrl.startsWith('data:');
        const requestUrl = isLocalAudio ? audioUrl : `/cors-proxy?url=${encodeURIComponent(audioUrl)}`;
        const audioRes = await fetch(requestUrl);
        if (!audioRes.ok) throw new Error('Audio fetch failed');

        const audioArrayBuffer = await audioRes.arrayBuffer();
        decodedAudioBuffer = await audioContext.decodeAudioData(audioArrayBuffer.slice(0));
        if (decodedAudioBuffer.duration && !isNaN(decodedAudioBuffer.duration)) {
          duration = decodedAudioBuffer.duration;
        }

        monitorAudioEl = new Audio(requestUrl);
        monitorAudioEl.preload = 'auto';
        monitorAudioEl.muted = !getMonitorAudio();
        monitorAudioEl.volume = getMonitorAudio() ? 0.4 : 0;
        window.exportPreviewAudio = monitorAudioEl;
        window.exportPreviewControls = {
          setMuted: setMonitorMuted,
          resume: resumeMonitorAudio
        };

        audioDestination = audioContext.createMediaStreamAudioDestination();
        audioDestination.stream.getAudioTracks().forEach(track => {
          outputTracks.push(track);
        });
      } catch (ctxErr) {
        console.warn('Web Audio API buffer routing fallback to captureStream:', ctxErr);
        try {
          audioEl = new Audio(audioUrl);
          if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
            audioEl.crossOrigin = 'anonymous';
          }

          await new Promise((resolve) => {
            audioEl.onloadedmetadata = () => {
              if (audioEl.duration && !isNaN(audioEl.duration)) {
                duration = audioEl.duration;
              }
              resolve();
            };
            audioEl.onerror = (err) => {
              console.warn('audioEl loading error:', err);
              resolve();
            };
            setTimeout(resolve, 3000);
          });

          let fallbackStream = null;
          if (typeof audioEl.captureStream === 'function') {
            fallbackStream = audioEl.captureStream();
          } else if (typeof audioEl.mozCaptureStream === 'function') {
            fallbackStream = audioEl.mozCaptureStream();
          }
          
          if (fallbackStream) {
            fallbackStream.getAudioTracks().forEach(track => {
              outputTracks.push(track);
            });
          }
        } catch (streamErr) {
          console.warn('Failed to capture stream from audioEl:', streamErr);
        }
      }
    }
    if (hasAudio && !outputTracks.some(track => track.kind === 'audio')) {
      throw new Error('Không gắn được âm thanh vào file export. Vui lòng thử render lại voice hoặc tải audio lên lại trước khi xuất video.');
    }

    // 4. Create Combined Stream and Recorder
    const combinedStream = new MediaStream(outputTracks);
    
    // Ưu tiên MP4/H.264 vì TikTok & nhiều nền tảng chỉ nhận MP4/MOV.
    // Chrome 130+ hỗ trợ ghi MP4 trực tiếp; fallback WebM cho trình duyệt cũ.
    const mimeTypes = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
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

    recorder.onerror = (event) => {
      exportFailed = true;
      console.error('MediaRecorder error:', event.error || event);
      stopAudioPlayback();
      reportErrorOnce(event.error || 'MediaRecorder gặp lỗi khi xuất video.');
    };

    recorder.onstop = () => {
      // Clean up animation loop
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      stopAudioPlayback();

      if (exportFailed) return;
      if (chunks.length === 0) {
        reportErrorOnce('Trình duyệt không ghi được dữ liệu video. Vui lòng thử xuất lại.');
        return;
      }

      const fileExtension = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: selectedMimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      onComplete({ url, extension: fileExtension });
    };

    // 5. Start Rendering & Recording Loop
    startTime = performance.now();
    recorder.start();

    if (hasAudio && audioContext && decodedAudioBuffer && audioDestination) {
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (resErr) {
          console.warn('Failed to resume AudioContext:', resErr);
        }
      }

      try {
        audioBufferSource = audioContext.createBufferSource();
        audioBufferSource.buffer = decodedAudioBuffer;
        audioBufferSource.connect(audioDestination);
        window.exportPreviewControls = {
          setMuted: setMonitorMuted,
          resume: resumeMonitorAudio
        };
        setMonitorMuted(!getMonitorAudio());

        audioBufferSource.start(0);
        if (monitorAudioEl) {
          monitorAudioEl.muted = !getMonitorAudio();
          monitorAudioEl.volume = getMonitorAudio() ? 0.4 : 0;
          if (getMonitorAudio()) {
            await monitorAudioEl.play().catch((err) => {
              console.warn('export monitor audio play warning:', err);
            });
          }
        }
      } catch (sourceErr) {
        console.warn('decoded audio source start warning:', sourceErr);
      }
    } else if (hasAudio && audioEl) {
      try {
        audioEl.muted = !getMonitorAudio();
        audioEl.volume = getMonitorAudio() ? 0.4 : 0;
        window.exportPreviewAudio = audioEl;
        window.exportPreviewControls = {
          setMuted: setMonitorMuted,
          resume: resumeMonitorAudio
        };
        await audioEl.play();
      } catch (playErr) {
        console.warn('audioEl play warning (rendering will continue):', playErr);
      }
    }

    const renderLoop = () => {
      try {
        if (exportFailed || recorder.state === 'inactive') return;

        // Use the system clock as the master time source for rendering.
        // This is more robust than relying on audioEl.currentTime, which can freeze if audio is buffering or blocked.
        const relativeTime = (performance.now() - startTime) / 1000;

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
          isOutro: activeBlock ? Boolean(activeBlock.isOutro) : false,
          followLabel: activeBlock?.followLabel || state.outroFollowLabel || 'ĐĂNG KÝ',
          mascotPose: activeBlock ? activeBlock.pose : 'default',
          highlight: activeBlock ? activeBlock.highlight : 'none',
          blockStart: activeBlock ? activeBlock.start : 0,
          blockEnd: activeBlock ? activeBlock.end : 0
        };

        // Draw the frame. Keep this guarded because RAF exceptions are not caught by the outer export try/catch.
        drawFrame(canvas, currentState, relativeTime, loadedImages);
        if (typeof canvasVideoTrack.requestFrame === 'function') {
          canvasVideoTrack.requestFrame();
        }

        // Report progress (scale between 10% and 99%)
        const pct = 10 + Math.floor((relativeTime / duration) * 89);
        onProgress(Math.min(pct, 99));

        animationFrameId = requestAnimationFrame(renderLoop);
      } catch (frameErr) {
        exportFailed = true;
        console.error('Frame rendering failed:', frameErr);
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        stopAudioPlayback();
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch (stopErr) {
            console.warn('Failed to stop recorder after frame error:', stopErr);
          }
        }
        reportErrorOnce(frameErr);
      }
    };

    // Begin loop
    renderLoop();

  } catch (err) {
    exportFailed = true;
    console.error('Rendering failed:', err);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    stopAudioPlayback();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    reportErrorOnce(err);
  }
}

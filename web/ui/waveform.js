import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { formatTime } from './transport.js';

let wavesurfer = null;
let regionsPlugin = null;
let currentBlobUrl = null;
let originalBlobUrl = null;
let hoverContainer = null;
let hoverElements = null;
let hoverListeners = null;
let currentZoomLevel = 0;
let loopRegion = null;
let isLooping = false;

let scrollEl = null;
let customScrollbar = null;
let customThumb = null;
let isDraggingThumb = false;
let anchorMarker = null;
let loopListeners = null;
let isStereoView = false;
let is2xHeight = false;

function setupCustomScrollbar() {
  if (!wavesurfer) return;

  // Hide native scrollbar inside Shadow DOM
  const wrapper = wavesurfer.getWrapper();
  const shadowRoot = wrapper?.getRootNode();
  if (!shadowRoot || shadowRoot === document) return;

  const style = document.createElement('style');
  style.textContent = `
    .scroll {
      overflow-x: auto !important;
      scrollbar-width: none;
    }
    .scroll::-webkit-scrollbar {
      display: none;
    }
  `;
  shadowRoot.appendChild(style);
  scrollEl = shadowRoot.querySelector('.scroll');

  // Create custom scrollbar
  const container = document.getElementById('waveform');
  if (!container) return;

  // Remove old if exists
  const old = container.querySelector('.waveform-scrollbar');
  if (old) old.remove();

  customScrollbar = document.createElement('div');
  customScrollbar.className = 'waveform-scrollbar';

  customThumb = document.createElement('div');
  customThumb.className = 'waveform-scrollbar-thumb';

  customScrollbar.appendChild(customThumb);
  container.appendChild(customScrollbar);

  // Sync: scroll → thumb position
  if (scrollEl) {
    scrollEl.addEventListener('scroll', syncThumb);
  }

  // Track click → jump scroll
  customScrollbar.addEventListener('mousedown', (e) => {
    if (e.target === customThumb) return;
    if (!scrollEl) return;
    const rect = customScrollbar.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;
    const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
    scrollEl.scrollLeft = clickRatio * maxScroll;
  });

  // Thumb drag
  customThumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingThumb = true;
    customThumb.classList.add('active');

    const startX = e.clientX;
    const startScroll = scrollEl?.scrollLeft || 0;
    const trackWidth = customScrollbar.getBoundingClientRect().width;
    const maxScroll = (scrollEl?.scrollWidth || 1) - (scrollEl?.clientWidth || 1);

    const onMove = (ev) => {
      if (!isDraggingThumb || !scrollEl) return;
      const dx = ev.clientX - startX;
      const scrollDelta = (dx / trackWidth) * maxScroll;
      scrollEl.scrollLeft = startScroll + scrollDelta;
    };

    const onUp = () => {
      isDraggingThumb = false;
      customThumb.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  syncThumb();
}

function syncThumb() {
  if (!scrollEl || !customThumb || !customScrollbar) return;
  const { scrollLeft, scrollWidth, clientWidth } = scrollEl;

  if (scrollWidth <= clientWidth) {
    // No overflow — full width thumb
    customThumb.style.width = '100%';
    customThumb.style.left = '0';
    return;
  }

  const thumbRatio = clientWidth / scrollWidth;
  const trackWidth = customScrollbar.clientWidth;
  const thumbWidth = Math.max(30, thumbRatio * trackWidth);
  const maxLeft = trackWidth - thumbWidth;
  const scrollRatio = scrollLeft / (scrollWidth - clientWidth);

  customThumb.style.width = `${thumbWidth}px`;
  customThumb.style.left = `${scrollRatio * maxLeft}px`;
}

/**
 * Initialize WaveSurfer waveform display
 * @param {AudioBuffer} audioBuffer - Audio buffer to display
 * @param {Blob} originalBlob - Original file blob for WaveSurfer
 * @param {Object} callbacks - Callback functions { onSeek, getBuffer }
 */
export function initWaveSurfer(audioBuffer, originalBlob, callbacks = {}) {
  // Cleanup previous instance
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  // Revoke previous blob URLs to prevent memory leak
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  if (originalBlobUrl) {
    URL.revokeObjectURL(originalBlobUrl);
    originalBlobUrl = null;
  }

  try {
    // Create gradient (match container height of 100px for proper vertical centering)
    const ctx = document.createElement('canvas').getContext('2d');
    const waveGradient = ctx.createLinearGradient(0, 0, 0, 100);
    waveGradient.addColorStop(0, 'rgba(255, 159, 67, 0.4)');
    waveGradient.addColorStop(0.5, 'rgba(255, 159, 67, 0.6)');
    waveGradient.addColorStop(1, 'rgba(217, 119, 54, 0.3)');

    const progressGradient = ctx.createLinearGradient(0, 0, 0, 100);
    progressGradient.addColorStop(0, '#ffb366');
    progressGradient.addColorStop(0.5, '#ff9f43');
    progressGradient.addColorStop(1, '#d97736');

    // Create blob URL for WaveSurfer (tracked for cleanup)
    // Store as both current and original so we can switch back on FX bypass
    currentBlobUrl = URL.createObjectURL(originalBlob);
    originalBlobUrl = URL.createObjectURL(originalBlob); // Separate URL for original

    // Create regions plugin for loop functionality
    regionsPlugin = RegionsPlugin.create();

    const h = getWaveHeight();
    const containerH = getContainerHeight();
    const container = document.getElementById('waveform');
    if (container) {
      container.style.height = containerH + 'px';
    }

    const wsOptions = {
      container: '#waveform',
      waveColor: createWaveGradient(h),
      progressColor: createProgressGradient(h),
      cursorColor: '#ff9f43',
      cursorWidth: 2,
      height: h,
      normalize: false,
      interact: true,
      dragToSeek: false,
      url: currentBlobUrl,
      plugins: [regionsPlugin]
    };

    if (isStereoView) {
      wsOptions.splitChannels = [
        { waveColor: createWaveGradient(h), progressColor: createProgressGradient(h) },
        { waveColor: createWaveGradient(h), progressColor: createProgressGradient(h) }
      ];
    }

    wavesurfer = WaveSurfer.create(wsOptions);

    // Custom scrollbar (native scrollbar hidden, custom thumb)
    setupCustomScrollbar();

    // Custom hover handler (uses our known duration, not WaveSurfer's state)
    setupWaveformHover(audioBuffer.duration);

    // Mute wavesurfer - we use our own Web Audio chain
    wavesurfer.setVolume(0);

    // Log when audio is ready
    wavesurfer.on('ready', () => {
      console.log('WaveSurfer ready, duration:', wavesurfer.getDuration());
    });

    // Setup custom click/drag handlers for Shift+drag loop creation
    setupLoopCreation(callbacks);

    // Setup loop button UI sync
    if (callbacks.onLoopChange) {
      regionsPlugin.on('region-created', () => {
        callbacks.onLoopChange(true);
      });
      regionsPlugin.on('region-removed', () => {
        callbacks.onLoopChange(false);
      });
    }

    return wavesurfer;
  } catch (error) {
    console.error('WaveSurfer initialization failed:', error);
    wavesurfer = null;
    return null;
  }
}

/**
 * Destroy WaveSurfer instance and cleanup
 */
export function destroyWaveSurfer() {
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  if (originalBlobUrl) {
    URL.revokeObjectURL(originalBlobUrl);
    originalBlobUrl = null;
  }

  // Clean up custom scrollbar references
  scrollEl = null;
  customScrollbar = null;
  customThumb = null;
  isDraggingThumb = false;

  cleanupHover();
}

/**
 * Switch waveform back to original (for FX bypass)
 * This reloads from the stored original blob URL instead of creating a new WAV
 */
export function showOriginalWaveform() {
  if (!wavesurfer || !originalBlobUrl) return;

  console.log('[Waveform] Switching to original waveform');
  wavesurfer.load(originalBlobUrl);
}

/**
 * Setup waveform hover time display
 * @param {number} duration - Audio duration in seconds
 */
function setupWaveformHover(duration) {
  const container = document.querySelector('#waveform');
  if (!container) return;

  // Clean up existing hover elements
  cleanupHover();

  // Store new container reference
  hoverContainer = container;

  // Create hover line
  const line = document.createElement('div');
  line.style.cssText = `
    position: absolute;
    top: 0;
    height: 100%;
    width: 1px;
    background: rgba(255, 255, 255, 0.5);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 10;
  `;
  container.style.position = 'relative';
  container.appendChild(line);

  // Create hover label
  const label = document.createElement('div');
  label.style.cssText = `
    position: absolute;
    top: 2px;
    background: #1a1a1a;
    color: #ff9f43;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 2px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 11;
    white-space: nowrap;
  `;
  container.appendChild(label);

  hoverElements = { line, label };

  // Mouse move handler
  const moveHandler = (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relX = Math.max(0, Math.min(1, x / rect.width));
    const time = relX * duration;

    // Format time using formatTime function
    label.textContent = formatTime(time);

    // Position elements
    line.style.left = `${x}px`;
    line.style.opacity = '1';

    // Position label (flip to left side if near right edge)
    const labelWidth = label.offsetWidth;
    if (x + labelWidth + 5 > rect.width) {
      label.style.left = `${x - labelWidth - 2}px`;
    } else {
      label.style.left = `${x + 2}px`;
    }
    label.style.opacity = '1';
  };

  // Mouse leave handler
  const leaveHandler = () => {
    line.style.opacity = '0';
    label.style.opacity = '0';
  };

  container.addEventListener('mousemove', moveHandler);
  container.addEventListener('mouseleave', leaveHandler);

  // Store references for cleanup
  hoverListeners = { move: moveHandler, leave: leaveHandler };
}

/**
 * Cleanup hover elements and listeners
 */
function cleanupHover() {
  if (hoverElements) {
    hoverElements.line.remove();
    hoverElements.label.remove();
    hoverElements = null;
  }

  if (hoverContainer && hoverListeners) {
    hoverContainer.removeEventListener('mousemove', hoverListeners.move);
    hoverContainer.removeEventListener('mouseleave', hoverListeners.leave);
    hoverListeners = null;
  }
}

/**
 * Setup custom loop creation with Shift+drag
 * @param {Object} callbacks - Callback functions { onSeek, getBuffer }
 */
function setupLoopCreation(callbacks) {
  const container = document.getElementById('waveform');
  if (!container) return;

  // Remove previous listeners to prevent accumulation
  if (loopListeners) {
    loopListeners.container.removeEventListener('mousedown', loopListeners.down);
    document.removeEventListener('mousemove', loopListeners.move);
    document.removeEventListener('mouseup', loopListeners.up);
    loopListeners = null;
  }

  let isDragging = false;
  let dragStartX = 0;
  let dragStartTime = 0;
  let isShiftDrag = false;
  let dragPreview = null;

  // Create drag preview overlay
  const createDragPreview = () => {
    if (dragPreview) return dragPreview;

    dragPreview = document.createElement('div');
    dragPreview.style.cssText = `
      position: absolute;
      top: 0;
      height: 100%;
      background: rgba(255, 159, 67, 0.2);
      border-left: 1px solid rgba(255, 159, 67, 0.8);
      border-right: 1px solid rgba(255, 159, 67, 0.8);
      pointer-events: none;
      z-index: 5;
    `;
    container.appendChild(dragPreview);
    return dragPreview;
  };

  const removeDragPreview = () => {
    if (dragPreview) {
      dragPreview.remove();
      dragPreview = null;
    }
  };

  const updateDragPreview = (startX, currentX) => {
    if (!dragPreview) return;

    const left = Math.min(startX, currentX);
    const width = Math.abs(currentX - startX);

    dragPreview.style.left = `${left}px`;
    dragPreview.style.width = `${width}px`;
  };

  const mouseDownHandler = (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relX = Math.max(0, Math.min(1, x / rect.width));
    const duration = callbacks.getBuffer?.()?.duration || wavesurfer?.getDuration() || 0;
    const time = relX * duration;

    isShiftDrag = e.shiftKey;

    // If normal click and loop is active, check if click is on the region
    if (!isShiftDrag && isLooping && loopRegion) {
      const regionStartX = (loopRegion.start / duration) * rect.width;
      const regionEndX = (loopRegion.end / duration) * rect.width;
      const handleMargin = 8;

      if (x >= regionStartX - handleMargin && x <= regionEndX + handleMargin) {
        // Click is on loop region — let RegionsPlugin handle resize/drag
        isDragging = false;
        return;
      }
      // Click outside region — disable loop
      disableLoop();
      console.log('[Loop] Disabled by click outside region');
    }

    isDragging = true;
    dragStartX = x;
    dragStartTime = time;
  };

  const mouseMoveHandler = (e) => {
    if (!isDragging) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const distance = Math.abs(x - dragStartX);

    // Only consider it a drag if moved more than 5 pixels
    if (distance > 5 && isShiftDrag) {
      // Show drag preview during Shift+drag
      createDragPreview();
      updateDragPreview(dragStartX, x);
    }
  };

  const mouseUpHandler = (e) => {
    if (!isDragging) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relX = Math.max(0, Math.min(1, x / rect.width));
    const duration = callbacks.getBuffer?.()?.duration || wavesurfer?.getDuration() || 0;
    const endTime = relX * duration;
    const distance = Math.abs(x - dragStartX);

    // Remove drag preview
    removeDragPreview();

    if (isShiftDrag && distance > 5) {
      // Shift+drag completed - create loop region
      const start = Math.min(dragStartTime, endTime);
      const end = Math.max(dragStartTime, endTime);

      enableLoop(start, end);
      console.log('[Loop] Created via Shift+drag:', start.toFixed(2), '-', end.toFixed(2));

      // Seek to loop start regardless of playing state
      if (callbacks.onSeek) {
        callbacks.onSeek(start);
        console.log('[Loop] Seeking to loop start:', start.toFixed(2));
      }
    } else if (!isShiftDrag) {
      // Normal click/drag - seek to position
      if (callbacks.onSeek) {
        callbacks.onSeek(endTime);
      }
    }

    isDragging = false;
    isShiftDrag = false;
  };

  container.addEventListener('mousedown', mouseDownHandler);
  document.addEventListener('mousemove', mouseMoveHandler);
  document.addEventListener('mouseup', mouseUpHandler);

  loopListeners = { container, down: mouseDownHandler, move: mouseMoveHandler, up: mouseUpHandler };
}

/**
 * Update WaveSurfer progress cursor position
 * @param {number} time - Current time in seconds
 * @param {number} duration - Total duration in seconds
 */
export function updateWaveSurferProgress(time, duration) {
  if (!wavesurfer || !duration) return;
  const progress = time / duration;
  wavesurfer.seekTo(Math.min(1, Math.max(0, progress)));
}

export function setAnchorMarker(time, duration) {
  const container = document.getElementById('waveform');
  if (!container || !duration) return;

  if (!anchorMarker) {
    anchorMarker = document.createElement('div');
    anchorMarker.className = 'anchor-marker';
    container.appendChild(anchorMarker);
  }

  const percent = (time / duration) * 100;
  anchorMarker.style.left = `${Math.min(100, Math.max(0, percent))}%`;
  anchorMarker.style.display = time > 0 ? 'block' : 'none';
}

export function clearAnchorMarker() {
  if (anchorMarker) {
    anchorMarker.style.display = 'none';
  }
}

/**
 * Update waveform display with a different audio buffer (e.g., original vs processed)
 * @param {AudioBuffer} audioBuffer - New audio buffer to display
 */
export function updateWaveformBuffer(audioBuffer) {
  if (!wavesurfer) return;

  // Create WAV blob from AudioBuffer
  const blob = audioBufferToWavBlob(audioBuffer);

  // Revoke old URL and create new one
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
  }
  currentBlobUrl = URL.createObjectURL(blob);

  // Load new audio into WaveSurfer (it will extract its own peaks)
  wavesurfer.load(currentBlobUrl);

  console.log('[Waveform] Updated with new buffer, duration:', audioBuffer.duration);
}

/**
 * Convert AudioBuffer to WAV Blob for WaveSurfer
 * @param {AudioBuffer} buffer - Source audio buffer
 * @returns {Blob} WAV blob
 */
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      // Use symmetric scaling for consistency across encoders
      const intSample = Math.round(sample * 32767);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Zoom in the waveform
 */
export function zoomIn() {
  if (!wavesurfer) return;

  if (currentZoomLevel === 0) {
    currentZoomLevel = 25;
  } else {
    currentZoomLevel = Math.min(800, currentZoomLevel * 2);
  }

  wavesurfer.zoom(currentZoomLevel);
  syncThumb();
  console.log('[Waveform] Zoom in:', currentZoomLevel);
}

/**
 * Zoom out the waveform
 */
export function zoomOut() {
  if (!wavesurfer) return;

  // Decrease zoom level
  if (currentZoomLevel <= 50) {
    // If zoomed out enough, return to auto-fit
    currentZoomLevel = 0;
  } else {
    currentZoomLevel = Math.max(25, currentZoomLevel / 2);
  }

  wavesurfer.zoom(currentZoomLevel);
  syncThumb();
  console.log('[Waveform] Zoom out:', currentZoomLevel);
}

/**
 * Reset zoom to default (auto-fit)
 */
export function resetZoom() {
  if (!wavesurfer) return;

  currentZoomLevel = 0;
  wavesurfer.zoom(currentZoomLevel);
  syncThumb();
  console.log('[Waveform] Zoom reset to auto-fit');
}

let wheelZoomInitialized = false;

/**
 * Setup mouse wheel zoom (Ctrl+Wheel) - only binds once
 */
export function setupWheelZoom() {
  if (wheelZoomInitialized) return;

  const container = document.querySelector('#waveform');
  if (!container) return;

  wheelZoomInitialized = true;
  let lastWheelZoom = 0;
  const WHEEL_ZOOM_THROTTLE_MS = 150;

  container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const now = Date.now();
      if (now - lastWheelZoom < WHEEL_ZOOM_THROTTLE_MS) return;
      lastWheelZoom = now;

      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  }, { passive: false });
}

/**
 * Enable loop mode
 * Creates a loop region from current playback position or selection
 * @param {number} start - Loop start time in seconds (optional)
 * @param {number} end - Loop end time in seconds (optional)
 */
export function enableLoop(start, end) {
  if (!wavesurfer || !regionsPlugin) return;

  // Clear existing loop region
  if (loopRegion) {
    loopRegion.remove();
    loopRegion = null;
  }

  const duration = wavesurfer.getDuration();

  // Default: 10 seconds from current cursor position
  if (start === undefined || end === undefined) {
    const cursor = wavesurfer.getCurrentTime() || 0;
    start = cursor;
    end = Math.min(cursor + 10, duration);
    // If remaining duration from cursor is too short, extend backwards
    if (end - start < 2 && cursor > 0) {
      start = Math.max(0, end - 10);
    }
  }

  // Create loop region
  loopRegion = regionsPlugin.addRegion({
    start: start,
    end: end,
    color: 'rgba(255, 159, 67, 0.2)',
    drag: true,
    resize: true
  });

  isLooping = true;
  console.log('[Loop] Enabled:', start.toFixed(2), '-', end.toFixed(2));

  return loopRegion;
}

/**
 * Disable loop mode
 */
export function disableLoop() {
  if (loopRegion) {
    loopRegion.remove();
    loopRegion = null;
  }
  isLooping = false;
  console.log('[Loop] Disabled');
}

/**
 * Toggle loop mode
 */
export function toggleLoop() {
  if (isLooping) {
    disableLoop();
  } else {
    enableLoop();
  }
  return isLooping;
}

/**
 * Get current loop state
 */
export function getLoopState() {
  return {
    isLooping,
    region: loopRegion ? {
      start: loopRegion.start,
      end: loopRegion.end
    } : null
  };
}

/**
 * Check if playback should loop
 * @param {number} currentTime - Current playback time
 * @returns {number|null} - Return to this time if looping, null otherwise
 */
export function checkLoop(currentTime) {
  if (!isLooping || !loopRegion) return null;

  // If we've passed the end of the loop region, jump back to start
  if (currentTime >= loopRegion.end) {
    return loopRegion.start;
  }

  return null;
}

function getWaveHeight() {
  const base = is2xHeight ? 200 : 100;
  return base;
}

function getContainerHeight() {
  const channelH = getWaveHeight();
  const channels = isStereoView ? 2 : 1;
  return channelH * channels;
}

function createWaveGradient(h) {
  const ctx = document.createElement('canvas').getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255, 159, 67, 0.4)');
  g.addColorStop(0.5, 'rgba(255, 159, 67, 0.6)');
  g.addColorStop(1, 'rgba(217, 119, 54, 0.3)');
  return g;
}

function createProgressGradient(h) {
  const ctx = document.createElement('canvas').getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffb366');
  g.addColorStop(0.5, '#ff9f43');
  g.addColorStop(1, '#d97736');
  return g;
}

function applyWaveformLayout() {
  if (!wavesurfer) return;

  const h = getWaveHeight();
  const containerH = getContainerHeight();
  const container = document.getElementById('waveform');
  if (container) {
    container.style.height = containerH + 'px';
  }

  const opts = {
    height: h,
    waveColor: createWaveGradient(h),
    progressColor: createProgressGradient(h),
  };

  if (isStereoView) {
    opts.splitChannels = [
      { waveColor: createWaveGradient(h), progressColor: createProgressGradient(h) },
      { waveColor: createWaveGradient(h), progressColor: createProgressGradient(h) }
    ];
  } else {
    opts.splitChannels = undefined;
  }

  wavesurfer.setOptions(opts);
}

export function toggleStereoView() {
  isStereoView = !isStereoView;
  applyWaveformLayout();
  return isStereoView;
}

export function setStereoView(enabled) {
  if (isStereoView === enabled) return;
  isStereoView = enabled;
  applyWaveformLayout();
}

export function toggle2xHeight() {
  is2xHeight = !is2xHeight;
  applyWaveformLayout();
  return is2xHeight;
}

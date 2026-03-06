import { initDSPWorker, getDSPWorker } from './workers/worker-interface.js';


import {
  measureLUFS,
  findTruePeak,
  normalizeToLUFS,
  detectDCOffsetBuffer,
  removeDCOffsetBuffer,
  getDCOffsetSeverity
} from './lib/dsp/index.js';

import { eqPresets, outputPresets } from './lib/presets/index.js';

import {
  // Controls
  eqValues,
  inputGainValue,
  ceilingValueDb,
  targetLufsDb,
  getCurrentSettings,
  getExportSettings,
  initFaders,
  faders,
  setupEQPresets,
  setupOutputPresets,
  setTargetLufs,
  dom,
  // Meters
  meterState,
  startMeter,
  stopMeter,
  updateLufsDisplay,
  setCeilingLine,
  playerState,
  formatTime,
  updatePlayPauseIcon,
  // Encoder
  encodeWAVAsync,
  // Renderer
  renderOffline,
  renderToAudioBuffer,
  // Waveform
  initWaveSurfer,
  destroyWaveSurfer,
  updateWaveSurferProgress,
  updateWaveformBuffer,
  showOriginalWaveform,
  zoomIn,
  zoomOut,
  resetZoom,
  setupWheelZoom,
  // Loop
  enableLoop,
  disableLoop,
  toggleLoop,
  getLoopState,
  checkLoop,
  // Anchor marker
  setAnchorMarker,
  clearAnchorMarker,
  // Transport DOM refs
  seekBar,
  currentTimeEl,
  durationEl,
  // Waveform view toggles
  toggleStereoView,
  setStereoView,
  toggle2xHeight
} from './ui/index.js';

import { initEQCurve, updateEQCurve, connectEQAnalyser, startEQSpectrum, stopEQSpectrum } from './ui/eq-curve.js';
import { initStereoScope, startStereoScope, stopStereoScope, cleanupStereoScope } from './ui/stereo-scope.js';

let currentFile = null;

const audioNodes = {
  context: null,
  source: null,
  buffer: null,
  analyser: null,
  analyserL: null,
  analyserR: null,
  meterSplitter: null,
  directMeterUpmix: null,
  gain: null,
  inputGain: null,
  highpass: null,
  lowshelf: null,
  highshelf: null,
  midPeak: null,
  compressor: null,
  limiter: null,
  brickwallLimiter: null,
  eqSubBass: null,
  eqLow: null,
  eqLowMid: null,
  eqMid: null,
  eqHighMid: null,
  eqHigh: null,
  eqAir: null,
  stereoSplitter: null,
  stereoMerger: null,
  midGainL: null,
  midGainR: null,
  sideGainL: null,
  sideGainR: null,
  // Direct monitoring (bypass) stereo nodes
  directStereoSplitter: null,
  directStereoMerger: null,
  directLToMid: null,
  directRToMid: null,
  directLToSide: null,
  directRToSide: null,
  // M/S matrix nodes
  lToMid: null,
  rToMid: null,
  lToSide: null,
  rToSide: null,
  midToL: null,
  midToR: null,
  sideToL: null,
  sideToR: null
};

const fileState = {
  selectedFilePath: null,
  originalBuffer: null,
  normalizedBuffer: null,
  processedBuffer: null,
  isNormalizing: false,
  isProcessingEffects: false,
  dcOffset: null,
  cachedRenderBuffer: null,
  cachedRenderLufs: null,
  isRenderingCache: false,
  cacheRenderVersion: 0
};

let isProcessing = false;
let processingCancelled = false;
let processingPromise = null;

const fileInput = document.getElementById('fileInput');

const selectFileBtn = document.getElementById('selectFile');
const changeFileBtn = document.getElementById('changeFile');
const unloadFileBtn = document.getElementById('unloadFile');
const fileZoneContent = document.getElementById('fileZoneContent');
const fileLoaded = document.getElementById('fileLoaded');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const dcOffsetBadge = document.getElementById('dcOffsetBadge');
const editedBadge = document.getElementById('editedBadge');
const dropZone = document.getElementById('dropZone');
const processBtn = document.getElementById('processBtn');
const applyBtn = document.getElementById('applyBtn');
const cancelBtn = document.getElementById('cancelBtn');
const shortcutsBtn = document.getElementById('shortcutsBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusMessage = document.getElementById('statusMessage');

let hasPendingChanges = false;
let isDimmed = false;
let monitorMode = 'lr'; // 'lr' | 'ms' | 'mono'
let limiterMode = 'normal'; // 'normal' | 'brickwall'

function createBrickwallCurve(ceiling, samples = 8192) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (2 * i / (samples - 1)) - 1; // -1 to +1
    if (x > ceiling) curve[i] = ceiling;
    else if (x < -ceiling) curve[i] = -ceiling;
    else curve[i] = x;
  }
  return curve;
}
let currentLang = 'en';
const dimBtn = document.getElementById('dimBtn');
const inputModeBtn = document.getElementById('inputModeBtn');
const inputModeLabel = inputModeBtn?.querySelector('.input-mode-label');
const langBtn = document.getElementById('langBtn');

const tooltipKR = {
  "Multiband compression to glue the mix together with balanced frequency control.":
    "Multiband Compression으로 Mix를 하나로 결합하고 주파수 밸런스를 조절합니다.",
  "Multiband dynamic processor: de-esses, tames resonances, smooths AI artifacts in the 3-12kHz range.":
    "Multiband Dynamic Processor: 3~12kHz 범위의 De-essing, Resonance 억제, AI Artifact 완화.",
  "Removes sub-bass rumble below 30Hz and fixes DC offset.":
    "30Hz 이하 Sub-bass Rumble 제거 및 DC Offset 보정.",
  "Removes ultra-high frequencies above 18kHz for cleaner sound.":
    "18kHz 이상의 초고역을 제거하여 깔끔한 사운드로.",
  "Multiband transient shaper: adds punch to kicks (low), snap to snares (mid), leaves highs alone.":
    "Multiband Transient Shaper: Kick에 Punch(저역), Snare에 Snap(중역) 추가, 고역은 유지.",
  "Stereo width: 0% = mono, 100% = original, 200% = extra wide.":
    "Stereo Width: 0% = Mono, 100% = 원본, 200% = 극대화.",
  "Narrows bass below ~200Hz for better club/speaker mono compatibility.":
    "~200Hz 이하 Bass를 Mono로 좁혀 클럽/스피커 호환성 향상.",
  "Inverts the polarity of all channels. Not recommended for general use - only use for phase correction or mono compatibility testing.":
    "모든 Channel의 Polarity를 반전합니다. 일반 사용 비권장 — Phase 보정이나 Mono 호환성 테스트용.",
  "Reduces muddy frequencies around 250Hz for clarity.":
    "250Hz 부근의 먹먹한 주파수를 줄여 명료함을 높입니다.",
  "Adds sparkle and brightness with a 12kHz high shelf boost.":
    "12kHz High Shelf Boost로 반짝임과 밝은 느낌을 추가합니다.",
  "Adds subtle tape-style saturation for analog warmth.":
    "Tape 스타일의 은은한 Saturation으로 아날로그 Warmth 추가.",
  "Tube amplifier saturation with asymmetric waveshaping for musical even harmonics.":
    "비대칭 Waveshaping의 Tube Saturation으로 음악적 Even Harmonics를 생성합니다.",
  "48kHz provides better quality through encoding pipelines.":
    "48kHz는 Encoding Pipeline에서 더 나은 품질을 제공합니다.",
  "24-bit provides more headroom through encoding.":
    "24-bit는 Encoding 시 더 넓은 Headroom을 제공합니다.",
  "44.1kHz/16-bit - Standard quality for streaming platforms (Spotify, Apple Music)":
    "44.1kHz/16-bit — Streaming 플랫폼 표준 품질 (Spotify, Apple Music)",
  "48kHz/24-bit - Professional quality for studio music production and video editing":
    "48kHz/24-bit — Studio 음악 제작 및 영상 편집용 전문 품질",
  "Adjust input level before processing. Double-click to reset to 0dB.":
    "처리 전 Input Level 조절. 더블클릭으로 0dB 초기화.",
  "Maximum peak level. -1dB is standard for streaming.":
    "최대 Peak Level. -1dB이 Streaming 표준.",
  "Intelligent gain automation that balances quiet and loud sections.":
    "조용한 구간과 큰 구간의 음량을 자동으로 밸런싱하는 Intelligent Gain Automation.",
  "Normalize loudness to target LUFS. -14 for streaming, -9 for louder masters.":
    "Target LUFS로 Loudness Normalize. Streaming -14, Loud Master -9.",
  "Target loudness: -16 (quiet) to -6 (loud). -14 for streaming, -9 is typical for modern masters.":
    "Target Loudness: -16 (조용) ~ -6 (큰). Streaming -14, 현대적 Master -9.",
  "Limits peaks to the ceiling value using soft clipper and lookahead limiter.":
    "Soft Clipper와 Lookahead Limiter를 사용하여 Peak를 Ceiling 값으로 제한합니다.",
  "Enable 4x oversampled inter-sample peak detection for broadcast-safe output.":
    "방송 안전 출력을 위한 4x Oversampled Inter-sample Peak 감지를 활성화합니다.",
  "Reverse the entire audio.":
    "전체 오디오를 Reverse합니다.",
  "Insert silence at cursor position (Coming soon)":
    "커서 위치에 Silence 삽입 (준비 중)",
  "Low shelf at 60Hz": "60Hz Low Shelf",
  "Peak at 150Hz": "150Hz Peaking",
  "Peak at 400Hz": "400Hz Peaking",
  "Peak at 1kHz": "1kHz Peaking",
  "Peak at 3kHz": "3kHz Peaking",
  "Peak at 8kHz": "8kHz Peaking",
  "High shelf at 16kHz": "16kHz High Shelf",
  "Natural signal via DynamicsCompressor. Transients may slightly exceed ceiling.":
    "DynamicsCompressor를 통한 자연스러운 신호 출력. 트랜지언트가 Ceiling을 약간 초과할 수 있음.",
  "Hard-clamps output so no sample exceeds ceiling. Improves VU meter accuracy.":
    "실시간 출력에서 어떤 샘플도 Ceiling 값을 초과하지 않도록 하드 클램핑. VU Meter 정확도 향상.",
  "L/R Pan: adjust left-right channel volume. 0 = center, negative = left, positive = right.":
    "L/R 팬: 좌우 채널 볼륨 조절. 0 = 센터, 음수 = 왼쪽, 양수 = 오른쪽.",
};

const langMenu = document.getElementById('langMenu');

function applyLanguage(lang) {
  currentLang = lang;
  langBtn.classList.toggle('active', lang !== 'en');

  langMenu.querySelectorAll('.lang-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.lang === lang);
  });

  document.querySelectorAll('[data-tip]').forEach(el => {
    if (!el.hasAttribute('data-tip-en')) {
      el.setAttribute('data-tip-en', el.getAttribute('data-tip'));
    }
    const enText = el.getAttribute('data-tip-en');
    if (lang === 'kr' && tooltipKR[enText]) {
      el.setAttribute('data-tip', tooltipKR[enText]);
    } else {
      el.setAttribute('data-tip', enText);
    }
  });
}

langBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  langMenu.classList.toggle('hidden');
});

langMenu.querySelectorAll('.lang-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    applyLanguage(opt.dataset.lang);
    langMenu.classList.add('hidden');
  });
});

document.addEventListener('click', () => {
  langMenu.classList.add('hidden');
});

function markPendingChanges() {
  hasPendingChanges = true;
  if (applyBtn) {
    applyBtn.classList.add('pending');
    applyBtn.disabled = false;
  }
}

function clearPendingChanges() {
  hasPendingChanges = false;
  if (applyBtn) {
    applyBtn.classList.remove('pending');
    applyBtn.disabled = true;
  }
}

let toastTimeout = null;
function showToast(message, type = '', duration = 5000) {
  if (toastTimeout) clearTimeout(toastTimeout);
  statusMessage.textContent = message;
  statusMessage.className = 'status-message' + (type ? ' ' + type : '');
  if (duration > 0) {
    toastTimeout = setTimeout(() => {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message';
    }, duration);
  }
}

const miniFormat = document.getElementById('mini-format');

const {
  normalizeLoudness, maximizer, truePeakLimit, cleanLowEnd, highCut,
  glueCompression, deharsh, centerBass, cutMud, addAir,
  tapeWarmth, tubeSaturator, tubeDrive, tubeMix,
  autoLevel, addPunch, phaseInvert, reverseAudio,
  stereoWidthSlider, stereoWidthValue,
  balanceSlider, balanceValue,
  sampleRate, bitDepth
} = dom;
const outputLufsDisplay = document.getElementById('outputLufs');

import { spectrogram } from './ui/spectrogram.js';

const spectroBtn = document.getElementById('spectroBtn');
const spectrogramContainer = document.getElementById('spectrogramContainer');

if (spectroBtn && spectrogramContainer) {
  spectrogram.mount('spectrogramContainer');

  spectroBtn.addEventListener('click', () => {
    spectrogramContainer.classList.toggle('hidden');
    spectroBtn.classList.toggle('active');

    if (!spectrogramContainer.classList.contains('hidden')) {
      spectrogram.start();
    } else {
      spectrogram.stop();
    }
  });
}

async function cleanupAudioContext() {
  spectrogram.stop();
  spectrogram.analyser = null;
  stopEQSpectrum();
  connectEQAnalyser(null);
  cleanupStereoScope();

  destroyWaveSurfer();

  if (playerState.isPlaying) {
    stopAudio();
  }

  // Release file buffers before allocating new ones
  fileState.originalBuffer = null;
  fileState.normalizedBuffer = null;
  fileState.processedBuffer = null;
  fileState.cachedRenderBuffer = null;
  fileState.cachedRenderLufs = null;
  fileState.isRenderingCache = false;

  if (audioNodes.context && audioNodes.context.state !== 'closed') {
    // Disconnect all nodes before closing context to break reference cycles
    Object.keys(audioNodes).forEach(key => {
      if (key !== 'context' && audioNodes[key] && typeof audioNodes[key].disconnect === 'function') {
        try { audioNodes[key].disconnect(); } catch (e) {}
      }
    });

    try {
      await audioNodes.context.close();
    } catch (e) {
      console.error('Failed to close AudioContext:', e);
      if (audioNodes.context.state !== 'closed') {
        showToast('Warning: Audio system may be unstable. Restart recommended.', 'error', 10000);
      }
    }
    Object.keys(audioNodes).forEach(key => {
      audioNodes[key] = null;
    });
  }

  // Invalidate DSP worker stage cache
  const worker = getDSPWorker();
  if (worker) {
    worker.invalidateCache();
  }
}

function initAudioContext() {
  if (!audioNodes.context) {
    audioNodes.context = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioNodes.context;
}

function createAudioChain() {
  const ctx = initAudioContext();

  audioNodes.analyser = ctx.createAnalyser();
  audioNodes.analyser.fftSize = 2048;

  spectrogram.connect(audioNodes.analyser);
  connectEQAnalyser(audioNodes.analyser);
  if (!spectrogramContainer.classList.contains('hidden')) {
    spectrogram.start();
  }

  audioNodes.analyserL = ctx.createAnalyser();
  audioNodes.analyserL.fftSize = 2048;
  audioNodes.analyserR = ctx.createAnalyser();
  audioNodes.analyserR.fftSize = 2048;
  audioNodes.meterSplitter = ctx.createChannelSplitter(2);

  audioNodes.meterSplitter.connect(audioNodes.analyserL, 0);
  audioNodes.meterSplitter.connect(audioNodes.analyserR, 1);

  initStereoScope(audioNodes.analyserL, audioNodes.analyserR, () => playerState.isPlaying);

  audioNodes.directMeterUpmix = ctx.createGain();
  audioNodes.directMeterUpmix.gain.value = 1.0;
  audioNodes.directMeterUpmix.channelCount = 2;
  audioNodes.directMeterUpmix.channelCountMode = 'explicit';
  audioNodes.directMeterUpmix.channelInterpretation = 'speakers';
  audioNodes.directMeterUpmix.connect(audioNodes.meterSplitter);

  // Direct output stereo width processing (for cached/bypass playback)
  audioNodes.directStereoSplitter = ctx.createChannelSplitter(2);
  audioNodes.directStereoMerger = ctx.createChannelMerger(2);
  audioNodes.directLToMid = ctx.createGain();
  audioNodes.directRToMid = ctx.createGain();
  audioNodes.directLToSide = ctx.createGain();
  audioNodes.directRToSide = ctx.createGain();

  audioNodes.directStereoSplitter.connect(audioNodes.directLToMid, 0);
  audioNodes.directStereoSplitter.connect(audioNodes.directLToSide, 0);
  audioNodes.directStereoSplitter.connect(audioNodes.directRToMid, 1);
  audioNodes.directStereoSplitter.connect(audioNodes.directRToSide, 1);

  audioNodes.directLToMid.connect(audioNodes.directStereoMerger, 0, 0);
  audioNodes.directRToMid.connect(audioNodes.directStereoMerger, 0, 0);
  audioNodes.directLToSide.connect(audioNodes.directStereoMerger, 0, 1);
  audioNodes.directRToSide.connect(audioNodes.directStereoMerger, 0, 1);

  // directStereoMerger → limiter connection deferred (limiter created later)

  audioNodes.inputGain = ctx.createGain();
  audioNodes.inputGain.gain.value = 1.0;
  audioNodes.gain = ctx.createGain();
  audioNodes.highpass = ctx.createBiquadFilter();
  audioNodes.lowshelf = ctx.createBiquadFilter();
  audioNodes.highshelf = ctx.createBiquadFilter();
  audioNodes.midPeak = ctx.createBiquadFilter();
  audioNodes.compressor = ctx.createDynamicsCompressor();
  audioNodes.limiter = ctx.createDynamicsCompressor();

  audioNodes.eqSubBass = ctx.createBiquadFilter();
  audioNodes.eqLow = ctx.createBiquadFilter();
  audioNodes.eqLowMid = ctx.createBiquadFilter();
  audioNodes.eqMid = ctx.createBiquadFilter();
  audioNodes.eqHighMid = ctx.createBiquadFilter();
  audioNodes.eqHigh = ctx.createBiquadFilter();
  audioNodes.eqAir = ctx.createBiquadFilter();

  audioNodes.stereoSplitter = ctx.createChannelSplitter(2);
  audioNodes.stereoMerger = ctx.createChannelMerger(2);
  audioNodes.midGainL = ctx.createGain();
  audioNodes.midGainR = ctx.createGain();
  audioNodes.sideGainL = ctx.createGain();
  audioNodes.sideGainR = ctx.createGain();
  audioNodes.lToMid = ctx.createGain();
  audioNodes.rToMid = ctx.createGain();
  audioNodes.lToSide = ctx.createGain();
  audioNodes.rToSide = ctx.createGain();
  audioNodes.midToL = ctx.createGain();
  audioNodes.midToR = ctx.createGain();
  audioNodes.sideToL = ctx.createGain();
  audioNodes.sideToR = ctx.createGain();


  audioNodes.eqSubBass.type = 'lowshelf';
  audioNodes.eqSubBass.frequency.value = 60;

  audioNodes.eqLow.type = 'peaking';
  audioNodes.eqLow.frequency.value = 150;
  audioNodes.eqLow.Q.value = 1;

  audioNodes.eqLowMid.type = 'peaking';
  audioNodes.eqLowMid.frequency.value = 400;
  audioNodes.eqLowMid.Q.value = 1;

  audioNodes.eqMid.type = 'peaking';
  audioNodes.eqMid.frequency.value = 1000;
  audioNodes.eqMid.Q.value = 1;

  audioNodes.eqHighMid.type = 'peaking';
  audioNodes.eqHighMid.frequency.value = 3000;
  audioNodes.eqHighMid.Q.value = 1;

  audioNodes.eqHigh.type = 'peaking';
  audioNodes.eqHigh.frequency.value = 8000;
  audioNodes.eqHigh.Q.value = 1;

  audioNodes.eqAir.type = 'highshelf';
  audioNodes.eqAir.frequency.value = 16000;

  audioNodes.highpass.type = 'highpass';
  audioNodes.highpass.frequency.value = 30;
  audioNodes.highpass.Q.value = 0.7;

  audioNodes.lowshelf.type = 'peaking';
  audioNodes.lowshelf.frequency.value = 250;
  audioNodes.lowshelf.Q.value = 1.5;
  audioNodes.lowshelf.gain.value = 0;

  audioNodes.highshelf.type = 'highshelf';
  audioNodes.highshelf.frequency.value = 12000;
  audioNodes.highshelf.gain.value = 0;

  audioNodes.midPeak.type = 'peaking';
  audioNodes.midPeak.frequency.value = 5000;
  audioNodes.midPeak.Q.value = 2;
  audioNodes.midPeak.gain.value = 0;

  audioNodes.compressor.threshold.value = -18;
  audioNodes.compressor.knee.value = 10;
  audioNodes.compressor.ratio.value = 3;
  audioNodes.compressor.attack.value = 0.02;
  audioNodes.compressor.release.value = 0.25;

  audioNodes.limiter.threshold.value = -1;
  audioNodes.limiter.knee.value = 0;
  audioNodes.limiter.ratio.value = 20;
  audioNodes.limiter.attack.value = 0.001;
  audioNodes.limiter.release.value = 0.05;
  audioNodes.inputGain
    .connect(audioNodes.highpass)
    .connect(audioNodes.eqSubBass)
    .connect(audioNodes.eqLow)
    .connect(audioNodes.eqLowMid)
    .connect(audioNodes.eqMid)
    .connect(audioNodes.eqHighMid)
    .connect(audioNodes.eqHigh)
    .connect(audioNodes.eqAir)
    .connect(audioNodes.lowshelf)
    .connect(audioNodes.midPeak)
    .connect(audioNodes.highshelf)
    .connect(audioNodes.compressor)
    .connect(audioNodes.stereoSplitter);

  // M/S Stereo Width Processing
  audioNodes.stereoSplitter.connect(audioNodes.lToMid, 0);
  audioNodes.stereoSplitter.connect(audioNodes.lToSide, 0);
  audioNodes.stereoSplitter.connect(audioNodes.rToMid, 1);
  audioNodes.stereoSplitter.connect(audioNodes.rToSide, 1);

  audioNodes.lToMid.connect(audioNodes.stereoMerger, 0, 0);
  audioNodes.rToMid.connect(audioNodes.stereoMerger, 0, 0);
  audioNodes.lToSide.connect(audioNodes.stereoMerger, 0, 1);
  audioNodes.rToSide.connect(audioNodes.stereoMerger, 0, 1);

  audioNodes.stereoMerger.connect(audioNodes.limiter);
  audioNodes.directStereoMerger.connect(audioNodes.limiter);

  // Create brickwall limiter (WaveShaperNode — works in all contexts)
  audioNodes.brickwallLimiter = ctx.createWaveShaper();
  audioNodes.brickwallLimiter.oversample = '4x';
  const ceilingLinear = Math.pow(10, ceilingValueDb / 20);
  if (limiterMode === 'brickwall') {
    audioNodes.brickwallLimiter.curve = createBrickwallCurve(ceilingLinear);
  }

  audioNodes.limiter.connect(audioNodes.brickwallLimiter);
  audioNodes.brickwallLimiter.connect(audioNodes.meterSplitter);
  audioNodes.brickwallLimiter.connect(audioNodes.analyser);
  audioNodes.analyser.connect(audioNodes.gain);
  audioNodes.gain.connect(ctx.destination);

  updateInputGain();
  updateAudioChain();
  updateStereoWidth();
  updateEQ();
}

async function processEffects() {
  if (!fileState.originalBuffer) return;

  audioNodes.buffer = fileState.normalizedBuffer || fileState.originalBuffer;
  markPendingChanges();
  console.log('[Preview] Heavy effects changed - Apply needed');
}

function updateOutputLufs() {
  if (fileState.cachedRenderLufs !== null) {
    updateLufsDisplay(fileState.cachedRenderLufs, false);
  } else if (fileState.isRenderingCache) {
    updateLufsDisplay(null, true);
  } else if (!fileState.originalBuffer) {
    updateLufsDisplay(null, false);
  } else {
    scheduleRenderToCache();
  }
}

function applyLiveChainParams() {
  audioNodes.highpass.frequency.value = (cleanLowEnd.checked && !playerState.isBypassed) ? 30 : 1;
  audioNodes.lowshelf.gain.value = (cutMud.checked && !playerState.isBypassed) ? -3 : 0;
  audioNodes.highshelf.gain.value = 0;
  audioNodes.midPeak.gain.value = 0;

  if (glueCompression.checked && !playerState.isBypassed) {
    audioNodes.compressor.threshold.value = -18;
    audioNodes.compressor.ratio.value = 3;
  } else {
    audioNodes.compressor.threshold.value = 0;
    audioNodes.compressor.ratio.value = 1;
  }

  if (maximizer.checked && !playerState.isBypassed) {
    audioNodes.limiter.threshold.value = ceilingValueDb;
    audioNodes.limiter.ratio.value = 20;
    audioNodes.limiter.attack.value = 0.001;
  } else {
    audioNodes.limiter.threshold.value = 0;
    audioNodes.limiter.ratio.value = 1;
  }

  // Update brickwall limiter
  if (audioNodes.brickwallLimiter) {
    if (limiterMode === 'brickwall' && !playerState.isBypassed) {
      audioNodes.brickwallLimiter.curve = createBrickwallCurve(Math.pow(10, ceilingValueDb / 20));
    } else {
      audioNodes.brickwallLimiter.curve = null;
    }
  }
}

function updateAudioChain({ scheduleCache = true } = {}) {
  if (!audioNodes.context || !audioNodes.highpass) return;

  applyLiveChainParams();

  if (scheduleCache && fileState.originalBuffer) {
    scheduleRenderToCache();
  }
}

function updateStereoWidth() {
  if (!audioNodes.stereoSplitter) return;

  const width = monitorMode === 'mono' ? 0 : (playerState.isBypassed ? 1.0 : parseInt(stereoWidthSlider.value) / 100);
  const midCoef = 0.5;
  const sideCoef = 0.5 * width;

  let lToMidG, rToMidG, lToSideG, rToSideG;

  if (monitorMode === 'ms') {
    // M/S: Left = Mid (L+R)/2, Right = Side (L-R)/2
    lToMidG = 0.5; rToMidG = 0.5;
    lToSideG = 0.5; rToSideG = -0.5;
  } else {
    // Normal L/R with stereo width
    lToMidG = midCoef + sideCoef;
    rToMidG = midCoef - sideCoef;
    lToSideG = midCoef - sideCoef;
    rToSideG = midCoef + sideCoef;
  }

  // L/R Balance: -100 = hard left, 0 = center, +100 = hard right
  const bal = playerState.isBypassed ? 0 : (parseInt(balanceSlider.value) || 0);
  if (bal !== 0 && monitorMode !== 'ms') {
    const leftFactor = bal <= 0 ? 1.0 : 1.0 - bal / 100;
    const rightFactor = bal >= 0 ? 1.0 : 1.0 + bal / 100;
    lToMidG *= leftFactor;
    rToMidG *= leftFactor;
    lToSideG *= rightFactor;
    rToSideG *= rightFactor;
  }

  // Live chain stereo nodes
  audioNodes.lToMid.gain.value = lToMidG;
  audioNodes.rToMid.gain.value = rToMidG;
  audioNodes.lToSide.gain.value = lToSideG;
  audioNodes.rToSide.gain.value = rToSideG;

  // Direct output stereo nodes (cached/bypass playback)
  if (audioNodes.directLToMid) {
    audioNodes.directLToMid.gain.value = lToMidG;
    audioNodes.directRToMid.gain.value = rToMidG;
    audioNodes.directLToSide.gain.value = lToSideG;
    audioNodes.directRToSide.gain.value = rToSideG;
  }
}

function connectAudioChain(source) {
  source.connect(audioNodes.inputGain);
}

function connectDirectToOutput(source) {
  if (audioNodes.directStereoSplitter) {
    source.connect(audioNodes.directStereoSplitter);
  } else {
    source.connect(audioNodes.analyser);
    if (audioNodes.directMeterUpmix) {
      source.connect(audioNodes.directMeterUpmix);
    }
  }
}

function updateEQ() {
  if (!audioNodes.eqSubBass) return;

  if (playerState.isBypassed) {
    audioNodes.eqSubBass.gain.value = 0;
    audioNodes.eqLow.gain.value = 0;
    audioNodes.eqLowMid.gain.value = 0;
    audioNodes.eqMid.gain.value = 0;
    audioNodes.eqHighMid.gain.value = 0;
    audioNodes.eqHigh.gain.value = 0;
    audioNodes.eqAir.gain.value = 0;
  } else {
    audioNodes.eqSubBass.gain.value = eqValues.subBass;
    audioNodes.eqLow.gain.value = eqValues.low;
    audioNodes.eqLowMid.gain.value = eqValues.lowMid;
    audioNodes.eqMid.gain.value = eqValues.mid;
    audioNodes.eqHighMid.gain.value = eqValues.highMid;
    audioNodes.eqHigh.gain.value = eqValues.high;
    audioNodes.eqAir.gain.value = eqValues.air;
  }
}

function updateInputGain() {
  if (!audioNodes.inputGain) return;
  const linear = Math.pow(10, inputGainValue / 20);
  audioNodes.inputGain.gain.setValueAtTime(linear, audioNodes.context?.currentTime || 0);
}

let cacheRenderTimeout = null;
const CACHE_RENDER_DEBOUNCE_MS = 300;

async function executeCacheRender() {
  if (!fileState.originalBuffer) return;
  if (fileState.isRenderingCache) return;

  const thisVersion = fileState.cacheRenderVersion;
  fileState.isRenderingCache = true;
  console.log('[Cache] Starting render, version:', thisVersion);

    try {
      const settings = getCurrentSettings();
      const dspWorker = getDSPWorker();
      let buffer, lufs;

      if (dspWorker && dspWorker.isReady) {
        try {
          console.log('[Cache] Using DSP worker for render');
          const inputBuffer = fileState.originalBuffer;
          const result = await dspWorker.renderFullChain(
            inputBuffer,
            settings,
            'cache',
            (progress, status) => {
              const percent = Math.round(progress * 100);
              if (outputLufsDisplay && progress < 1) {
                outputLufsDisplay.textContent = `${percent}%`;
              }
              showLoadingModal('Building cache...', 85 + percent * 0.15);
            }
          );
          buffer = result.audioBuffer;
          lufs = result.lufs;
        } catch (workerErr) {
          console.warn('[Cache] Worker render failed, falling back to main thread render:', workerErr);
          const result = await renderToAudioBuffer(fileState.originalBuffer, settings, 'export');
          buffer = result.buffer;
          lufs = result.lufs;
        }
      } else {
        // Fallback to main thread rendering
        console.log('[Cache] Falling back to main thread render');
        const result = await renderToAudioBuffer(fileState.originalBuffer, settings, 'export');
        buffer = result.buffer;
        lufs = result.lufs;
      }

      if (thisVersion === fileState.cacheRenderVersion) {
        fileState.cachedRenderBuffer = buffer;
        fileState.cachedRenderLufs = Number.isFinite(lufs) ? lufs : null;

        if (outputLufsDisplay) {
          outputLufsDisplay.textContent = Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : '-- LUFS';
        }

        if (!playerState.isPlaying) {
          audioNodes.buffer = buffer;
        }

        if (!isProcessing) {
          playBtn.disabled = false;
          stopBtn.disabled = false;
        }

        if (!playerState.isBypassed) {
          updateWaveformBuffer(buffer);
          console.log('[Cache] Updated waveform with processed buffer');
        }

        if (!isProcessing) {
          hideLoadingModal();
        }

        console.log('[Cache] Render complete, version:', thisVersion, 'LUFS:', Number.isFinite(lufs) ? lufs.toFixed(1) : 'N/A (preview)');

        if (playerState.isPlaying && !playerState.isBypassed && audioNodes.context && !isProcessing) {
          const currentTime = audioNodes.context.currentTime - playerState.startTime;
          playerState.pauseTime = Math.max(0, Math.min(currentTime, buffer.duration - 0.001));
          playAudio();
        }
      } else {
        console.log('[Cache] Render discarded (outdated version:', thisVersion, 'current:', fileState.cacheRenderVersion, ')');
      }
    } catch (err) {
      console.error('[Cache] Render error:', err);
      if (outputLufsDisplay) {
        outputLufsDisplay.textContent = '-- LUFS';
      }
      if (!isProcessing) {
        playBtn.disabled = false;
        stopBtn.disabled = false;
        hideLoadingModal();
      }
    } finally {
      fileState.isRenderingCache = false;
    }
}

function scheduleRenderToCache() {
  if (cacheRenderTimeout) {
    clearTimeout(cacheRenderTimeout);
  }

  fileState.cacheRenderVersion++;

  if (outputLufsDisplay) {
    outputLufsDisplay.textContent = '... LUFS';
  }

  cacheRenderTimeout = setTimeout(async () => {
    if (fileState.isRenderingCache) {
      scheduleRenderToCache();
      return;
    }
    await executeCacheRender();
  }, CACHE_RENDER_DEBOUNCE_MS);
}

function startMeterAnimation() {
  startMeter(audioNodes.analyserL, audioNodes.analyserR, () => playerState.isPlaying);
  startStereoScope();
  if (dom.eqSectionEnabled && dom.eqSectionEnabled.checked) {
    startEQSpectrum();
  }
}

function stopMeterAnimation() {
  stopMeter();
  stopStereoScope();
  stopEQSpectrum();
}

const loadingModal = document.getElementById('loadingModal');
const loadingText = document.getElementById('loadingText');
const loadingProgressBar = document.getElementById('loadingProgressBar');
const loadingPercent = document.getElementById('loadingPercent');
const loadingEta = document.getElementById('loadingEta');
const modalCancelBtn = document.getElementById('modalCancelBtn');

let _etaStartTime = 0;
let _etaLastPercent = 0;
let _etaSmoothed = 0;

function resetEta() {
  _etaStartTime = performance.now();
  _etaLastPercent = 0;
  _etaSmoothed = 0;
  if (loadingEta) loadingEta.textContent = '';
}

function formatEta(seconds) {
  if (seconds < 1) return 'Almost done';
  const s = Math.ceil(seconds);
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  return `~${m}m ${remainder}s remaining`;
}

function updateEta(percent) {
  if (!loadingEta || percent <= 5 || percent >= 100) {
    if (loadingEta && percent >= 100) loadingEta.textContent = '';
    return;
  }
  const elapsed = (performance.now() - _etaStartTime) / 1000;
  if (elapsed < 0.5) return;

  const fraction = percent / 100;
  const totalEstimate = elapsed / fraction;
  const remaining = totalEstimate - elapsed;

  if (_etaSmoothed <= 0) {
    _etaSmoothed = remaining;
  } else {
    _etaSmoothed = _etaSmoothed * 0.7 + remaining * 0.3;
  }
  _etaLastPercent = percent;

  loadingEta.textContent = formatEta(_etaSmoothed);
}

function showLoadingModal(text, percent, showCancel = false) {
  const numericPercent = Number(percent);
  const clamped = Number.isFinite(numericPercent) ? Math.max(0, Math.min(100, numericPercent)) : 0;
  const displayPercent = Math.round(clamped);

  loadingModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  loadingText.textContent = text;
  loadingProgressBar.style.width = `${displayPercent}%`;
  loadingPercent.textContent = `${displayPercent}%`;
  modalCancelBtn.classList.toggle('hidden', !showCancel);
  updateEta(displayPercent);
}

function hideLoadingModal() {
  loadingModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  modalCancelBtn.classList.add('hidden');
  if (loadingEta) loadingEta.textContent = '';
}

async function cancelProcessing() {
  if (!isProcessing || processingCancelled) return;

  processingCancelled = true;
  modalCancelBtn.disabled = true;
  cancelBtn.disabled = true;
  showLoadingModal('Cancelling...', 0, false);

  // Terminate the worker immediately to kill in-flight DSP work.
  // This rejects the pending renderFullChain promise with 'Cancelled',
  // which processAudio()'s catch block handles gracefully.
  const dspWorker = getDSPWorker();
  if (dspWorker && dspWorker.worker) {
    await dspWorker.cancelAndReinit();
  }

  if (processingPromise) {
    try {
      await processingPromise;
    } catch (e) {
    }
  }
}

modalCancelBtn.addEventListener('click', cancelProcessing);

function parseOriginalSampleRate(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));

    // WAV: "RIFF" header, sample rate at offset 24 (uint32 LE)
    if (magic === 'RIFF' && arrayBuffer.byteLength > 28) {
      const fmt = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
      if (fmt === 'WAVE') return view.getUint32(24, true);
    }

    // FLAC: "fLaC" magic, streaminfo block contains sample rate
    if (magic === 'fLaC' && arrayBuffer.byteLength > 22) {
      const b18 = view.getUint8(18);
      const b19 = view.getUint8(19);
      const b20 = view.getUint8(20);
      return (b18 << 12) | (b19 << 4) | (b20 >> 4);
    }

    // MP3: sync word 0xFFE0+, parse MPEG frame header
    if (arrayBuffer.byteLength > 4) {
      const scanLimit = Math.min(arrayBuffer.byteLength - 4, 4096);
      const mpegRates = {
        '3_1': [44100, 48000, 32000],
        '3_2': [44100, 48000, 32000],
        '3_3': [44100, 48000, 32000],
        '2_1': [22050, 24000, 16000],
        '2_2': [22050, 24000, 16000],
        '2_3': [22050, 24000, 16000],
        '0_1': [11025, 12000, 8000],
        '0_2': [11025, 12000, 8000],
        '0_3': [11025, 12000, 8000],
      };
      for (let i = 0; i < scanLimit; i++) {
        if (view.getUint8(i) !== 0xFF) continue;
        const b1 = view.getUint8(i + 1);
        if ((b1 & 0xE0) !== 0xE0) continue;
        const version = (b1 >> 3) & 3;
        const layer = (b1 >> 1) & 3;
        if (version === 1 || layer === 0) continue;
        const b2 = view.getUint8(i + 2);
        const rateIdx = (b2 >> 2) & 3;
        if (rateIdx === 3) continue;
        const key = `${version}_${layer}`;
        if (mpegRates[key]) return mpegRates[key][rateIdx];
      }
    }

    // M4A/AAC (MP4 container): find 'mdhd' box
    if ((magic === 'ftyp' || (arrayBuffer.byteLength > 8 &&
        String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7)) === 'ftyp'))) {
      const bytes = new Uint8Array(arrayBuffer);
      const limit = Math.min(bytes.length, 65536);
      for (let i = 0; i < limit - 8; i++) {
        if (bytes[i] === 0x6D && bytes[i+1] === 0x64 && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
          const ver = view.getUint8(i + 4);
          if (ver === 0 && i + 20 < bytes.length) {
            return view.getUint32(i + 16, false);
          } else if (ver === 1 && i + 28 < bytes.length) {
            return view.getUint32(i + 24, false);
          }
        }
      }
    }
  } catch (e) {
    // Parsing failed, return null for fallback
  }
  return null;
}

async function loadAudioFile(file) {
  const ctx = initAudioContext();

  resetEta();
  showLoadingModal('Loading audio...', 5);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const originalBlob = new Blob([arrayBuffer], { type: file.type || 'audio/mpeg' });

    fileState.originalSampleRate = parseOriginalSampleRate(arrayBuffer);

    showLoadingModal('Decoding audio...', 20);

    let decodedBuffer;
    try {
      decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (decodeError) {
      throw new Error(`Cannot decode audio file. Format may be unsupported or file is corrupted.`);
    }

    showLoadingModal('Checking DC offset...', 25);
    const dcInfo = detectDCOffsetBuffer(decodedBuffer);
    const dcSeverity = getDCOffsetSeverity(dcInfo.average.percent);

    if (dcInfo.significant) {
      console.log(`[DC Offset] Detected: ${dcInfo.average.percent.toFixed(4)}% (${dcSeverity})`);
      decodedBuffer = removeDCOffsetBuffer(decodedBuffer);
      fileState.dcOffset = {
        percent: dcInfo.average.percent,
        severity: dcSeverity,
        removed: true
      };
      console.log('[DC Offset] Removed');
    } else {
      fileState.dcOffset = {
        percent: dcInfo.average.percent,
        severity: dcSeverity,
        removed: false
      };
    }

    fileState.originalBuffer = decodedBuffer;

    // Clear cached render buffer (will be rebuilt when settings change)
    fileState.cachedRenderBuffer = null;
    fileState.cachedRenderLufs = null;
    fileState.cacheRenderVersion++;

    showLoadingModal('Measuring loudness...', 35);

    if (!fileState.originalSampleRate) {
      fileState.originalSampleRate = decodedBuffer.sampleRate;
    }

    const dspWorker = getDSPWorker();
    if (dspWorker && dspWorker.isReady) {
      const normResult = await dspWorker.normalize(
        decodedBuffer, targetLufsDb, -1,
        (progress, status) => {
          showLoadingModal(status || 'Measuring loudness...', 35 + progress * 50);
        }
      );
      fileState.originalLufs = normResult.currentLUFS;
      fileState.originalTruePeak = normResult.currentPeakDB;
      fileState.normalizedBuffer = normResult.audioBuffer;
    } else {
      const originalLufs = measureLUFS(decodedBuffer);
      const originalTruePeak = findTruePeak(decodedBuffer);
      fileState.originalLufs = originalLufs;
      fileState.originalTruePeak = originalTruePeak;
      fileState.normalizedBuffer = normalizeToLUFS(decodedBuffer, targetLufsDb);
    }

    showLoadingModal('Preparing audio...', 85);

    audioNodes.buffer = fileState.normalizedBuffer || fileState.originalBuffer;

    createAudioChain();

    const duration = audioNodes.buffer.duration;
    durationEl.textContent = formatTime(duration);
    seekBar.max = duration;

    initWaveSurfer(audioNodes.buffer, originalBlob, {
      onSeek: (time) => {
        seekBar.value = time;
        currentTimeEl.textContent = formatTime(time);
        playerState.anchorTime = time;
        setAnchorMarker(time, audioNodes.buffer?.duration);
        seekTo(time);
      },
      getBuffer: () => audioNodes.buffer,
      getPlayerState: () => playerState,
      onLoopChange: (looping) => {
        const abLoopBtn = document.getElementById('abLoopBtn');
        abLoopBtn.classList.toggle('active', looping);
        console.log('[App] A-B Loop button UI updated:', looping);
      }
    });

    setupWheelZoom();

    processBtn.disabled = false;

    const isMono = decodedBuffer.numberOfChannels === 1;
    stereoViewBtn.disabled = isMono;
    inputModeBtn.disabled = isMono;
    if (isMono) {
      setStereoView(false);
      stereoViewBtn.classList.remove('active');
      if (monitorMode !== 'lr') {
        monitorMode = 'lr';
        inputModeBtn.classList.remove('active');
        if (inputModeLabel) inputModeLabel.textContent = 'L/R';
        updateStereoWidth();
      }
    } else {
      setStereoView(true);
      stereoViewBtn.classList.add('active');
    }

    document.body.classList.add('audio-loaded');

    showLoadingModal('Building cache...', 85);

    return true;
  } catch (error) {
    console.error('Error loading audio:', error);
    hideLoadingModal();
    showToast(`Error: ${error.message}`, 'error');
    return false;
  }
}

function getPlaybackBuffer() {
  let buffer;
  let useDirectOutput = false;

  if (playerState.isBypassed) {
    const levelMatch = document.getElementById('levelMatchBtn').classList.contains('active');
    if (levelMatch) {
      buffer = fileState.normalizedBuffer || fileState.originalBuffer;
    } else {
      buffer = fileState.originalBuffer;
    }
    useDirectOutput = true;
  } else {
    if (fileState.cachedRenderBuffer) {
      buffer = fileState.cachedRenderBuffer;
      useDirectOutput = true;
    } else {
      buffer = fileState.normalizedBuffer || audioNodes.buffer;
      useDirectOutput = false;
    }
  }

  return { buffer, useDirectOutput };
}

function startSourcePlayback(playbackBuffer, useDirectOutput, offset) {
  audioNodes.source = audioNodes.context.createBufferSource();
  audioNodes.source.buffer = playbackBuffer;

  if (useDirectOutput) {
    connectDirectToOutput(audioNodes.source);
  } else {
    connectAudioChain(audioNodes.source);
  }

  audioNodes.source.onended = () => {
    if (playerState.isPlaying) {
      if (isRepeating) {
        playerState.pauseTime = 0;
        playAudio();
      } else {
        playerState.isPlaying = false;
        updatePlayPauseIcon(false);
        cancelAnimationFrame(playerState.seekUpdateInterval);
        stopMeterAnimation();
      }
    }
  };

  playerState.startTime = audioNodes.context.currentTime - offset;
  audioNodes.source.start(0, offset);

  cancelAnimationFrame(playerState.seekUpdateInterval);
  const tickPlayback = () => {
    if (playerState.isPlaying && playbackBuffer && !playerState.isSeeking) {
      const currentTime = audioNodes.context.currentTime - playerState.startTime;

      const loopTime = checkLoop(currentTime);
      if (loopTime !== null) {
        seekTo(loopTime);
        return;
      }

      if (currentTime >= playbackBuffer.duration) {
        stopAudio();
        playerState.pauseTime = 0;
        seekBar.value = 0;
        currentTimeEl.textContent = formatTime(0);
        return;
      } else {
        seekBar.value = currentTime;
        currentTimeEl.textContent = formatTime(currentTime);
        updateWaveSurferProgress(currentTime, playbackBuffer.duration);
      }
    }
    playerState.seekUpdateInterval = requestAnimationFrame(tickPlayback);
  };
  playerState.seekUpdateInterval = requestAnimationFrame(tickPlayback);
}

function playAudio() {
  if (!audioNodes.context) return;

  const loopState = getLoopState();
  if (loopState.isLooping && loopState.region && playerState.pauseTime === 0) {
    playerState.pauseTime = loopState.region.start;
  }

  const { buffer: playbackBuffer, useDirectOutput } = getPlaybackBuffer();
  if (!playbackBuffer) return;

  try {
    if (audioNodes.context.state === 'suspended') {
      audioNodes.context.resume();
    }

    stopAudio();
    startSourcePlayback(playbackBuffer, useDirectOutput, playerState.pauseTime);

    playerState.isPlaying = true;
    updatePlayPauseIcon(true);
    startMeterAnimation();
  } catch (err) {
    console.error('[Playback] Error in playAudio:', err);
    showToast(`Playback error: ${err.message}`, 'error');
    stopAudio();
  }
}

function pauseAudio() {
  if (!playerState.isPlaying) return;

  playerState.pauseTime = audioNodes.context.currentTime - playerState.startTime;
  stopAudio();
  stopMeterAnimation();
}

function stopAudio() {
  if (audioNodes.source) {
    // IMPORTANT: Clear the onended handler before stopping, otherwise a late
    // onended from the previous source can flip isPlaying=false and freeze the
    // meter/scrubber after we restart playback (e.g. when toggling FX bypass).
    const oldSource = audioNodes.source;
    audioNodes.source = null;

    try { oldSource.onended = null; } catch (e) { }
    try { oldSource.stop(); } catch (e) { }
    try { oldSource.disconnect(); } catch (e) { }
  }
  playerState.isPlaying = false;
  updatePlayPauseIcon(false);
  cancelAnimationFrame(playerState.seekUpdateInterval);
}

function seekTo(time) {
  if (playerState.isSeeking) return;
  playerState.isSeeking = true;

  playerState.pauseTime = time;

  if (playerState.isPlaying) {
    try {
      if (audioNodes.source) {
        try {
          const oldSource = audioNodes.source;
          audioNodes.source = null;
          oldSource.onended = null;
          oldSource.stop();
          oldSource.disconnect();
        } catch (e) { }
      }
      cancelAnimationFrame(playerState.seekUpdateInterval);

      const { buffer: playbackBuffer, useDirectOutput } = getPlaybackBuffer();
      startSourcePlayback(playbackBuffer, useDirectOutput, time);
    } catch (err) {
      console.error('[Playback] Error in seekTo:', err);
      showToast(`Seek error: ${err.message}`, 'error');
      stopAudio();
    }
  } else {
    currentTimeEl.textContent = formatTime(time);
    updateWaveSurferProgress(time, audioNodes.buffer?.duration);
  }

  if (playerState.seekTimeout) {
    clearTimeout(playerState.seekTimeout);
  }
  playerState.seekTimeout = setTimeout(() => {
    playerState.isSeeking = false;
    playerState.seekTimeout = null;
  }, 50);
}

selectFileBtn.addEventListener('click', () => {
  fileInput.click();
});

changeFileBtn.addEventListener('click', () => {
  stopAudio();
  playerState.pauseTime = 0;
  fileInput.click();
});

const unloadConfirmModal = document.getElementById('unloadConfirmModal');
const unloadCancelBtn = document.getElementById('unloadCancelBtn');
const unloadConfirmBtn = document.getElementById('unloadConfirmBtn');

function performUnload() {
  stopAudio();

  audioNodes.buffer = null;
  audioNodes.source = null;

  fileState.selectedFilePath = null;
  fileState.originalBuffer = null;
  fileState.normalizedBuffer = null;
  fileState.processedBuffer = null;
  fileState.cachedRenderBuffer = null;
  fileState.cachedRenderLufs = null;
  fileState.cacheRenderVersion++;

  currentFile = null;

  playerState.pauseTime = 0;
  playerState.startTime = 0;
  playerState.anchorTime = 0;
  playerState.isPlaying = false;

  clearAnchorMarker();
  destroyWaveSurfer();

  fileZoneContent.classList.remove('hidden');
  fileLoaded.classList.add('hidden');

  applyBtn.disabled = true;
  applyBtn.classList.remove('active');
  processBtn.disabled = true;

  dcOffsetBadge.classList.add('hidden');
  editedBadge.classList.add('hidden');

  fileName.textContent = 'No file';
  fileMeta.textContent = '--';
  currentTimeEl.textContent = formatTime(0);
  durationEl.textContent = formatTime(0);

  fileInput.value = '';
}

unloadFileBtn.addEventListener('click', () => {
  const isEdited = editedBadge && !editedBadge.classList.contains('hidden');
  if (isEdited) {
    unloadConfirmModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  } else {
    performUnload();
  }
});

unloadCancelBtn.addEventListener('click', () => {
  unloadConfirmModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
});

unloadConfirmBtn.addEventListener('click', () => {
  unloadConfirmModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  performUnload();
});

unloadConfirmModal.addEventListener('click', (e) => {
  if (e.target === unloadConfirmModal) {
    unloadConfirmModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    await loadFile(file);
  }
  fileInput.value = '';
});

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB

async function loadFile(file) {
  if (isProcessing) {
    showToast('Cannot load file while processing', 'error');
    return false;
  }

  if (file.size > MAX_FILE_SIZE) {
    showToast('File too large (max 1 GB)', 'error');
    return false;
  }

  try {
    await cleanupAudioContext();

    currentFile = file;
    fileState.selectedFilePath = file.name;

    const loaded = await loadAudioFile(file);

    if (loaded && audioNodes.buffer) {
      const name = file.name.substring(0, 100);
      const ext = name.split('.').pop().toUpperCase();
      const sampleRateKHz = (fileState.originalSampleRate / 1000).toFixed(1);
      const duration = formatTime(audioNodes.buffer.duration);
      const lufs = Number.isFinite(fileState.originalLufs) ? fileState.originalLufs.toFixed(1) : '--';
      const truePeak = Number.isFinite(fileState.originalTruePeak) ? fileState.originalTruePeak.toFixed(1) : '--';

      const fileSizeBytes = file.size;
      const durationSecs = audioNodes.buffer.duration;
      const estimatedBitrate = Math.round((fileSizeBytes * 8) / (durationSecs * 1000));

      fileName.textContent = name;
      fileMeta.textContent = `${ext} • ${estimatedBitrate}kbps • ${sampleRateKHz}kHz • ${lufs} LUFS • ${truePeak} dBTP • ${duration}`;

      if (dcOffsetBadge) {
        if (fileState.dcOffset?.removed) {
          dcOffsetBadge.classList.remove('hidden');
          dcOffsetBadge.title = `DC offset of ${fileState.dcOffset.percent.toFixed(3)}% was detected and removed`;
        } else {
          dcOffsetBadge.classList.add('hidden');
        }
      }

      if (editedBadge) {
        editedBadge.classList.add('hidden');
      }

      fileZoneContent.classList.add('hidden');
      fileLoaded.classList.remove('hidden');

      updateInputGain();
      updateEQ();
      updateStereoWidth();
      updateAudioChain();

      updateChecklist();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in loadFile:', error);
    showToast(`Failed to load file: ${error.message}`, 'error');
    return false;
  }
}
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (file && /\.(mp3|wav|flac|aac|m4a|mp4)$/i.test(file.name)) {
    stopAudio();
    playerState.pauseTime = 0;
    await loadFile(file);
  }
});

playBtn.addEventListener('click', () => {
  if (playerState.isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
});

stopBtn.addEventListener('click', () => {
  if (playerState.isPlaying) {
    // First stop: return to anchor position
    stopAudio();
    stopMeter();
    stopStereoScope();
    stopEQSpectrum();
    playerState.pauseTime = playerState.anchorTime;
    seekBar.value = playerState.anchorTime;
    currentTimeEl.textContent = formatTime(playerState.anchorTime);
    if (audioNodes.buffer) {
      updateWaveSurferProgress(playerState.anchorTime, audioNodes.buffer.duration);
    }
  } else {
    // Second stop: reset to beginning
    playerState.pauseTime = 0;
    playerState.anchorTime = 0;
    seekBar.value = 0;
    currentTimeEl.textContent = formatTime(0);
    clearAnchorMarker();

    if (audioNodes.buffer) {
      updateWaveSurferProgress(0, audioNodes.buffer.duration);
    }
  }
});

seekBar.addEventListener('input', () => {
  const time = parseFloat(seekBar.value);
  currentTimeEl.textContent = formatTime(time);
  playerState.anchorTime = time;
  setAnchorMarker(time, audioNodes.buffer?.duration);
});

bypassBtn.addEventListener('click', () => {
  playerState.isBypassed = !playerState.isBypassed;
  bypassBtn.classList.toggle('active', !playerState.isBypassed);

  console.log('[Bypass] Toggled to:', playerState.isBypassed ? 'OFF (original)' : 'FX ON (processed)');
  console.log('[Bypass] cachedRenderBuffer exists:', !!fileState.cachedRenderBuffer);
  console.log('[Bypass] isPlaying:', playerState.isPlaying);

  // Ensure live node params reflect bypass state (without triggering expensive cache re-render)
  updateEQ();
  updateStereoWidth();
  updateAudioChain({ scheduleCache: false });

  // Update waveform display to show original or processed
  if (playerState.isBypassed) {
    // Show original waveform (from the original file blob, not a converted AudioBuffer)
    showOriginalWaveform();
  } else {
    // Show processed waveform (if cached buffer exists)
    if (fileState.cachedRenderBuffer) {
      updateWaveformBuffer(fileState.cachedRenderBuffer);
    }
  }

  // If playing, restart playback to switch buffers (original vs processed)
  if (playerState.isPlaying) {
    console.log('[Bypass] Restarting playback to switch buffer');
    const currentTime = audioNodes.context.currentTime - playerState.startTime;
    playerState.pauseTime = currentTime;
    playAudio(); // This will use the correct buffer based on isBypassed
  }
});

const repeatBtn = document.getElementById('repeatBtn');
let isRepeating = false;
repeatBtn.addEventListener('click', () => {
  isRepeating = !isRepeating;
  repeatBtn.classList.toggle('active', isRepeating);
});

const abLoopBtn = document.getElementById('abLoopBtn');
abLoopBtn.addEventListener('click', () => {
  const looping = toggleLoop();
  abLoopBtn.classList.toggle('active', looping);
});

const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');

zoomInBtn.addEventListener('click', () => {
  zoomIn();
});

zoomOutBtn.addEventListener('click', () => {
  zoomOut();
});

zoomResetBtn.addEventListener('click', () => {
  resetZoom();
});

const stereoViewBtn = document.getElementById('stereoViewBtn');
const waveHeightBtn = document.getElementById('waveHeightBtn');

stereoViewBtn.addEventListener('click', () => {
  const active = toggleStereoView();
  stereoViewBtn.classList.toggle('active', active);
});

waveHeightBtn.addEventListener('click', () => {
  const active = toggle2xHeight();
  waveHeightBtn.classList.toggle('active', active);
});

const shortcutsModal = document.getElementById('shortcutsModal');
const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');

shortcutsBtn.addEventListener('click', () => {
  shortcutsModal.classList.remove('hidden');
});

closeShortcutsBtn.addEventListener('click', () => {
  shortcutsModal.classList.add('hidden');
});

shortcutsModal.addEventListener('click', (e) => {
  if (e.target === shortcutsModal) {
    shortcutsModal.classList.add('hidden');
  }
});

// Info modal tab switching
document.querySelectorAll('.info-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.info-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.info-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab === 'shortcuts' ? 'tabShortcuts' : 'tabAbout')?.classList.add('active');
  });
});

// Auto-update UI
if (window.electronAPI?.checkForUpdate) {
  const checkBtn = document.getElementById('checkUpdateBtn');
  const installBtn = document.getElementById('installUpdateBtn');
  const statusEl = document.getElementById('updateStatus');
  const progressWrap = document.getElementById('updateProgress');
  const progressFill = document.getElementById('updateProgressFill');
  const progressText = document.getElementById('updateProgressText');

  checkBtn.addEventListener('click', () => {
    checkBtn.disabled = true;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'update-status';
    window.electronAPI.checkForUpdate();
  });

  installBtn.addEventListener('click', () => {
    window.electronAPI.installUpdate();
  });

  window.electronAPI.onUpdateStatus(({ type, version, percent, message }) => {
    progressWrap.classList.add('hidden');
    installBtn.classList.add('hidden');
    checkBtn.disabled = false;

    switch (type) {
      case 'checking':
        statusEl.textContent = 'Checking for updates...';
        statusEl.className = 'update-status';
        checkBtn.disabled = true;
        break;
      case 'available':
        statusEl.textContent = `New version available: v${version}`;
        statusEl.className = 'update-status has-update';
        checkBtn.textContent = 'Download';
        checkBtn.onclick = () => {
          checkBtn.disabled = true;
          window.electronAPI.downloadUpdate();
        };
        break;
      case 'up-to-date':
        statusEl.textContent = 'You are on the latest version';
        statusEl.className = 'update-status up-to-date';
        break;
      case 'downloading':
        statusEl.textContent = 'Downloading update...';
        statusEl.className = 'update-status';
        checkBtn.disabled = true;
        progressWrap.classList.remove('hidden');
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
        break;
      case 'ready':
        statusEl.textContent = 'Update ready — restart to apply';
        statusEl.className = 'update-status has-update';
        installBtn.classList.remove('hidden');
        checkBtn.classList.add('hidden');
        break;
      case 'error':
        statusEl.textContent = `Update error: ${message}`;
        statusEl.className = 'update-status error';
        break;
    }
  });
} else {
  document.getElementById('checkUpdateBtn')?.classList.add('hidden');
  document.getElementById('updateStatus').textContent = 'Updates available in desktop app only';
}

processBtn.addEventListener('click', async () => {
  if (!audioNodes.buffer) {
    showToast('✗ No audio loaded', 'error');
    return;
  }

  isProcessing = true;
  processingCancelled = false;
  processBtn.disabled = true;
  modalCancelBtn.disabled = false;
  cancelBtn.disabled = false;

  processingPromise = processAudio();
  await processingPromise;
  processingPromise = null;
});

async function processAudio() {
  const settings = getExportSettings();

  if (![44100, 48000, 96000].includes(settings.sampleRate)) {
    showToast('Invalid sample rate', 'error');
    processBtn.disabled = false;
    isProcessing = false;
    return;
  }
  if (![16, 24, 32].includes(settings.bitDepth)) {
    showToast('Invalid bit depth', 'error');
    processBtn.disabled = false;
    isProcessing = false;
    return;
  }
  if (settings.stereoWidth < 0 || settings.stereoWidth > 200) {
    showToast('Invalid stereo width', 'error');
    processBtn.disabled = false;
    isProcessing = false;
    return;
  }

  const updateProgress = (percent, text) => {
    showLoadingModal(text || 'Rendering...', percent, true);
  };

  try {
    resetEta();
    showLoadingModal('Preparing audio...', 2, true);

    if (processingCancelled) {
      throw new Error('Cancelled');
    }

    if (!fileState.originalBuffer) {
      throw new Error('Audio buffer was unloaded during processing');
    }

    let outputData;

    console.log('[Export] Starting full chain render (Export Mode)...');
    showLoadingModal('Rendering audio...', 5, true);

    const dspWorker = getDSPWorker();
    if (dspWorker && dspWorker.isReady) {
      try {
        const result = await dspWorker.renderFullChain(
          fileState.originalBuffer,
          settings,
          'export',
          (progress, status) => updateProgress(Math.round(5 + progress * 80), status)
        );

        if (processingCancelled) {
          throw new Error('Cancelled');
        }

        // Resample if target sample rate differs from source
        let finalBuffer = result.audioBuffer;
        if (finalBuffer.sampleRate !== settings.sampleRate) {
          updateProgress(83, 'Resampling...');
          const numSamples = Math.ceil(finalBuffer.duration * settings.sampleRate);
          const offlineCtx = new OfflineAudioContext(finalBuffer.numberOfChannels, numSamples, settings.sampleRate);
          const src = offlineCtx.createBufferSource();
          src.buffer = finalBuffer;
          src.connect(offlineCtx.destination);
          src.start(0);
          finalBuffer = await offlineCtx.startRendering();
        }

        updateProgress(85, 'Encoding WAV...');
        await new Promise(resolve => setTimeout(resolve, 0));

        outputData = await encodeWAVAsync(finalBuffer, settings.sampleRate, settings.bitDepth, {
          onProgress: (p) => updateProgress(Math.round(85 + p * 10), 'Encoding WAV...'),
          shouldCancel: () => processingCancelled
        });
      } catch (workerErr) {
        if (processingCancelled || workerErr?.message === 'Cancelled') {
          throw workerErr;
        }
        console.warn('[Export] Worker render failed, falling back to main thread render:', workerErr);
        outputData = await renderOffline(fileState.originalBuffer, settings, updateProgress);
      }
    } else {
      outputData = await renderOffline(fileState.originalBuffer, settings, updateProgress);
    }

    if (processingCancelled) {
      throw new Error('Cancelled');
    }

    showLoadingModal('Preparing download...', 96, true);

    const blob = new Blob([outputData], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    const inputName = currentFile?.name || 'audio';
    const baseName = inputName.replace(/\.[^.]+$/, '');
    const outputName = `${baseName}_mastered.wav`;

    const a = document.createElement('a');
    a.href = url;
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showLoadingModal('Complete!', 100, false);
    setTimeout(() => {
      hideLoadingModal();
      showToast('✓ Export complete! Your mastered file is downloading.', 'success');
    }, 300);

  } catch (error) {
    hideLoadingModal();
    if (processingCancelled || error.message === 'Cancelled') {
      showToast('Export cancelled.');
    } else {
      console.error('Processing error:', error);
      showToast(`✗ Error: ${error.message || error}`, 'error');
    }
  }

  isProcessing = false;
  processBtn.disabled = false;
}

cancelBtn.addEventListener('click', cancelProcessing);

function updateChecklist() {
  const isFileLoaded = fileState.selectedFilePath !== null;
  miniFormat.classList.toggle('active', isFileLoaded);

  // Update text based on file state
  if (isFileLoaded) {
    miniFormat.innerHTML = '<span>●</span> File Ready';
  } else {
    miniFormat.innerHTML = '<span>●</span> Waiting';
  }
}

// Special handling for normalizeLoudness to switch buffers
normalizeLoudness.addEventListener('change', () => {
  if (normalizeLoudness.checked) {
    // Switch to normalized buffer if available
    if (fileState.normalizedBuffer) {
      audioNodes.buffer = fileState.normalizedBuffer;
      console.log('[Normalize] Switched to normalized buffer');
    }
  } else {
    // Switch back to original buffer
    if (fileState.originalBuffer) {
      audioNodes.buffer = fileState.originalBuffer;
      console.log('[Normalize] Switched to original buffer');
    }
  }
  updateAudioChain({ scheduleCache: false });
  updateChecklist();
  markPendingChanges(); // Normalization change requires Apply
});

// Real-time settings (live Web Audio chain updates, no cache render)
[maximizer, truePeakLimit, cleanLowEnd, highCut, glueCompression, centerBass, cutMud].forEach(el => {
  el.addEventListener('change', () => {
    updateAudioChain({ scheduleCache: false }); // Live update only
    updateChecklist();
    markPendingChanges(); // Mark for Apply
  });
});

// Maximizer toggle → enable/disable Ceiling fader + True Peak
function updateMaximizerState() {
  const isOn = maximizer.checked;
  truePeakLimit.disabled = !isOn;
  const truePeakRow = truePeakLimit.closest('.toggle-row');
  if (truePeakRow) truePeakRow.style.opacity = isOn ? '' : '0.4';
  if (faders.ceiling) faders.ceiling.setEnabled(isOn);
}
maximizer.addEventListener('change', updateMaximizerState);
updateMaximizerState();

// Limiter mode toggle (Normal / Brickwall)
document.querySelectorAll('.limiter-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    limiterMode = btn.dataset.mode;
    document.querySelectorAll('.limiter-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyLiveChainParams();
  });
});

// Heavy settings (offline processing required, Apply needed)
// Phase Invert, Deharsh, Exciter (Add Air), Tape Warmth, Auto Level, Multiband Transient (Add Punch), and Reverse Audio
// These are applied offline for preview/export parity
[phaseInvert, deharsh, addAir, tapeWarmth, tubeSaturator, autoLevel, addPunch, reverseAudio].forEach(el => {
  el.addEventListener('change', () => {
    processEffects(); // Marks pending changes
    updateChecklist();
  });
});


// Tube Saturator controls (preset buttons, drive/mix sliders)
const tubePresetDefaults = {
  warm:   { drive: 30, mix: 20 },
  bright: { drive: 25, mix: 15 },
  fat:    { drive: 35, mix: 25 },
  clean:  { drive: 15, mix: 12 }
};

function animateSlider(slider, valueEl, target, duration = 200) {
  const start = parseInt(slider.value);
  if (start === target) return;
  const startTime = performance.now();
  function tick(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const val = Math.round(start + (target - start) * eased);
    slider.value = val;
    if (valueEl) valueEl.textContent = val + '%';
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

document.querySelectorAll('.tube-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tube-preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const defaults = tubePresetDefaults[btn.dataset.tube];
    if (defaults) {
      animateSlider(tubeDrive, document.getElementById('tubeDriveValue'), defaults.drive);
      animateSlider(tubeMix, document.getElementById('tubeMixValue'), defaults.mix);
    }
    if (tubeSaturator.checked) {
      processEffects();
    }
  });
});

// Tube Saturator toggle → show/hide controls + dismiss tooltip
tubeSaturator.addEventListener('change', () => {
  const controls = document.getElementById('tubeControls');
  if (controls) controls.classList.toggle('hidden', !tubeSaturator.checked);
  const tip = document.getElementById('tooltip');
  if (tip) tip.classList.remove('visible');
});
// Initial state
const tubeControlsEl = document.getElementById('tubeControls');
if (tubeControlsEl) tubeControlsEl.classList.toggle('hidden', !tubeSaturator.checked);

[tubeDrive, tubeMix].forEach(slider => {
  const valueEl = document.getElementById(slider.id + 'Value');
  slider.addEventListener('input', () => {
    if (valueEl) valueEl.textContent = slider.value + '%';
  });
  slider.addEventListener('change', () => {
    if (tubeSaturator.checked) {
      processEffects();
    }
  });
});

// Section master toggles (Heavy setting - requires Apply)
const {
  eqSectionEnabled, polishSectionEnabled, stereoSectionEnabled,
  loudnessSectionEnabled, editSectionEnabled
} = dom;

const eqSection = document.getElementById('eqSection');
const polishSection = document.getElementById('polishSection');
const stereoSection = document.getElementById('stereoSection');
const loudnessSection = document.getElementById('loudnessSection');
const editSection = document.getElementById('editSection');

function toggleSection(checkbox, sectionElement) {
  if (checkbox.checked) {
    sectionElement.classList.remove('disabled');
  } else {
    sectionElement.classList.add('disabled');
  }
}

const sectionToggles = [eqSectionEnabled, polishSectionEnabled, stereoSectionEnabled, loudnessSectionEnabled, editSectionEnabled];
const sectionElements = [eqSection, polishSection, stereoSection, loudnessSection, editSection];

// Apply initial disabled state from HTML defaults
sectionToggles.forEach((toggle, index) => toggleSection(toggle, sectionElements[index]));

sectionToggles.forEach((toggle, index) => {
  toggle.addEventListener('change', () => {
    toggleSection(toggle, sectionElements[index]);
    processEffects(); // Marks pending changes
    updateChecklist();

    // EQ section toggle controls spectrum animation
    if (toggle === eqSectionEnabled) {
      if (toggle.checked && playerState.isPlaying) {
        startEQSpectrum();
      } else if (!toggle.checked) {
        stopEQSpectrum();
      }
    }
  });
});

const levelMatchBtn = document.getElementById('levelMatchBtn');
levelMatchBtn.classList.add('active');

levelMatchBtn.addEventListener('click', () => {
  levelMatchBtn.classList.toggle('active');

  if (playerState.isBypassed && playerState.isPlaying) {
    const currentTime = audioNodes.context.currentTime - playerState.startTime;
    playerState.pauseTime = currentTime;
    playAudio();
  }
});

inputModeBtn.addEventListener('click', () => {
  if (monitorMode === 'lr') {
    monitorMode = 'ms';
  } else if (monitorMode === 'ms') {
    monitorMode = 'mono';
  } else {
    monitorMode = 'lr';
  }
  if (inputModeLabel) inputModeLabel.textContent = monitorMode === 'ms' ? 'M/S' : monitorMode === 'mono' ? 'MONO' : 'L/R';
  inputModeBtn.classList.toggle('active', monitorMode !== 'lr');
  updateStereoWidth();
});

dimBtn.addEventListener('click', () => {
  isDimmed = !isDimmed;
  dimBtn.classList.toggle('active', isDimmed);
  if (audioNodes.gain) {
    audioNodes.gain.gain.value = isDimmed ? Math.pow(10, -8 / 20) : 1.0;
  }
});

stereoWidthSlider.addEventListener('input', () => {
  stereoWidthValue.textContent = `${stereoWidthSlider.value}%`;
  updateStereoWidth();
  updateAudioChain({ scheduleCache: false }); // Live update only
});

stereoWidthSlider.addEventListener('change', () => {
  markPendingChanges();
});

stereoWidthSlider.addEventListener('dblclick', () => {
  stereoWidthSlider.value = 100;
  stereoWidthValue.textContent = '100%';
  updateStereoWidth();
  updateAudioChain({ scheduleCache: false });
  markPendingChanges();
});

function formatBalanceLabel(val) {
  if (val === 0) return 'C';
  return val < 0 ? `L${Math.abs(val)}` : `R${val}`;
}

balanceSlider.addEventListener('input', () => {
  let val = parseInt(balanceSlider.value);
  if (Math.abs(val) <= 5) { val = 0; balanceSlider.value = 0; }
  balanceValue.textContent = formatBalanceLabel(val);
  updateStereoWidth();
  updateAudioChain({ scheduleCache: false });
});

balanceSlider.addEventListener('change', () => {
  markPendingChanges();
});

balanceSlider.addEventListener('dblclick', () => {
  balanceSlider.value = 0;
  balanceValue.textContent = 'C';
  updateStereoWidth();
  updateAudioChain({ scheduleCache: false });
  markPendingChanges();
});

applyBtn.addEventListener('click', async () => {
  if (!hasPendingChanges || !fileState.originalBuffer) return;

  isProcessing = true;
  applyBtn.disabled = true;
  playBtn.disabled = true;
  stopBtn.disabled = true;

  const wasPlaying = playerState.isPlaying;

  if (wasPlaying) {
    stopAudio();
    stopMeter();
    stopStereoScope();
    stopEQSpectrum();
  }

  try {
    resetEta();
    showLoadingModal('Applying changes...', 10);

    const currentTargetLufs = targetLufsDb;
    if (normalizeLoudness.checked) {
      showLoadingModal(`Normalizing to ${currentTargetLufs} LUFS...`, 30);

      const dspW = getDSPWorker();
      if (dspW && dspW.isReady) {
        const normRes = await dspW.normalize(
          fileState.originalBuffer, currentTargetLufs, -1,
          (progress, status) => {
            showLoadingModal(status || 'Normalizing...', 30 + progress * 30);
          }
        );
        fileState.normalizedBuffer = normRes.audioBuffer;
      } else {
        await new Promise(resolve => setTimeout(resolve, 20));
        fileState.normalizedBuffer = normalizeToLUFS(fileState.originalBuffer, currentTargetLufs);
      }

      showLoadingModal('Processing effects...', 60);
    }

    audioNodes.buffer = fileState.normalizedBuffer || fileState.originalBuffer;

    showLoadingModal('Building preview...', 75);
    if (cacheRenderTimeout) {
      clearTimeout(cacheRenderTimeout);
      cacheRenderTimeout = null;
    }
    fileState.cacheRenderVersion++;
    if (outputLufsDisplay) {
      outputLufsDisplay.textContent = '... LUFS';
    }
    await executeCacheRender();

    clearPendingChanges();
    showToast('✓ Changes applied', 'success', 2000);

    if (editedBadge) {
      editedBadge.classList.remove('hidden');
    }

  } catch (error) {
    console.error('Apply failed:', error);
    showToast(`✗ Apply failed: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
    hideLoadingModal();
    playBtn.disabled = false;
    stopBtn.disabled = false;
    applyBtn.disabled = true;

    if (wasPlaying || playerState.isPlaying) {
      stopAudio();
      stopMeter();
    stopStereoScope();
    stopEQSpectrum();
    }

    playerState.pauseTime = 0;
    seekBar.value = 0;
    currentTimeEl.textContent = formatTime(0);
    if (audioNodes.buffer) {
      updateWaveSurferProgress(0, audioNodes.buffer.duration);
    }
  }
});

[sampleRate, bitDepth].forEach(el => {
  el.addEventListener('change', () => {
    const currentRate = parseInt(sampleRate.value);
    const currentDepth = parseInt(bitDepth.value);

    document.querySelectorAll('.output-preset-btn').forEach(btn => {
      const preset = outputPresets[btn.dataset.preset];
      const isMatch = preset.sampleRate === currentRate && preset.bitDepth === currentDepth;
      btn.classList.toggle('active', isMatch);
    });
  });
});

const tooltip = document.getElementById('tooltip');
let tooltipTimeout = null;

document.querySelectorAll('[data-tip]').forEach(el => {
  el.addEventListener('mouseenter', () => {
    const tipText = el.getAttribute('data-tip');
    if (!tipText) return;

    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.textContent = tipText;

      const rect = el.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 8;

      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.classList.add('visible');

      const tooltipRect = tooltip.getBoundingClientRect();

      if (left + tooltipRect.width > window.innerWidth - 20) {
        left = window.innerWidth - tooltipRect.width - 20;
      }
      if (top + tooltipRect.height > window.innerHeight - 20) {
        top = rect.top - tooltipRect.height - 8;
      }

      tooltip.style.left = `${Math.max(10, left)}px`;
      tooltip.style.top = `${top}px`;
    }, 400);
  });

  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeout);
    tooltip.classList.remove('visible');
  });
});

window.addEventListener('beforeunload', () => {
  if (meterState.animationId) {
    cancelAnimationFrame(meterState.animationId);
    meterState.animationId = null;
  }

  if (playerState.seekUpdateInterval) {
    cancelAnimationFrame(playerState.seekUpdateInterval);
    playerState.seekUpdateInterval = null;
  }

  if (playerState.seekTimeout) {
    clearTimeout(playerState.seekTimeout);
    playerState.seekTimeout = null;
  }

  if (cacheRenderTimeout) {
    clearTimeout(cacheRenderTimeout);
    cacheRenderTimeout = null;
  }

  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }

  spectrogram.stop();
  cleanupStereoScope();

  if (audioNodes.source) {
    try {
      audioNodes.source.stop();
    } catch (e) { }
  }

  destroyWaveSurfer();

  Object.keys(faders).forEach(key => {
    if (faders[key] && typeof faders[key].destroy === 'function') {
      try {
        faders[key].destroy();
      } catch (e) { }
    }
    faders[key] = null;
  });

  const dspWorker = getDSPWorker();
  if (dspWorker) {
    dspWorker.terminate();
  }

  if (audioNodes.context && audioNodes.context.state !== 'closed') {
    try {
      audioNodes.context.close();
    } catch (e) { }
  }
});

initFaders({
  onInputGainChange: (val) => {
    updateInputGain();
    updateAudioChain({ scheduleCache: false });
  },
  onCeilingChange: (val) => {
    setCeilingLine(val);
    updateAudioChain({ scheduleCache: false });
  },
  onEQChange: (eqVals) => {
    updateEQ();
    updateEQCurve();
    updateAudioChain({ scheduleCache: false });
  },

  onInputGainChangeEnd: (val) => {
    markPendingChanges();
  },
  onCeilingChangeEnd: (val) => {
    markPendingChanges();
  },
  onTargetLufsChangeEnd: (val) => {
    markPendingChanges();
  },
  onEQChangeEnd: (eqVals) => {
    markPendingChanges();
  }
});

setCeilingLine(ceilingValueDb);

setupEQPresets(eqPresets, (eqVals) => {
  updateEQ();
  updateEQCurve();
  markPendingChanges();
});

initEQCurve();

setupOutputPresets(outputPresets);

const bitDepthOpt32 = bitDepth.querySelector('option[value="32"]');
if (bitDepthOpt32) {
  const updateBitDepthLabel = () => {
    bitDepthOpt32.textContent = bitDepth.value === '32' ? '32-bit' : '32-bit (float)';
  };
  bitDepth.addEventListener('change', updateBitDepthLabel);
  bitDepth.addEventListener('focus', () => { bitDepthOpt32.textContent = '32-bit (float)'; });
  bitDepth.addEventListener('blur', updateBitDepthLabel);
}

// Custom titlebar for Electron
if (window.electronAPI) {
  const titlebar = document.getElementById('customTitlebar');
  if (titlebar) {
    titlebar.classList.remove('hidden');
    document.body.classList.add('has-titlebar');
    document.getElementById('titlebarMin')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
    document.getElementById('titlebarMax')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
    document.getElementById('titlebarClose')?.addEventListener('click', () => window.electronAPI.closeWindow());
  }
}

updateChecklist();

initDSPWorker().then(() => {
  console.log('[App] DSP Worker initialized');
}).catch(err => {
  console.warn('[App] DSP Worker initialization failed, falling back to main thread:', err);
});

document.addEventListener('keydown', (e) => {
  // Ignore shortcuts when typing in inputs or processing
  const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
  if (isProcessing) return; // Block all shortcuts during processing

  // Space key: Play/Pause (without Shift)
  if (e.code === 'Space' && !e.shiftKey && !isTyping) {
    e.preventDefault();
    if (!playBtn.disabled) {
      playBtn.click();
    }
  }

  // Shift+Space key: Stop
  if (e.code === 'Space' && e.shiftKey && !isTyping) {
    e.preventDefault();
    if (!stopBtn.disabled) {
      stopBtn.click();
    }
  }

  // Plus/Equals key: Zoom In
  if ((e.code === 'Equal' || e.code === 'NumpadAdd') && !isTyping && !e.repeat) {
    e.preventDefault();
    zoomIn();
  }

  // Minus key: Zoom Out
  if ((e.code === 'Minus' || e.code === 'NumpadSubtract') && !isTyping && !e.repeat) {
    e.preventDefault();
    zoomOut();
  }

  // 0 key: Reset Zoom
  if ((e.code === 'Digit0' || e.code === 'Numpad0') && !isTyping && !e.repeat) {
    e.preventDefault();
    resetZoom();
  }

  // L key: Toggle A-B Loop
  if (e.code === 'KeyL' && !isTyping) {
    e.preventDefault();
    const looping = toggleLoop();
    const abLoopBtn = document.getElementById('abLoopBtn');
    abLoopBtn.classList.toggle('active', looping);
    const loopState = getLoopState();
    if (looping && loopState.region) {
      showToast(`A-B Loop: ${formatTime(loopState.region.start)} - ${formatTime(loopState.region.end)}`, 'success', 2000);
    } else {
      showToast('A-B Loop disabled', 'success', 2000);
    }
  }

  // R key: Toggle Repeat
  if (e.code === 'KeyR' && !isTyping) {
    e.preventDefault();
    isRepeating = !isRepeating;
    const repeatBtn = document.getElementById('repeatBtn');
    repeatBtn.classList.toggle('active', isRepeating);
  }

  // S or M key: Cycle Monitor Mode (L/R → M/S → Mono)
  if ((e.code === 'KeyS' || e.code === 'KeyM') && !isTyping) {
    e.preventDefault();
    inputModeBtn.click();
  }

  // D key: Toggle Dim
  if (e.code === 'KeyD' && !isTyping) {
    e.preventDefault();
    dimBtn.click();
  }
});

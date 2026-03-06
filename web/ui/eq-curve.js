import { eqValues } from './controls.js';

const EQ_BANDS = [
  { freq: 60,    type: 'lowshelf',  Q: 0.707 },
  { freq: 150,   type: 'peaking',   Q: 1.0 },
  { freq: 400,   type: 'peaking',   Q: 1.0 },
  { freq: 1000,  type: 'peaking',   Q: 1.0 },
  { freq: 3000,  type: 'peaking',   Q: 1.0 },
  { freq: 8000,  type: 'peaking',   Q: 1.0 },
  { freq: 16000, type: 'highshelf', Q: 0.707 },
];

const BAND_KEYS = ['subBass', 'low', 'lowMid', 'mid', 'highMid', 'high', 'air'];

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_MIN = -12;
const DB_MAX = 12;
const NUM_POINTS = 512;
const SPECTRUM_SMOOTHING = 0.7;

let canvas = null;
let ctx = null;
let dpr = 1;
let w = 0;
let h = 0;
let animId = null;
let analyserNode = null;
let freqData = null;
let smoothedSpectrum = null;
let isAnimating = false;
let isFading = false;
let resizeObserver = null;
const FADE_DECAY = 0.88;

function freqToX(freq) {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  return ((Math.log10(freq) - logMin) / (logMax - logMin)) * w;
}

function dbToY(db) {
  return h * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
}

// Biquad frequency response calculation (analog prototype → digital bilinear transform)
function calcBiquadResponse(freq, band, gainDb, sampleRate) {
  if (gainDb === 0 && band.type === 'peaking') return 0;

  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * band.freq / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * band.Q);

  let b0, b1, b2, a0, a1, a2;

  if (band.type === 'peaking') {
    b0 = 1 + alpha * A;
    b1 = -2 * cosW0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosW0;
    a2 = 1 - alpha / A;
  } else if (band.type === 'lowshelf') {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
    b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);
    a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;
    a1 = -2 * ((A - 1) + (A + 1) * cosW0);
    a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;
  } else {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
    b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
    a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
    a1 = 2 * ((A - 1) - (A + 1) * cosW0);
    a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;
  }

  // Normalize
  b0 /= a0; b1 /= a0; b2 /= a0;
  a1 /= a0; a2 /= a0;

  // Evaluate at target frequency
  const wt = 2 * Math.PI * freq / sampleRate;
  const cosWt = Math.cos(wt);
  const cos2Wt = Math.cos(2 * wt);
  const sinWt = Math.sin(wt);
  const sin2Wt = Math.sin(2 * wt);

  const realNum = b0 + b1 * cosWt + b2 * cos2Wt;
  const imagNum = -(b1 * sinWt + b2 * sin2Wt);
  const realDen = 1 + a1 * cosWt + a2 * cos2Wt;
  const imagDen = -(a1 * sinWt + a2 * sin2Wt);

  const magSq = (realNum * realNum + imagNum * imagNum) / (realDen * realDen + imagDen * imagDen);
  return 10 * Math.log10(magSq);
}

function computeCurve() {
  const sampleRate = 48000;
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  const points = new Float32Array(NUM_POINTS);

  for (let i = 0; i < NUM_POINTS; i++) {
    const freq = Math.pow(10, logMin + (i / (NUM_POINTS - 1)) * (logMax - logMin));
    let totalDb = 0;
    for (let b = 0; b < EQ_BANDS.length; b++) {
      totalDb += calcBiquadResponse(freq, EQ_BANDS[b], eqValues[BAND_KEYS[b]], sampleRate);
    }
    points[i] = totalDb;
  }
  return points;
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;

  // Horizontal dB lines
  const dbSteps = [-12, -9, -6, -3, 0, 3, 6, 9, 12];
  ctx.beginPath();
  for (const db of dbSteps) {
    const y = Math.round(dbToY(db)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // 0dB line (brighter)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  const zeroY = Math.round(dbToY(0)) + 0.5;
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();

  // Vertical frequency lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  const freqLines = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  ctx.beginPath();
  for (const f of freqLines) {
    const x = Math.round(freqToX(f)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();

  // Frequency labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = `${9 * dpr}px 'Inter', sans-serif`;
  ctx.textAlign = 'center';
  const labelFreqs = [100, 1000, 10000];
  const labelTexts = ['100', '1k', '10k'];
  for (let i = 0; i < labelFreqs.length; i++) {
    ctx.fillText(labelTexts[i], freqToX(labelFreqs[i]), h - 4 * dpr);
  }

  // dB labels
  ctx.textAlign = 'left';
  const dbLabels = [-12, -6, 0, 6, 12];
  for (const db of dbLabels) {
    ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 3 * dpr, dbToY(db) - 3 * dpr);
  }
}

function drawSpectrum() {
  if (!analyserNode || !freqData) return;
  if (!isAnimating && !isFading) return;

  const numBars = Math.round(w / (2 * dpr));
  if (!smoothedSpectrum || smoothedSpectrum.length !== numBars) {
    smoothedSpectrum = new Float32Array(numBars);
  }

  if (isAnimating) {
    analyserNode.getByteFrequencyData(freqData);

    const sampleRate = analyserNode.context.sampleRate;
    const binCount = analyserNode.frequencyBinCount;
    const binWidth = sampleRate / (binCount * 2);
    const logMin = Math.log10(FREQ_MIN);
    const logMax = Math.log10(FREQ_MAX);

    for (let i = 0; i < numBars; i++) {
      const t = i / (numBars - 1);
      const freq = Math.pow(10, logMin + t * (logMax - logMin));
      const bin = freq / binWidth;
      const binLow = Math.floor(bin);
      const binHigh = Math.min(binLow + 1, binCount - 1);
      const frac = bin - binLow;

      const val = binLow >= binCount ? 0 :
        freqData[binLow] * (1 - frac) + freqData[binHigh] * frac;

      const normalized = val / 255;
      smoothedSpectrum[i] = smoothedSpectrum[i] * SPECTRUM_SMOOTHING +
        normalized * (1 - SPECTRUM_SMOOTHING);
    }
  } else {
    // Fading: decay smoothed values toward zero
    let hasValue = false;
    for (let i = 0; i < numBars; i++) {
      smoothedSpectrum[i] *= FADE_DECAY;
      if (smoothedSpectrum[i] > 0.005) hasValue = true;
    }
    if (!hasValue) {
      isFading = false;
      smoothedSpectrum.fill(0);
      render();
      return;
    }
  }

  // Draw as filled curve from bottom
  ctx.beginPath();
  ctx.moveTo(0, h);

  for (let i = 0; i < numBars; i++) {
    const x = (i / (numBars - 1)) * w;
    const barH = smoothedSpectrum[i] * h * 0.85;
    ctx.lineTo(x, h - barH);
  }

  ctx.lineTo(w, h);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(238, 90, 36, 0.35)');
  gradient.addColorStop(0.5, 'rgba(238, 90, 36, 0.15)');
  gradient.addColorStop(1, 'rgba(238, 90, 36, 0.05)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Top edge line for definition
  ctx.beginPath();
  for (let i = 0; i < numBars; i++) {
    const x = (i / (numBars - 1)) * w;
    const barH = smoothedSpectrum[i] * h * 0.85;
    if (i === 0) ctx.moveTo(x, h - barH);
    else ctx.lineTo(x, h - barH);
  }
  ctx.strokeStyle = 'rgba(238, 90, 36, 0.4)';
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();
}

function drawCurve(points) {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);

  // Fill area
  ctx.beginPath();
  ctx.moveTo(0, dbToY(0));
  for (let i = 0; i < points.length; i++) {
    const freq = Math.pow(10, logMin + (i / (points.length - 1)) * (logMax - logMin));
    const x = freqToX(freq);
    const db = Math.max(DB_MIN, Math.min(DB_MAX, points[i]));
    ctx.lineTo(x, dbToY(db));
  }
  ctx.lineTo(w, dbToY(0));
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(255, 159, 67, 0.15)');
  gradient.addColorStop(0.5, 'rgba(255, 159, 67, 0.03)');
  gradient.addColorStop(1, 'rgba(255, 159, 67, 0.15)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Curve line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const freq = Math.pow(10, logMin + (i / (points.length - 1)) * (logMax - logMin));
    const x = freqToX(freq);
    const db = Math.max(DB_MIN, Math.min(DB_MAX, points[i]));
    if (i === 0) ctx.moveTo(x, dbToY(db));
    else ctx.lineTo(x, dbToY(db));
  }
  ctx.strokeStyle = '#ff9f43';
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = 'rgba(255, 159, 67, 0.5)';
  ctx.shadowBlur = 6 * dpr;
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Band dots
  for (let b = 0; b < EQ_BANDS.length; b++) {
    const gain = eqValues[BAND_KEYS[b]];
    if (gain === 0) continue;
    const x = freqToX(EQ_BANDS[b].freq);
    const y = dbToY(Math.max(DB_MIN, Math.min(DB_MAX, points[Math.round((Math.log10(EQ_BANDS[b].freq) - Math.log10(FREQ_MIN)) / (Math.log10(FREQ_MAX) - Math.log10(FREQ_MIN)) * (NUM_POINTS - 1))])));

    ctx.beginPath();
    ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#ff9f43';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 159, 67, 0.3)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  drawGrid();
  drawSpectrum();
  const points = computeCurve();
  drawCurve(points);
}

function animationLoop() {
  if (!isAnimating && !isFading) return;
  render();
  animId = requestAnimationFrame(animationLoop);
}

function resize() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  w = rect.width * dpr;
  h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;
  render();
}

export function initEQCurve() {
  canvas = document.getElementById('eqCurveCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);
}

export function connectEQAnalyser(node) {
  analyserNode = node;
  if (node) {
    freqData = new Uint8Array(node.frequencyBinCount);
    smoothedSpectrum = null;
  } else {
    freqData = null;
    smoothedSpectrum = null;
  }
}

export function startEQSpectrum() {
  isFading = false;
  if (isAnimating) return;
  isAnimating = true;
  animationLoop();
}

export function stopEQSpectrum() {
  if (!isAnimating) return;
  isAnimating = false;
  if (smoothedSpectrum && smoothedSpectrum.some(v => v > 0.005)) {
    isFading = true;
    animationLoop();
  } else {
    isFading = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    render();
  }
}

export function updateEQCurve() {
  if (!ctx) return;
  if (!isAnimating) render();
}

export function destroyEQCurve() {
  isAnimating = false;
  isFading = false;
  if (animId) cancelAnimationFrame(animId);
  window.removeEventListener('resize', resize);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  analyserNode = null;
  freqData = null;
  smoothedSpectrum = null;
  canvas = null;
  ctx = null;
}

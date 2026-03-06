const SCOPE_DEFAULTS = {
  decay: 0.92,
  dotSize: 1.5,
  gridColor: 'rgba(255, 159, 67, 0.12)',
  gridColorBright: 'rgba(255, 159, 67, 0.25)',
  indicatorColor: 'rgba(255, 159, 67, 0.55)',
  dotColor: 'rgba(255, 159, 67, 0.85)',
  labelColor: 'rgba(255, 159, 67, 0.5)',
  bgColor: '#0a0a0a'
};

let canvas = null;
let ctx = null;
let trailCanvas = null;
let trailCtx = null;
let analyserL = null;
let analyserR = null;
let animationId = null;
let isFrozen = false;
let isPlayingFn = null;
let dataL = null;
let dataR = null;
let widthSlider = null;
let dpr = 1;
let listenersAttached = false;

const MARGIN = 6;

function getWidthScale() {
  if (!widthSlider) return 1;
  return parseFloat(widthSlider.value) / 100;
}

function getDimensions() {
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const cx = w / 2;
  const cy = h / 2;
  const midR = cy - MARGIN;
  const sideRMax = cx - MARGIN;
  const sideR100 = sideRMax / 2;
  return { w, h, cx, cy, midR, sideRMax, sideR100 };
}

export function initStereoScope(analyserLeft, analyserRight, playingFn) {
  canvas = document.getElementById('stereoScope');
  if (!canvas) return;

  ctx = canvas.getContext('2d');
  analyserL = analyserLeft;
  analyserR = analyserRight;
  isPlayingFn = playingFn;

  widthSlider = document.getElementById('stereoWidth');

  // Only attach DOM listeners once to prevent accumulation
  if (!listenersAttached) {
    listenersAttached = true;

    if (widthSlider) {
      widthSlider.addEventListener('input', () => {
        if (!animationId) drawGrid();
      });
    }

    canvas.style.userSelect = 'none';
    canvas.style.cursor = 'pointer';

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isFrozen = true;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('mouseup', (e) => {
      e.preventDefault();
      isFrozen = false;
      canvas.style.cursor = 'pointer';
    });
    canvas.addEventListener('mouseleave', () => {
      if (isFrozen) {
        isFrozen = false;
        canvas.style.cursor = 'pointer';
      }
    });
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isFrozen = true;
    });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      isFrozen = false;
    });
  }

  if (!trailCanvas) {
    trailCanvas = document.createElement('canvas');
    trailCtx = trailCanvas.getContext('2d');
  }

  resizeCanvas();
  drawGrid();

  const bufLen = analyserL.fftSize;
  dataL = new Float32Array(bufLen);
  dataR = new Float32Array(bufLen);
}

function resizeCanvas() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  // Trail canvas works in CSS pixel space (no DPR scaling)
  trailCanvas.width = rect.width;
  trailCanvas.height = rect.height;
}

function drawGrid(clearBg = true) {
  if (!ctx) return;

  const { w, h, cx, cy, midR, sideRMax, sideR100 } = getDimensions();
  const ws = getWidthScale();
  const sideR = sideRMax * (ws / 2);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (clearBg) {
    ctx.fillStyle = SCOPE_DEFAULTS.bgColor;
    ctx.fillRect(0, 0, w, h);
  }

  // === FIXED GRID ===

  // Outer boundary diamond (200% max)
  ctx.strokeStyle = SCOPE_DEFAULTS.gridColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - midR);
  ctx.lineTo(cx + sideRMax, cy);
  ctx.lineTo(cx, cy + midR);
  ctx.lineTo(cx - sideRMax, cy);
  ctx.closePath();
  ctx.stroke();

  // 100% reference diamond (dashed)
  ctx.strokeStyle = SCOPE_DEFAULTS.gridColorBright;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - midR);
  ctx.lineTo(cx + sideR100, cy);
  ctx.lineTo(cx, cy + midR);
  ctx.lineTo(cx - sideR100, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Mid axis (vertical)
  ctx.strokeStyle = SCOPE_DEFAULTS.gridColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - midR);
  ctx.lineTo(cx, cy + midR);
  ctx.stroke();

  // Side axis (horizontal)
  ctx.beginPath();
  ctx.moveTo(cx - sideRMax, cy);
  ctx.lineTo(cx + sideRMax, cy);
  ctx.stroke();

  // dB diamonds (based on 100% reference)
  const dbLevels = [-6, -12, -18, -24];
  ctx.strokeStyle = SCOPE_DEFAULTS.gridColor;
  ctx.lineWidth = 0.5;
  for (const db of dbLevels) {
    const scale = Math.pow(10, db / 20);
    ctx.beginPath();
    ctx.moveTo(cx, cy - midR * scale);
    ctx.lineTo(cx + sideR100 * scale, cy);
    ctx.lineTo(cx, cy + midR * scale);
    ctx.lineTo(cx - sideR100 * scale, cy);
    ctx.closePath();
    ctx.stroke();
  }

  // dB labels
  ctx.fillStyle = SCOPE_DEFAULTS.labelColor;
  ctx.textAlign = 'left';
  ctx.font = '7px monospace';
  for (const db of dbLevels) {
    const scale = Math.pow(10, db / 20);
    ctx.fillText(`${db}`, cx + 3, cy - midR * scale + 3);
  }

  // === WIDTH INDICATOR ===

  ctx.strokeStyle = SCOPE_DEFAULTS.indicatorColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - midR);
  ctx.lineTo(cx + sideR, cy);
  ctx.lineTo(cx, cy + midR);
  ctx.lineTo(cx - sideR, cy);
  ctx.closePath();
  ctx.stroke();

  // Labels
  ctx.fillStyle = SCOPE_DEFAULTS.labelColor;
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('M', cx, cy - midR - 3);

  if (sideR > 12) {
    ctx.textAlign = 'right';
    ctx.fillText('L', cx + sideR + 1, cy - 3);
    ctx.textAlign = 'left';
    ctx.fillText('R', cx - sideR - 1, cy - 3);
  }
}

function drawFrame() {
  if (!analyserL || !analyserR || !ctx) return;

  const playing = isPlayingFn ? isPlayingFn() : false;
  if (!playing) {
    animationId = null;
    return;
  }

  if (!isFrozen) {
    analyserL.getFloatTimeDomainData(dataL);
    analyserR.getFloatTimeDomainData(dataR);
  }

  const { w, h, cx, cy, midR, sideRMax } = getDimensions();
  const ws = getWidthScale();
  const sideR = sideRMax * (ws / 2);

  if (!isFrozen) {
    // Fade trail (CSS pixel space, no DPR)
    trailCtx.globalAlpha = SCOPE_DEFAULTS.decay;
    trailCtx.drawImage(trailCanvas, 0, 0);
    trailCtx.globalAlpha = 1 - SCOPE_DEFAULTS.decay;
    trailCtx.fillStyle = SCOPE_DEFAULTS.bgColor;
    trailCtx.fillRect(0, 0, w, h);
    trailCtx.globalAlpha = 1;

    // Draw dots in CSS pixel space
    trailCtx.fillStyle = SCOPE_DEFAULTS.dotColor;
    const step = 4;
    const len = dataL.length;
    for (let i = 0; i < len; i += step) {
      const l = dataL[i];
      const r = dataR[i];
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      const x = cx + side * sideR;
      const y = cy - mid * midR;
      trailCtx.fillRect(x - 0.5, y - 0.5, SCOPE_DEFAULTS.dotSize, SCOPE_DEFAULTS.dotSize);
    }
  }

  // Composite: bg → trail → grid+indicator on top
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = SCOPE_DEFAULTS.bgColor;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(trailCanvas, 0, 0, w, h);
  drawGrid(false);

  // Frozen indicator (amber border)
  if (isFrozen) {
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  animationId = requestAnimationFrame(drawFrame);
}

export function startStereoScope() {
  if (animationId) return;
  if (!canvas || !analyserL) return;

  if (trailCtx) {
    const { w, h } = getDimensions();
    trailCtx.fillStyle = SCOPE_DEFAULTS.bgColor;
    trailCtx.fillRect(0, 0, w, h);
  }

  drawFrame();
}

export function stopStereoScope() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (ctx) drawGrid();
}

export function cleanupStereoScope() {
  stopStereoScope();
  isFrozen = false;
  canvas = null;
  ctx = null;
  trailCanvas = null;
  trailCtx = null;
  analyserL = null;
  analyserR = null;
  dataL = null;
  dataR = null;
  widthSlider = null;
}

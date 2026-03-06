/**
 * Unified Biquad Filter Module
 *
 * Audio EQ Cookbook formulas (Robert Bristow-Johnson)
 * Supports: lowpass, highpass, lowshelf, highshelf, peaking
 */

/**
 * Calculate biquad filter coefficients
 * @param {'lowpass'|'highpass'|'lowshelf'|'highshelf'|'peaking'} type
 * @param {number} freq - Frequency in Hz
 * @param {number} gainDb - Gain in dB (used by shelf/peaking types)
 * @param {number} Q - Q factor
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number}}
 */
export function calcBiquadCoeffs(type, freq, gainDb, Q, sampleRate) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;

    case 'highpass':
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;

    case 'lowshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
      b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosW0);
      a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }

    case 'highshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
      b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosW0);
      a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }

    default: // peaking
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
      break;
  }

  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0
  };
}

/**
 * Apply biquad filter (returns new array)
 * @param {Float32Array} samples
 * @param {{b0: number, b1: number, b2: number, a1: number, a2: number}} coeffs
 * @returns {Float32Array}
 */
export function applyBiquadFilter(samples, coeffs) {
  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return output;
}

/**
 * Apply biquad filter in-place (no allocation)
 * @param {Float32Array} samples
 * @param {{b0: number, b1: number, b2: number, a1: number, a2: number}} coeffs
 */
export function applyBiquadFilterInPlace(samples, coeffs) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    samples[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
}

/**
 * Apply biquad filter with persistent state (for cascaded/streaming use)
 * @param {Float32Array} samples
 * @param {{b0: number, b1: number, b2: number, a1: number, a2: number}} coeffs
 * @param {{x1: number, x2: number, y1: number, y2: number}} state - Mutable state object
 * @returns {Float32Array}
 */
export function applyBiquadWithState(samples, coeffs, state) {
  const output = new Float32Array(samples.length);
  let { x1, x2, y1, y2 } = state;
  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }

  state.x1 = x1; state.x2 = x2;
  state.y1 = y1; state.y2 = y2;
  return output;
}

/**
 * Apply biquad filter writing to pre-allocated output array (no allocation)
 * @param {Float32Array} input
 * @param {Float32Array} output - Pre-allocated output array
 * @param {{b0: number, b1: number, b2: number, a1: number, a2: number}} coeffs
 */
export function applyBiquadToBuffer(input, output, coeffs) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
}

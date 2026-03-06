// Re-export biquad functions for backward compatibility
export { applyBiquadFilter, applyBiquadFilterInPlace } from './biquad.js';
import { calcBiquadCoeffs } from './biquad.js';

/**
 * Calculate biquad coefficients for high shelf filter (K-weighting)
 * Legacy wrapper — delegates to unified biquad module
 */
export function calcHighShelfCoeffs(sampleRate, frequency, gainDB, Q) {
  return calcBiquadCoeffs('highshelf', frequency, gainDB, Q, sampleRate);
}

/**
 * Calculate biquad coefficients for high pass filter (K-weighting)
 * Legacy wrapper — delegates to unified biquad module
 */
export function calcHighPassCoeffs(sampleRate, frequency, Q) {
  return calcBiquadCoeffs('highpass', frequency, 0, Q, sampleRate);
}

/**
 * Convert dB to linear gain
 * @param {number} db - Value in dB
 * @returns {number} Linear gain
 */
export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain to dB
 * @param {number} linear - Linear gain
 * @returns {number} Value in dB
 */
export function linearToDb(linear) {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/**
 * Create a Hann window of specified size
 * @param {number} size - Window size
 * @returns {Float32Array} Hann window coefficients
 */
export function createHannWindow(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  }
  return window;
}

/**
 * Calculate RMS of a sample array
 * @param {Float32Array} samples - Input samples
 * @returns {number} RMS value
 */
export function calculateRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Find peak value in a sample array
 * @param {Float32Array} samples - Input samples
 * @returns {number} Peak absolute value
 */
export function findPeak(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}
/**
 * Catmull-Rom interpolation
 * Useful for oversampling and true-peak detection
 *
 * @param {number} y0 - Sample at t-1
 * @param {number} y1 - Sample at t=0
 * @param {number} y2 - Sample at t=1
 * @param {number} y3 - Sample at t=2
 * @param {number} t - Interpolation factor (0 to 1)
 * @returns {number} Interpolated value
 */
export function interpolateCatmullRom(y0, y1, y2, y3, t) {
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;

  const t2 = t * t;
  const t3 = t2 * t;

  return a0 * t3 + a1 * t2 + a2 * t + a3;
}

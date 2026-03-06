import { calcBiquadCoeffs, applyBiquadFilterInPlace } from './biquad.js';

/**
 * Apply biquad filter to a channel in-place
 * @param {Float32Array} data - Channel data
 * @param {'highpass'|'lowpass'} type - Filter type
 * @param {number} freq - Frequency in Hz
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} Q - Q factor
 */
export function applyBiquadToChannel(data, type, freq, sampleRate, Q) {
  const coeffs = calcBiquadCoeffs(type, freq, 0, Q, sampleRate);
  applyBiquadFilterInPlace(data, coeffs);
}

/**
 * Apply 1-pole lowpass filter (6dB/oct) in-place
 * @param {Float32Array} data - Channel data
 * @param {number} freq - Cutoff frequency in Hz
 * @param {number} sampleRate - Sample rate in Hz
 */
export function applyOnePoleLP(data, freq, sampleRate) {
  const rc = 1 / (2 * Math.PI * freq);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);

  let y = data[0] || 0;
  for (let i = 0; i < data.length; i++) {
    y = y + alpha * (data[i] - y);
    data[i] = y;
  }
}

/**
 * Apply final cleanup filters.
 *
 * Defaults:
 * - HPF 30Hz (12dB/oct): one biquad highpass
 * - LPF 18kHz (6dB/oct): one-pole lowpass
 *
 * @param {AudioBuffer} buffer - Input audio buffer
 * @param {Object} options
 * @param {boolean} [options.highpass=true] - Enable HPF
 * @param {boolean} [options.lowpass=true] - Enable LPF
 * @param {number} [options.highpassFreq=30] - HPF frequency in Hz
 * @param {number} [options.lowpassFreq=18000] - LPF frequency in Hz
 * @param {number} [options.highpassQ=0.707] - HPF Q factor
 * @returns {AudioBuffer} Filtered buffer
 */
export function applyFinalFilters(buffer, options = {}) {
  const {
    highpass = true,
    lowpass = true,
    highpassFreq = 30,
    lowpassFreq = 18000,
    highpassQ = 0.707
  } = options;

  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const outputBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length,
    sampleRate
  });

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);

    output.set(input);

    if (highpass) {
      applyBiquadToChannel(output, 'highpass', highpassFreq, sampleRate, highpassQ);
    }

    if (lowpass) {
      applyOnePoleLP(output, lowpassFreq, sampleRate);
    }
  }

  return outputBuffer;
}


import { dbToLinear, linearToDb, interpolateCatmullRom } from './utils.js';

/**
 * Soft clipper defaults
 */
export const SOFT_CLIPPER_DEFAULTS = {
  threshold: -6,      // dB - start clipping above this
  ceiling: -1.0,      // dB - absolute maximum output
  knee: 3,            // dB - soft knee width
  drive: 1.5,         // Saturation intensity (1.0 = gentle, 2.0 = aggressive)
  mix: 1.0            // Wet/dry mix (1.0 = full wet)
};

/**
 * Soft clipping curve using tanh saturation
 * @param {number} sample - Input sample
 * @param {number} threshold - Threshold in linear
 * @param {number} ceiling - Ceiling in linear
 * @param {number} drive - Drive amount
 * @param {number} knee - Knee width in linear ratio
 * @returns {number} Clipped sample
 */
function softClipSample(sample, threshold, ceiling, drive, knee) {
  const sign = Math.sign(sample);
  const abs = Math.abs(sample);

  if (abs <= threshold) {
    // Below threshold - pass through
    return sample;
  }

  // Calculate how far above threshold
  const excess = abs - threshold;
  const range = ceiling - threshold;

  if (range <= 0) {
    // Edge case - ceiling at or below threshold
    return sign * Math.min(abs, ceiling);
  }

  // Normalize excess to 0-1+ range
  const normalized = excess / range;

  // Apply tanh saturation with drive
  // tanh approaches 1 asymptotically, so output approaches ceiling
  const saturated = Math.tanh(normalized * drive);

  // Map back to threshold-ceiling range
  const output = threshold + saturated * range;

  return sign * Math.min(output, ceiling);
}

/**
 * Apply soft clipping to an AudioBuffer
 * @param {AudioBuffer} buffer - Input audio buffer
 * @param {Object} options - Clipper options
 * @param {Function} onProgress - Progress callback (0-1)
 * @returns {AudioBuffer} Clipped audio buffer
 */
export function applySoftClip(buffer, options = {}, onProgress = null) {
  const {
    threshold = SOFT_CLIPPER_DEFAULTS.threshold,
    ceiling = SOFT_CLIPPER_DEFAULTS.ceiling,
    knee = SOFT_CLIPPER_DEFAULTS.knee,
    drive = SOFT_CLIPPER_DEFAULTS.drive,
    mix = SOFT_CLIPPER_DEFAULTS.mix
  } = options;

  const thresholdLin = dbToLinear(threshold);
  const ceilingLin = dbToLinear(ceiling);
  const kneeLin = dbToLinear(knee) - 1; // Convert dB knee to ratio

  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  // Create output buffer
  const outputBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length: length,
    sampleRate: buffer.sampleRate
  });

  // Track clipping statistics
  let peakReduction = 0;
  let samplesClipped = 0;

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      const sample = input[i];
      const clipped = softClipSample(sample, thresholdLin, ceilingLin, drive, kneeLin);

      // Apply wet/dry mix
      output[i] = mix < 1 ? sample * (1 - mix) + clipped * mix : clipped;

      // Track stats
      if (Math.abs(clipped) < Math.abs(sample)) {
        samplesClipped++;
        peakReduction = Math.max(peakReduction, Math.abs(sample) - Math.abs(clipped));
      }
    }

    if (onProgress) {
      onProgress((ch + 1) / numChannels);
    }
  }

  const clippedPercent = (samplesClipped / (length * numChannels) * 100).toFixed(2);
  const reductionDb = peakReduction > 0 ? linearToDb(1 + peakReduction).toFixed(1) : '0.0';
  console.log(`[Soft Clipper] ${clippedPercent}% samples clipped, max reduction: ${reductionDb} dB`);

  return outputBuffer;
}

/**
 * Two-stage soft clipper for more transparent results
 * Stage 1: Gentle clip at higher threshold
 * Stage 2: Firmer clip closer to ceiling
 *
 * @param {AudioBuffer} buffer - Input audio buffer
 * @param {number} ceiling - Final ceiling in dB
 * @param {Function} onProgress - Progress callback
 * @returns {AudioBuffer} Clipped audio buffer
 */
export function applyTwoStageSoftClip(buffer, ceiling = -1, onProgress = null) {
  // Stage 1: Gentle clipping starting 6dB above ceiling
  let result = applySoftClip(buffer, {
    threshold: ceiling + 6,  // -7 dB if ceiling is -1
    ceiling: ceiling + 2,    // -3 dB if ceiling is -1
    drive: 1.2,
    mix: 1.0
  }, onProgress ? (p) => onProgress(p * 0.5) : null);

  // Stage 2: Firmer clipping closer to ceiling
  result = applySoftClip(result, {
    threshold: ceiling + 3,  // -4 dB if ceiling is -1
    ceiling: ceiling + 0.5,  // -0.5 dB if ceiling is -1
    drive: 1.8,
    mix: 1.0
  }, onProgress ? (p) => onProgress(0.5 + p * 0.5) : null);

  return result;
}

/**
 * Mastering-grade soft clipper with lookahead
 * Uses sample-level lookahead to catch transients before they clip
 *
 * @param {AudioBuffer} buffer - Input audio buffer
 * @param {Object} options - Clipper options
 * @param {Function} onProgress - Progress callback
 * @returns {AudioBuffer} Clipped audio buffer
 */
export function applyMasteringSoftClip(buffer, options = {}, onProgress = null) {
  const {
    ceiling = -1,           // dB
    lookaheadMs = 0.5,      // ms - very short lookahead
    releaseMs = 10,         // ms - fast release
    drive = 1.5
  } = options;

  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const ceilingLin = dbToLinear(ceiling);
  const thresholdLin = dbToLinear(ceiling + 3);
  const lookaheadSamples = Math.floor(sampleRate * lookaheadMs / 1000);
  const releaseCoef = Math.exp(-1 / (releaseMs * sampleRate / 1000));

  const outputBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length: length,
    sampleRate: sampleRate
  });

  // Gain envelope calculation
  const gainEnvelope = new Float32Array(length);
  gainEnvelope.fill(1.0);

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const abs = input[i] < 0 ? -input[i] : input[i];
      if (abs > thresholdLin) {
        const excess = abs - thresholdLin;
        const range = ceilingLin - thresholdLin;
        const normalized = excess / Math.max(range, 0.001);
        const targetLevel = thresholdLin + Math.tanh(normalized * drive) * range;
        const requiredGain = targetLevel / abs;
        const startIdx = i > lookaheadSamples ? i - lookaheadSamples : 0;
        const span = i - startIdx;
        for (let j = startIdx; j <= i; j++) {
          const t = span > 0 ? (j - startIdx) / span : 1;
          const interpolatedGain = 1.0 + (requiredGain - 1.0) * t;
          if (interpolatedGain < gainEnvelope[j]) gainEnvelope[j] = interpolatedGain;
        }
      }
    }
  }

  // Smooth gain envelope
  let currentGain = 1.0;
  for (let i = 0; i < length; i++) {
    if (gainEnvelope[i] < currentGain) {
      currentGain = gainEnvelope[i];
    } else {
      currentGain = releaseCoef * currentGain + (1 - releaseCoef);
      if (currentGain > 1.0) currentGain = 1.0;
    }
    gainEnvelope[i] = currentGain;
  }

  // Apply gain + simple saturation (no oversampling — limiter handles inter-sample peaks)
  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      let val = input[i] * gainEnvelope[i];
      const abs = val < 0 ? -val : val;
      if (abs > ceilingLin) {
        const excess = (abs - ceilingLin) / ceilingLin;
        const reduction = 1 - Math.tanh(excess * 2) * 0.1;
        const clamped = abs * reduction;
        val = val < 0 ? -(clamped < ceilingLin ? clamped : ceilingLin) : (clamped < ceilingLin ? clamped : ceilingLin);
      }
      output[i] = val;
    }
  }

  return outputBuffer;
}

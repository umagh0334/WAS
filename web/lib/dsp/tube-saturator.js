import { dbToLinear } from './utils.js';
import { calcBiquadCoeffs, applyBiquadFilter } from './biquad.js';

/**
 * Tube Saturator - Asymmetric waveshaping for musical even harmonics
 *
 * Key differences from standard tanh saturation:
 * - Asymmetric positive/negative waveshaping → even + odd harmonics
 * - Frequency-dependent processing via pre/de-emphasis
 * - Per-tube-type bias and asymmetry characteristics
 */

export const TUBE_PRESETS = {
  warm: {
    name: '12AX7 (Warm)',
    drive: 0.30,
    bias: -0.15,
    tone: -0.05,
    mix: 0.20,
    preEmphasis: { freq: 2000, gain: 1.5 },
    asymmetry: 0.5
  },
  bright: {
    name: '12AT7 (Bright)',
    drive: 0.25,
    bias: 0.10,
    tone: 0.12,
    mix: 0.15,
    preEmphasis: { freq: 3000, gain: 2.0 },
    asymmetry: 0.3
  },
  fat: {
    name: '6L6 (Fat)',
    drive: 0.35,
    bias: -0.20,
    tone: -0.10,
    mix: 0.25,
    preEmphasis: { freq: 1500, gain: 1.2 },
    asymmetry: 0.6
  },
  clean: {
    name: '12AU7 (Clean)',
    drive: 0.15,
    bias: 0.0,
    tone: 0.0,
    mix: 0.12,
    preEmphasis: { freq: 2500, gain: 1.0 },
    asymmetry: 0.2
  }
};

/**
 * Asymmetric tube waveshaping function
 * Positive half: tanh (aggressive saturation)
 * Negative half: atan (softer compression)
 * This asymmetry generates even harmonics (2nd, 4th, ...) like real tubes
 */
function tubeWaveshape(x, driveAmount, bias, asymmetry) {
  const biased = x + bias * 0.3;

  // Positive path: tanh - harder clip, more harmonics
  const pos = Math.tanh(biased * driveAmount * 2);
  // Negative path: atan - softer, rounder
  const neg = Math.atan(biased * driveAmount * 1.5) / (Math.PI / 2);

  // Blend based on asymmetry: 0 = symmetric tanh, 1 = full asymmetric
  if (biased >= 0) {
    return pos;
  } else {
    return pos * (1 - asymmetry) + neg * asymmetry;
  }
}

/**
 * Apply one-pole DC blocking filter to remove DC offset introduced by asymmetry
 */
function removeDC(samples) {
  const output = new Float32Array(samples.length);
  const R = 0.995;
  let xPrev = 0, yPrev = 0;

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] - xPrev + R * yPrev;
    xPrev = samples[i];
    yPrev = output[i];
  }

  return output;
}

/**
 * Create bypass envelope to avoid saturating quiet sections
 */
function createBypassEnvelope(buffer, thresholdDb, windowMs) {
  const sampleRate = buffer.sampleRate;
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  const numWindows = Math.ceil(buffer.length / windowSamples);
  const envelope = new Float32Array(numWindows);
  const threshold = dbToLinear(thresholdDb);
  const kneeStart = dbToLinear(thresholdDb - 6);

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSamples;
    const end = Math.min(start + windowSamples, buffer.length);
    let peak = 0;

    for (let i = start; i < end; i += 4) {
      let s = Math.abs(ch0[i]);
      if (ch1) s = Math.max(s, Math.abs(ch1[i]));
      if (s > peak) peak = s;
    }

    if (peak >= threshold) {
      envelope[w] = 1.0;
    } else if (peak >= kneeStart) {
      const r = (peak - kneeStart) / (threshold - kneeStart);
      envelope[w] = r * r;
    }
  }

  // Smooth: fast attack, slow release
  const smoothed = new Float32Array(numWindows);
  smoothed[0] = envelope[0];
  for (let i = 1; i < numWindows; i++) {
    const coef = envelope[i] > smoothed[i - 1] ? 0.5 : 0.03;
    smoothed[i] = smoothed[i - 1] + (envelope[i] - smoothed[i - 1]) * coef;
  }

  return { envelope: smoothed, windowSamples };
}

/**
 * Process a single channel through the tube saturator
 *
 * Signal chain:
 *   input → pre-emphasis (boost highs) → asymmetric waveshaping
 *   → de-emphasis (cut highs back) → tone control → DC block → mix blend
 */
function processChannel(samples, sampleRate, settings, envelope, windowSamples) {
  const { drive, bias, tone, mix, preEmphasis, asymmetry } = settings;
  const driveAmount = 1 + drive * 4; // 1x to 5x

  // Pre-emphasis: boost highs before saturation (adds harmonic content to highs)
  const preCoeffs = calcBiquadCoeffs('highshelf', preEmphasis.freq, preEmphasis.gain, 0.7, sampleRate);
  let processed = applyBiquadFilter(samples, preCoeffs);

  // Asymmetric waveshaping
  for (let i = 0; i < processed.length; i++) {
    processed[i] = tubeWaveshape(processed[i], driveAmount, bias, asymmetry);
  }

  // De-emphasis: cut highs back to original balance
  const deCoeffs = calcBiquadCoeffs('highshelf', preEmphasis.freq, -preEmphasis.gain, 0.7, sampleRate);
  processed = applyBiquadFilter(processed, deCoeffs);

  // Tone control: positive = brighter, negative = darker
  if (Math.abs(tone) > 0.01) {
    const toneGain = tone * 6; // ±6dB range
    const toneCoeffs = calcBiquadCoeffs('highshelf', 3000, toneGain, 0.7, sampleRate);
    processed = applyBiquadFilter(processed, toneCoeffs);
  }

  // DC blocking filter (asymmetric clipping introduces DC offset)
  processed = removeDC(processed);

  // Envelope-controlled dry/wet blend
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const windowIdx = Math.floor(i / windowSamples);
    const envValue = envelope[Math.min(windowIdx, envelope.length - 1)];
    const wetAmount = envValue * mix;
    output[i] = samples[i] * (1 - wetAmount) + processed[i] * wetAmount;
  }

  return output;
}

/**
 * Apply tube saturation to an AudioBuffer
 *
 * @param {AudioBuffer} buffer - Input audio
 * @param {Object} options - { preset: 'warm'|'bright'|'fat'|'clean', drive, mix, bias, tone }
 * @param {Function} onProgress - Progress callback
 * @returns {AudioBuffer} Processed audio
 */
export function applyTubeSaturation(buffer, options = {}, onProgress = null) {
  const presetName = options.preset || 'warm';
  const preset = TUBE_PRESETS[presetName] || TUBE_PRESETS.warm;

  // User overrides on top of preset
  const settings = {
    drive: options.drive ?? preset.drive,
    bias: options.bias ?? preset.bias,
    tone: options.tone ?? preset.tone,
    mix: options.mix ?? preset.mix,
    preEmphasis: preset.preEmphasis,
    asymmetry: preset.asymmetry
  };

  const { envelope, windowSamples } = createBypassEnvelope(buffer, -24, 50);

  const output = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate
  });

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const processed = processChannel(input, buffer.sampleRate, settings, envelope, windowSamples);
    output.copyToChannel(processed, ch);

    if (onProgress) onProgress((ch + 1) / buffer.numberOfChannels);
  }

  return output;
}

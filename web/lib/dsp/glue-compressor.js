/**
 * Glue Compressor (Stereo Linked)
 * Extracted from dsp-worker.js for shared use across Worker and Renderer.
 *
 * Uses stereo-linked sidechain with configurable threshold, ratio, attack, release, and knee.
 * Default values tuned for mastering glue compression.
 */

export const GLUE_COMPRESSOR_DEFAULTS = {
  threshold: -18,
  ratio: 3,
  attack: 0.02,
  release: 0.25,
  knee: 10
};

/**
 * Apply stereo-linked glue compression to an AudioBuffer.
 * @param {AudioBuffer} buffer - Input audio buffer
 * @param {Object} [options] - Compressor settings
 * @param {number} [options.threshold=-18] - Threshold in dB
 * @param {number} [options.ratio=3] - Compression ratio
 * @param {number} [options.attack=0.02] - Attack time in seconds
 * @param {number} [options.release=0.25] - Release time in seconds
 * @param {number} [options.knee=10] - Knee width in dB
 * @returns {AudioBuffer} Compressed buffer (new buffer)
 */
export function applyGlueCompressor(buffer, options = {}) {
  const {
    threshold = GLUE_COMPRESSOR_DEFAULTS.threshold,
    ratio = GLUE_COMPRESSOR_DEFAULTS.ratio,
    attack = GLUE_COMPRESSOR_DEFAULTS.attack,
    release = GLUE_COMPRESSOR_DEFAULTS.release,
  } = options;

  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  // Stereo-linked sidechain
  const sidechain = new Float32Array(length);
  if (numChannels >= 2) {
    for (let i = 0; i < length; i++) {
      sidechain[i] = (channels[0][i] + channels[1][i]) * 0.5;
    }
  } else {
    sidechain.set(channels[0]);
  }

  const thresholdLin = Math.pow(10, threshold / 20);
  const attackCoef = Math.exp(-1 / (attack * sampleRate));
  const releaseCoef = Math.exp(-1 / (release * sampleRate));

  let envelope = 0;
  const gainCurve = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const inputAbs = Math.abs(sidechain[i]);

    if (inputAbs > envelope) {
      envelope = attackCoef * envelope + (1 - attackCoef) * inputAbs;
    } else {
      envelope = releaseCoef * envelope + (1 - releaseCoef) * inputAbs;
    }

    let gain = 1.0;
    if (envelope > thresholdLin) {
      const overDB = 20 * Math.log10(envelope / thresholdLin);
      const reductionDB = overDB * (1 - 1 / ratio);
      gain = Math.pow(10, -reductionDB / 20);
    }
    gainCurve[i] = gain;
  }

  const outBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length: length,
    sampleRate: sampleRate
  });

  for (let c = 0; c < numChannels; c++) {
    const input = channels[c];
    const output = outBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      output[i] = input[i] * gainCurve[i];
    }
  }

  return outBuffer;
}

/**
 * Apply phase inversion to all channels of an audio buffer
 * Non-destructive: creates a new buffer with inverted phase
 * @param {AudioBuffer} buffer - Input audio buffer (not modified)
 * @returns {AudioBuffer} New buffer with inverted phase
 */
export function applyPhaseInvert(buffer) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  const inverted = new AudioBuffer({
    numberOfChannels: numChannels,
    length: length,
    sampleRate: sampleRate
  });

  for (let ch = 0; ch < numChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = inverted.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      dst[i] = -src[i];
    }
  }

  return inverted;
}

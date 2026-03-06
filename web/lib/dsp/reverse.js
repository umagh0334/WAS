/**
 * Reverse an audio buffer (flip sample order in each channel)
 * @param {AudioBuffer} buffer - Original audio buffer
 * @returns {AudioBuffer} - New reversed audio buffer
 */
export function reverseAudioBuffer(buffer) {
  if (!buffer) {
    throw new Error('Invalid audio buffer');
  }

  // Create new buffer with same properties
  const reversedBuffer = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate
  });

  // Reverse each channel independently
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const originalData = buffer.getChannelData(ch);
    const reversedData = reversedBuffer.getChannelData(ch);

    // Copy samples in reverse order
    for (let i = 0; i < buffer.length; i++) {
      reversedData[i] = originalData[buffer.length - 1 - i];
    }
  }

  return reversedBuffer;
}

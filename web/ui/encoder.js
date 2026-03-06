

/**
 * Async WAV encoder with progress + yielding so the UI can repaint.
 * @param {AudioBuffer} audioBuffer - Source audio buffer
 * @param {number} targetSampleRate - Target sample rate (header value)
 * @param {number} bitDepth - Bit depth (16, 24, or 32 float)
 * @param {Object} options
 * @param {(progress: number) => void} [options.onProgress] - Progress callback (0..1)
 * @param {() => boolean} [options.shouldCancel] - Return true to abort encoding
 * @param {number} [options.chunkSize] - Samples per chunk before yielding
 * @returns {Promise<Uint8Array>}
 */
export async function encodeWAVAsync(audioBuffer, targetSampleRate, bitDepth, options = {}) {
  const {
    onProgress = null,
    shouldCancel = null,
    chunkSize = 65536
  } = options || {};

  const safeBitDepth = bitDepth === 32 ? 32 : bitDepth === 24 ? 24 : 16;
  const isFloat = safeBitDepth === 32;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = targetSampleRate || audioBuffer.sampleRate;
  const bytesPerSample = safeBitDepth / 8;

  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  const numSamples = channelData[0].length;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, safeBitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const maxVal = safeBitDepth === 16 ? 32767 : 8388607;
  let offset = 44;
  const writeFloat = isFloat;
  const safeChunkSize = Math.max(1024, Number(chunkSize) || 65536);

  const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

  for (let i = 0; i < numSamples; i += safeChunkSize) {
    if (shouldCancel && shouldCancel()) {
      throw new Error('Cancelled');
    }

    const end = Math.min(i + safeChunkSize, numSamples);

    for (let s = i; s < end; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][s]));

        if (writeFloat) {
          view.setFloat32(offset, sample, true);
          offset += 4;
        } else {
          const intSample = Math.round(sample * maxVal);
          if (safeBitDepth === 16) {
            view.setInt16(offset, intSample, true);
            offset += 2;
          } else {
            const clampedSample = Math.max(-8388607, Math.min(8388607, intSample));
            view.setUint8(offset, clampedSample & 0xFF);
            view.setUint8(offset + 1, (clampedSample >> 8) & 0xFF);
            view.setUint8(offset + 2, (clampedSample >> 16) & 0xFF);
            offset += 3;
          }
        }
      }
    }

    if (onProgress) onProgress(end / numSamples);
    if (end < numSamples) {
      await yieldToUI();
    }
  }

  if (onProgress) onProgress(1);
  return new Uint8Array(buffer);
}


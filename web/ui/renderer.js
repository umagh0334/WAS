import {
  LIMITER_DEFAULTS,
  calcBiquadCoeffs,
  applyBiquadFilter,
  measureLUFS,
  normalizeToLUFS,
  applyExciter,
  applyTapeWarmth,
  processHybridDynamic,
  applyMasteringSoftClip,
  applyLookaheadLimiter,
  applyFinalFilters,
  applyDynamicLeveling,
  adjustStereoWidth,
  applyGlueCompressor,
  applyTubeSaturation,
  applyMultibandTransient,
  applyPhaseInvert,
  reverseAudioBuffer
} from '../lib/dsp/index.js';
import { encodeWAVAsync } from './encoder.js';

/**
 * Apply biquad filter to all channels of a buffer
 */
function applyBufferFilter(buffer, coeffs) {
  const result = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate
  });
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const filtered = applyBiquadFilter(buffer.getChannelData(ch), coeffs);
    result.copyToChannel(filtered, ch);
  }
  return result;
}

/**
 * Apply DSP processing chain to a buffer.
 * Full chain matching dsp-worker.js RENDER_FULL_CHAIN order:
 *   Input Gain → Phase Invert → Reverse → Deharsh → Air → Warmth → Tube → Punch → Auto Level
 *   → Final Filters → EQ + Cut Mud → Glue Compressor → Stereo → LUFS → Soft Clip → Limiter
 *
 * @param {AudioBuffer} buffer - Input buffer
 * @param {Object} settings - Processing settings
 * @param {Function} onProgress - Optional progress callback (receives 0-1 values)
 * @param {string} logPrefix - Log prefix for debugging
 * @param {string} mode - 'preview' or 'export' (affects stereo width baking)
 * @returns {{ buffer: AudioBuffer, measuredLufs: number }} Processed buffer and pre-normalize LUFS
 */
function applyDSPChain(buffer, settings, onProgress = null, logPrefix = '[DSP]', mode = 'export') {
  let renderedBuffer = buffer;

  // 0. Input Gain
  const inputGainDb = Number(settings.inputGain) || 0;
  if (inputGainDb !== 0) {
    console.log(`${logPrefix} Applying input gain (${inputGainDb} dB)...`);
    const gainLin = Math.pow(10, inputGainDb / 20);
    for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
      const channelData = renderedBuffer.getChannelData(ch);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] *= gainLin;
      }
    }
  }

  // 0.5. Phase Invert
  if (settings.stereoSectionEnabled !== false && settings.phaseInvert) {
    console.log(`${logPrefix} Applying phase invert...`);
    renderedBuffer = applyPhaseInvert(renderedBuffer);
  }

  // 0.7. Reverse Audio
  if (settings.editSectionEnabled !== false && settings.reverseAudio) {
    console.log(`${logPrefix} Reversing audio...`);
    renderedBuffer = reverseAudioBuffer(renderedBuffer);
  }

  // 1. Deharsh / Hybrid Dynamic Processor (Quick Fix)
  if (settings.deharsh) {
    console.log(`${logPrefix} Applying hybrid dynamic processor...`);
    renderedBuffer = processHybridDynamic(renderedBuffer, 'mastering', (p) => {
      if (onProgress) onProgress(p * 0.15);
    });
  }
  if (onProgress) onProgress(0.15);

  // Polish Section
  if (settings.polishSectionEnabled !== false) {
    // 2. Exciter / Add Air
    if (settings.addAir) {
      console.log(`${logPrefix} Applying exciter...`);
      renderedBuffer = applyExciter(renderedBuffer, (p) => {
        if (onProgress) onProgress(0.15 + p * 0.10);
      });
    }
    if (onProgress) onProgress(0.25);

    // 3. Multiband Saturation / Tape Warmth
    if (settings.tapeWarmth) {
      console.log(`${logPrefix} Applying multiband saturation...`);
      renderedBuffer = applyTapeWarmth(renderedBuffer, (p) => {
        if (onProgress) onProgress(0.25 + p * 0.10);
      });
    }
    if (onProgress) onProgress(0.35);

    // 3.5. Tube Saturator
    if (settings.tubeSaturator) {
      console.log(`${logPrefix} Applying tube saturation...`);
      renderedBuffer = applyTubeSaturation(renderedBuffer, {
        preset: settings.tubePreset || 'warm',
        drive: settings.tubeDrive,
        mix: settings.tubeMix
      });
    }
    if (onProgress) onProgress(0.45);
  } else {
    console.log(`${logPrefix} Polish section disabled, skipping...`);
    if (onProgress) onProgress(0.45);
  }

  // 4. Multiband Transient / Add Punch (Quick Fix)
  if (settings.addPunch) {
    console.log(`${logPrefix} Applying multiband transient...`);
    renderedBuffer = applyMultibandTransient(renderedBuffer, (p) => {
      if (onProgress) onProgress(0.45 + p * 0.05);
    });
  }
  if (onProgress) onProgress(0.50);

  // 4.5. Auto Level (Dynamic Leveling)
  if (settings.loudnessSectionEnabled !== false && settings.autoLevel) {
    console.log(`${logPrefix} Applying auto level...`);
    renderedBuffer = applyDynamicLeveling(renderedBuffer);
  }
  if (onProgress) onProgress(0.53);

  // 5. Final Filters (HPF 30Hz + LPF 18kHz)
  const hasHPF = !!settings.cleanLowEnd;
  const hasLPF = !!settings.highCut;
  if (hasHPF || hasLPF) {
    console.log(`${logPrefix} Applying final filters (HPF:${hasHPF} LPF:${hasLPF})...`);
    renderedBuffer = applyFinalFilters(renderedBuffer, {
      highpass: hasHPF,
      lowpass: hasLPF
    });
  }
  if (onProgress) onProgress(0.55);

  // 6. EQ (7-Band) + Cut Mud
  if (settings.eqSectionEnabled !== false) {
    const sampleRate = renderedBuffer.sampleRate;
    const bands = [
      { type: 'lowshelf',  freq: 60,    gain: Number(settings.eqSubBass) || 0, Q: 1.0 },
      { type: 'peaking',   freq: 150,   gain: Number(settings.eqLow) || 0,     Q: 1.0 },
      { type: 'peaking',   freq: 400,   gain: Number(settings.eqLowMid) || 0,  Q: 1.0 },
      { type: 'peaking',   freq: 1000,  gain: Number(settings.eqMid) || 0,     Q: 1.0 },
      { type: 'peaking',   freq: 3000,  gain: Number(settings.eqHighMid) || 0, Q: 1.0 },
      { type: 'peaking',   freq: 8000,  gain: Number(settings.eqHigh) || 0,    Q: 1.0 },
      { type: 'highshelf', freq: 16000, gain: Number(settings.eqAir) || 0,     Q: 1.0 }
    ];

    for (const band of bands) {
      if (band.gain === 0) continue;
      const coeffs = calcBiquadCoeffs(band.type, band.freq, band.gain, band.Q, sampleRate);
      renderedBuffer = applyBufferFilter(renderedBuffer, coeffs);
    }
    console.log(`${logPrefix} Applied EQ...`);
  }

  if (settings.polishSectionEnabled !== false && settings.cutMud) {
    const coeffs = calcBiquadCoeffs('peaking', 250, -3.0, 1.5, renderedBuffer.sampleRate);
    renderedBuffer = applyBufferFilter(renderedBuffer, coeffs);
    console.log(`${logPrefix} Applied Cut Mud...`);
  }
  if (onProgress) onProgress(0.60);

  // 7. Glue Compressor
  if (settings.glueCompression) {
    console.log(`${logPrefix} Applying glue compressor...`);
    renderedBuffer = applyGlueCompressor(renderedBuffer);
  }
  if (onProgress) onProgress(0.63);

  // 7.5. Stereo Processing (Width + Center Bass)
  if (renderedBuffer.numberOfChannels === 2 && settings.stereoSectionEnabled !== false) {
    const bassMono = !!settings.centerBass;
    const stereoWidthValue = Number(settings.stereoWidth);
    const width = Number.isFinite(stereoWidthValue) ? stereoWidthValue / 100 : 1.0;
    const clampedWidth = Math.max(0, Math.min(2, width));
    const applyWidth = mode === 'export' && Math.abs(clampedWidth - 1.0) > 1e-6;

    if (bassMono || applyWidth) {
      console.log(`${logPrefix} Applying stereo processing (width:${applyWidth ? clampedWidth : '1.0'} bassMono:${bassMono})...`);
      renderedBuffer = adjustStereoWidth(renderedBuffer, applyWidth ? clampedWidth : 1.0, bassMono, 200);
    }

    // L/R Balance
    const bal = Number(settings.balance) || 0;
    if (bal !== 0 && renderedBuffer.numberOfChannels === 2) {
      const leftFactor = bal <= 0 ? 1.0 : 1.0 - bal / 100;
      const rightFactor = bal >= 0 ? 1.0 : 1.0 + bal / 100;
      const L = renderedBuffer.getChannelData(0);
      const R = renderedBuffer.getChannelData(1);
      for (let i = 0; i < L.length; i++) { L[i] *= leftFactor; }
      for (let i = 0; i < R.length; i++) { R[i] *= rightFactor; }
    }
  }
  if (onProgress) onProgress(0.65);

  // 8. Measure LUFS (after all processing, before normalization)
  const measuredLufs = measureLUFS(renderedBuffer);
  console.log(`${logPrefix} Measured LUFS:`, Number.isFinite(measuredLufs) ? measuredLufs.toFixed(1) : 'N/A');

  // Loudness Section
  if (settings.loudnessSectionEnabled !== false) {
    // 9. Normalize to target LUFS
    if (settings.normalizeLoudness && settings.targetLufs) {
      console.log(`${logPrefix} Normalizing to target LUFS:`, settings.targetLufs);
      renderedBuffer = normalizeToLUFS(renderedBuffer, settings.targetLufs, 0, { skipLimiter: true });
    }
    if (onProgress) onProgress(0.75);

    // 10. Soft Clipper + Limiter (gated by maximizer)
    if (settings.maximizer) {
      const ceiling = settings.truePeakCeiling || -1;

      console.log(`${logPrefix} Applying mastering soft clip (ceiling:`, ceiling, 'dB)...');
      renderedBuffer = applyMasteringSoftClip(renderedBuffer, {
        ceiling: ceiling,
        lookaheadMs: 0.5,
        releaseMs: 10,
        drive: 1.5
      }, (p) => {
        if (onProgress) onProgress(0.75 + p * 0.10);
      });
      if (onProgress) onProgress(0.85);

      const ceilingLinear = Math.pow(10, ceiling / 20);
      console.log(`${logPrefix} Applying limiter (ceiling:`, ceiling, 'dB)...');
      renderedBuffer = applyLookaheadLimiter(
        renderedBuffer,
        ceilingLinear,
        LIMITER_DEFAULTS.LOOKAHEAD_MS,
        LIMITER_DEFAULTS.RELEASE_MS,
        LIMITER_DEFAULTS.KNEE_DB,
        true,
        !!settings.truePeakLimit
      );
    }
    if (onProgress) onProgress(1.0);
  } else {
    console.log(`${logPrefix} Loudness section disabled, skipping...`);
    if (onProgress) onProgress(1.0);
  }

  return { buffer: renderedBuffer, measuredLufs };
}

/**
 * Render audio buffer through full DSP chain and encode to WAV.
 * @param {AudioBuffer} sourceBuffer - Source audio buffer
 * @param {Object} settings - Processing settings
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<Uint8Array>} WAV file data
 */
export async function renderOffline(sourceBuffer, settings, onProgress) {
  const targetSampleRate = settings.sampleRate || 44100;

  console.log('[Offline Render] Starting...', {
    duration: sourceBuffer.duration,
    targetSampleRate,
    numSamples: Math.ceil(sourceBuffer.duration * targetSampleRate)
  });

  if (onProgress) onProgress(5);

  // Resample if needed via OfflineAudioContext (passthrough, no processing nodes)
  let renderBuffer;
  if (sourceBuffer.sampleRate !== targetSampleRate) {
    const numSamples = Math.ceil(sourceBuffer.duration * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(sourceBuffer.numberOfChannels, numSamples, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    renderBuffer = await offlineCtx.startRendering();
  } else {
    // Clone buffer to avoid mutating original
    renderBuffer = new AudioBuffer({
      numberOfChannels: sourceBuffer.numberOfChannels,
      length: sourceBuffer.length,
      sampleRate: sourceBuffer.sampleRate
    });
    for (let ch = 0; ch < sourceBuffer.numberOfChannels; ch++) {
      renderBuffer.copyToChannel(sourceBuffer.getChannelData(ch), ch);
    }
  }

  if (onProgress) onProgress(10);
  await new Promise(resolve => setTimeout(resolve, 0));

  // Apply full DSP chain (matches dsp-worker.js order exactly)
  const dspResult = applyDSPChain(renderBuffer, settings, (p) => {
    if (onProgress) onProgress(10 + p * 65);
  }, '[Offline Render]', 'export');
  renderBuffer = dspResult.buffer;

  if (onProgress) onProgress(75);
  await new Promise(resolve => setTimeout(resolve, 0));

  // Encode to WAV
  const wavData = await encodeWAVAsync(renderBuffer, targetSampleRate, settings.bitDepth || 16, {
    onProgress: (p) => {
      if (onProgress) onProgress(75 + p * 15);
    }
  });
  if (onProgress) onProgress(90);

  console.log('[Offline Render] Complete!', { outputSize: wavData.byteLength });
  return wavData;
}

/**
 * Render to AudioBuffer (for cache/preview)
 * Preview mode returns a "heavy FX only" buffer for the hybrid live chain.
 * Export/full mode returns a fully rendered buffer (same as renderOffline, but as AudioBuffer).
 * @param {AudioBuffer} sourceBuffer - Source audio buffer
 * @param {Object} settings - Processing settings
 * @param {string} mode - 'preview' (heavy FX only) or 'export' (full chain)
 * @returns {Promise<{buffer: AudioBuffer, lufs: number}>}
 */
export async function renderToAudioBuffer(sourceBuffer, settings, mode = 'preview') {
  if (mode === 'preview') {
    // Hybrid pipeline cache: heavy FX only (Deharsh, Exciter, Warmth, Punch)
    console.log('[Cache Render] Starting (Preview)...', {
      duration: sourceBuffer.duration,
      sampleRate: sourceBuffer.sampleRate
    });

    // Clone to avoid mutating the original buffer
    let renderedBuffer = new AudioBuffer({
      numberOfChannels: sourceBuffer.numberOfChannels,
      length: sourceBuffer.length,
      sampleRate: sourceBuffer.sampleRate
    });
    for (let ch = 0; ch < sourceBuffer.numberOfChannels; ch++) {
      renderedBuffer.copyToChannel(sourceBuffer.getChannelData(ch), ch);
    }

    // Input Gain
    const inputGainDb = Number(settings.inputGain) || 0;
    if (inputGainDb !== 0) {
      const gainLin = Math.pow(10, inputGainDb / 20);
      for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
        const channelData = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] *= gainLin;
        }
      }
    }
    if (settings.stereoSectionEnabled !== false && settings.phaseInvert) {
      renderedBuffer = applyPhaseInvert(renderedBuffer);
    }
    if (settings.editSectionEnabled !== false && settings.reverseAudio) {
      renderedBuffer = reverseAudioBuffer(renderedBuffer);
    }
    if (settings.deharsh) {
      renderedBuffer = processHybridDynamic(renderedBuffer, 'mastering', null);
    }
    if (settings.polishSectionEnabled !== false) {
      if (settings.addAir) {
        renderedBuffer = applyExciter(renderedBuffer, null);
      }
      if (settings.tapeWarmth) {
        renderedBuffer = applyTapeWarmth(renderedBuffer, null);
      }
      if (settings.tubeSaturator) {
        renderedBuffer = applyTubeSaturation(renderedBuffer, {
          preset: settings.tubePreset || 'warm',
          drive: settings.tubeDrive,
          mix: settings.tubeMix
        });
      }
    }
    if (settings.addPunch) {
      renderedBuffer = applyMultibandTransient(renderedBuffer, null);
    }
    if (settings.loudnessSectionEnabled !== false && settings.autoLevel) {
      renderedBuffer = applyDynamicLeveling(renderedBuffer);
    }

    console.log('[Cache Render] Preview complete (LUFS skipped for speed)');
    return { buffer: renderedBuffer, lufs: NaN };
  }

  // Full chain cache (export parity — matches dsp-worker.js order)
  const targetSampleRate = sourceBuffer.sampleRate;

  console.log('[Cache Render] Starting (Full)...', {
    duration: sourceBuffer.duration,
    targetSampleRate,
    numSamples: Math.ceil(sourceBuffer.duration * targetSampleRate)
  });

  // Clone buffer
  let renderedBuffer = new AudioBuffer({
    numberOfChannels: sourceBuffer.numberOfChannels,
    length: sourceBuffer.length,
    sampleRate: sourceBuffer.sampleRate
  });
  for (let ch = 0; ch < sourceBuffer.numberOfChannels; ch++) {
    renderedBuffer.copyToChannel(sourceBuffer.getChannelData(ch), ch);
  }

  const dspResult = applyDSPChain(renderedBuffer, settings, null, '[Cache Render]', 'export');
  renderedBuffer = dspResult.buffer;

  const finalLufs = measureLUFS(renderedBuffer);
  console.log('[Cache Render] Final LUFS:', Number.isFinite(finalLufs) ? finalLufs.toFixed(1) : 'N/A');

  return { buffer: renderedBuffer, lufs: finalLufs };
}

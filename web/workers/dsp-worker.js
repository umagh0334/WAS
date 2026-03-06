// Import DSP modules
import {
  LIMITER_DEFAULTS,
  calcBiquadCoeffs,
  applyBiquadFilter,
  measureLUFS,
  findTruePeak,
  applyLookaheadLimiter,
  applyMasteringSoftClip,
  applyExciter,
  applyTapeWarmth,
  applyMultibandTransient,
  processHybridDynamic,
  applyFinalFilters,
  applySaturation,
  applyDynamicLeveling,
  applyMultibandCompression,
  shapeTransients,
  adjustStereoWidth,
  applyTubeSaturation,
  applyGlueCompressor,
  applyPhaseInvert,
  reverseAudioBuffer
} from '../lib/dsp/index.js';

/**
 * Fast sample-peak measurement (no oversampling).
 * Good enough for deciding whether limiter is needed — limiter catches inter-sample peaks.
 */
function fastPeakDB(buffer) {
  let max = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > max) max = a;
    }
  }
  return max > 0 ? 20 * Math.log10(max) : -Infinity;
}

/**
 * Worker-compatible AudioBuffer replacement
 * Mimics the AudioBuffer interface using plain Float32Arrays
 */
class WorkerAudioBuffer {
  constructor({ numberOfChannels, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channels = [];
    for (let i = 0; i < numberOfChannels; i++) {
      this._channels.push(new Float32Array(length));
    }
  }

  getChannelData(channel) {
    return this._channels[channel];
  }

  copyToChannel(source, channel, startInChannel = 0) {
    const dest = this._channels[channel];
    dest.set(source, startInChannel);
  }

  copyFromChannel(dest, channel, startInChannel = 0) {
    const source = this._channels[channel];
    dest.set(source.subarray(startInChannel, startInChannel + dest.length));
  }
}

// Polyfill AudioBuffer for worker context - DSP functions use this globally
globalThis.AudioBuffer = WorkerAudioBuffer;

/**
 * Send progress update to main thread
 */
function sendProgress(id, progress, status) {
  self.postMessage({ id, type: 'PROGRESS', progress, status });
}

/**
 * Convert raw Float32Array channels to WorkerAudioBuffer
 */
function channelsToBuffer(channels, sampleRate) {
  const buffer = new WorkerAudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: sampleRate
  });
  for (let ch = 0; ch < channels.length; ch++) {
    buffer.copyToChannel(channels[ch], ch);
  }
  return buffer;
}

/**
 * Extract Float32Array channels from a buffer (copies data)
 */
function bufferToChannels(buffer) {
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch).slice());
  }
  return channels;
}

/**
 * Simple spectral noise reduction for worker
 * Uses frequency-selective attenuation targeting AI artifacts
 * (No lib/dsp equivalent - simplified version)
 */
function applySpectralDenoiseToChannels(channels, sampleRate, id, amount = 0.3) {
  const numChannels = channels.length;
  const length = channels[0].length;
  const output = [];

  for (let ch = 0; ch < numChannels; ch++) {
    output.push(new Float32Array(length));
  }

  const cutoffFreq = 12000 - amount * 4000;
  const rc = 1.0 / (2 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (rc + dt);

  for (let ch = 0; ch < numChannels; ch++) {
    const input = channels[ch];
    const out = output[ch];
    let filtered = input[0];

    for (let i = 0; i < length; i++) {
      filtered = filtered + alpha * (input[i] - filtered);
      const blend = amount * 0.5;
      out[i] = input[i] * (1 - blend) + filtered * blend;
    }

    sendProgress(id, 0.1 + 0.8 * (ch + 1) / numChannels, 'Reducing noise...');
  }

  return output;
}


/**
 * Apply biquad filter to all channels of a buffer
 */
function applyBufferFilter(buffer, coeffs) {
  const result = new WorkerAudioBuffer({
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
 * Apply 7-Band Parametric EQ + Cut Mud
 */
function applyParametricEQ(buffer, settings) {
  if (settings.eqSectionEnabled === false) return buffer;

  const sampleRate = buffer.sampleRate;

  const bands = [
    { type: 'lowshelf',  freq: 60,    gain: Number(settings.eqSubBass) || 0, Q: 1.0 },
    { type: 'peaking',   freq: 150,   gain: Number(settings.eqLow) || 0,     Q: 1.0 },
    { type: 'peaking',   freq: 400,   gain: Number(settings.eqLowMid) || 0,  Q: 1.0 },
    { type: 'peaking',   freq: 1000,  gain: Number(settings.eqMid) || 0,     Q: 1.0 },
    { type: 'peaking',   freq: 3000,  gain: Number(settings.eqHighMid) || 0, Q: 1.0 },
    { type: 'peaking',   freq: 8000,  gain: Number(settings.eqHigh) || 0,    Q: 1.0 },
    { type: 'highshelf', freq: 16000, gain: Number(settings.eqAir) || 0,     Q: 1.0 }
  ];

  let outBuffer = buffer;

  for (const band of bands) {
    if (band.gain === 0) continue;
    const coeffs = calcBiquadCoeffs(band.type, band.freq, band.gain, band.Q, sampleRate);
    outBuffer = applyBufferFilter(outBuffer, coeffs);
  }

  if (settings.polishSectionEnabled !== false && settings.cutMud) {
    const coeffs = calcBiquadCoeffs('peaking', 250, -3.0, 1.5, sampleRate);
    outBuffer = applyBufferFilter(outBuffer, coeffs);
  }

  return outBuffer;
}

// Glue Compressor: imported from shared module (applyGlueCompressor from '../lib/dsp/index.js')

// === Stage Cache for Incremental Rendering ===
const stageCache = {
  inputFingerprint: null,  // identifies the input buffer
  prevSettings: null,
  afterA: null,            // buffer after Pre-LUFS stage
  afterB: null,            // buffer after LUFS stage
};

// Settings keys that belong to each stage
const STAGE_A_KEYS = [
  'inputGain', 'phaseInvert', 'reverseAudio', 'deharsh',
  'addAir', 'tapeWarmth', 'tubeSaturator', 'tubePreset', 'tubeDrive', 'tubeMix',
  'addPunch', 'autoLevel',
  'cleanLowEnd', 'highCut',
  'eqSectionEnabled', 'eqSubBass', 'eqLow', 'eqLowMid', 'eqMid', 'eqHighMid', 'eqHigh', 'eqAir',
  'cutMud', 'glueCompression',
  'stereoWidth', 'centerBass',
  'stereoSectionEnabled', 'editSectionEnabled', 'polishSectionEnabled'
];

const STAGE_B_KEYS = [
  'loudnessSectionEnabled', 'normalizeLoudness', 'targetLufs'
];

// Stage C keys = maximizer, truePeakLimit, truePeakCeiling (everything else)

function getInputFingerprint(channels, sampleRate) {
  const ch0 = channels[0];
  const mid = ch0[ch0.length >> 1];
  const q1 = ch0[ch0.length >> 2];
  const q3 = ch0[(ch0.length >> 2) * 3];
  return `${sampleRate}:${ch0.length}:${ch0[0]}:${q1}:${mid}:${q3}:${ch0[ch0.length - 1]}`;
}

function stageChanged(prev, curr, keys) {
  if (!prev) return true;
  for (const k of keys) {
    if (String(prev[k] ?? '') !== String(curr[k] ?? '')) return true;
  }
  return false;
}

function cloneBuffer(buf) {
  const clone = new WorkerAudioBuffer({
    numberOfChannels: buf.numberOfChannels,
    length: buf.length,
    sampleRate: buf.sampleRate
  });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    clone.copyToChannel(new Float32Array(buf.getChannelData(ch)), ch);
  }
  return clone;
}

function invalidateCache() {
  stageCache.inputFingerprint = null;
  stageCache.prevSettings = null;
  stageCache.afterA = null;
  stageCache.afterB = null;
}

// Message Handler
self.onmessage = async (e) => {
  const { type, id, data } = e.data;

  try {
    let result;

    switch (type) {
      case 'INVALIDATE_CACHE': {
        invalidateCache();
        self.postMessage({ id, type: 'result', data: { ok: true } });
        return;
      }

      case 'MEASURE_LUFS': {
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const lufs = measureLUFS(buffer);
        result = { lufs };
        break;
      }

      case 'FIND_TRUE_PEAK': {
        const buffer = channelsToBuffer(data.channels, data.sampleRate || 44100);
        const peakDB = findTruePeak(buffer);
        result = { peakDB };
        break;
      }

      case 'NORMALIZE': {
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const targetLUFS = data.targetLUFS || -12;
        const ceilingDB = data.ceilingDB || -1;

        sendProgress(id, 0.05, 'Measuring loudness...');
        const currentLUFS = measureLUFS(buffer);
        const currentPeakDB = fastPeakDB(buffer);

        if (!isFinite(currentLUFS)) {
          console.warn('[Worker LUFS] Could not measure loudness, returning original');
          result = {
            channels: data.channels,
            currentLUFS,
            currentPeakDB,
            finalLUFS: currentLUFS,
            peakDB: currentPeakDB
          };
          break;
        }

        sendProgress(id, 0.3, 'Applying gain...');
        const gainDB = targetLUFS - currentLUFS;
        const gainLin = Math.pow(10, gainDB / 20);
        const projectedPeakDB = currentPeakDB + gainDB;

        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const chData = buffer.getChannelData(ch);
          for (let i = 0; i < chData.length; i++) {
            chData[i] *= gainLin;
          }
        }

        let finalBuffer = buffer;
        let limiterApplied = false;

        if (projectedPeakDB > ceilingDB) {
          sendProgress(id, 0.5, 'Applying limiter...');
          const ceilingLin = Math.pow(10, ceilingDB / 20);
          finalBuffer = applyLookaheadLimiter(finalBuffer, ceilingLin, 3, 100);
          limiterApplied = true;
        }

        sendProgress(id, 0.85, 'Measuring final levels...');
        const finalLUFS = measureLUFS(finalBuffer);
        const finalPeakDB = findTruePeak(finalBuffer);

        result = {
          channels: bufferToChannels(finalBuffer),
          currentLUFS,
          currentPeakDB,
          finalLUFS,
          peakDB: finalPeakDB,
          gainApplied: gainDB,
          limiterApplied
        };
        break;
      }

      case 'APPLY_LIMITER': {
        sendProgress(id, 0.1, 'Applying limiter...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const limited = applyLookaheadLimiter(
          buffer,
          data.ceilingLinear || LIMITER_DEFAULTS.CEILING_LINEAR,
          data.lookaheadMs || LIMITER_DEFAULTS.LOOKAHEAD_MS,
          data.releaseMs || LIMITER_DEFAULTS.RELEASE_MS,
          data.kneeDB || LIMITER_DEFAULTS.KNEE_DB,
          data.preserveTransients !== false
        );
        result = { channels: bufferToChannels(limited) };
        break;
      }

      case 'SPECTRAL_DENOISE': {
        sendProgress(id, 0.1, 'Analyzing noise profile...');
        const denoised = applySpectralDenoiseToChannels(
          data.channels,
          data.sampleRate,
          id,
          data.amount || 0.3
        );
        result = { channels: denoised };
        break;
      }

      case 'APPLY_SATURATION': {
        sendProgress(id, 0.1, 'Applying saturation...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const saturated = applySaturation(buffer, data.drive || 0.5);
        result = { channels: bufferToChannels(saturated) };
        break;
      }

      case 'APPLY_DYNAMIC_LEVELING': {
        sendProgress(id, 0.1, 'Analyzing dynamics...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const leveled = applyDynamicLeveling(buffer, data.options || {});
        result = { channels: bufferToChannels(leveled) };
        break;
      }

      case 'APPLY_MULTIBAND': {
        sendProgress(id, 0.1, 'Splitting into bands...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const multiband = applyMultibandCompression(buffer, data.preset || 'balanced');
        result = { channels: bufferToChannels(multiband) };
        break;
      }

      case 'APPLY_TRANSIENT_SHAPING': {
        sendProgress(id, 0.1, 'Detecting transients...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const opts = data.options || {};
        const shaped = shapeTransients(buffer, opts.attack, opts.sustain, opts.sensitivity);
        result = { channels: bufferToChannels(shaped) };
        break;
      }

      case 'APPLY_STEREO_PROCESSING': {
        sendProgress(id, 0.1, 'Processing stereo...');
        const buffer = channelsToBuffer(data.channels, data.sampleRate);
        const opts = data.options || {};
        const stereo = adjustStereoWidth(
          buffer,
          opts.width ?? 1.0,
          opts.bassMono ?? true,
          opts.bassFreq ?? 200
        );
        result = { channels: bufferToChannels(stereo) };
        break;
      }

      case 'RENDER_FULL_CHAIN': {
        const { channels, sampleRate, settings, mode = 'preview' } = data;

        sendProgress(id, 0.05, 'Creating audio buffer...');

        let buffer = channelsToBuffer(channels, sampleRate);

        console.log(`[Worker Chain] Starting render (Mode: ${mode})`);

        // --- HEAVY FX (Shared / Preview) ---

        // 0. Input Gain
        const inputGainDb = Number(settings.inputGain) || 0;
        if (inputGainDb !== 0) {
          sendProgress(id, 0.10, 'Applying input gain...');
          const gainLin = Math.pow(10, inputGainDb / 20);
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const channelData = buffer.getChannelData(ch);
            for (let i = 0; i < channelData.length; i++) {
              channelData[i] *= gainLin;
            }
          }
        }

        // 0. Phase Invert
        if (settings.stereoSectionEnabled !== false && settings.phaseInvert) {
          sendProgress(id, 0.12, 'Applying phase invert...');
          buffer = applyPhaseInvert(buffer);
        }

        // 0.5. Reverse Audio
        if (settings.editSectionEnabled !== false && settings.reverseAudio) {
          sendProgress(id, 0.13, 'Reversing audio...');
          buffer = reverseAudioBuffer(buffer);
        }

        // 1. Deharsh / Hybrid Dynamic Processor - Quick Fix
        if (settings.deharsh) {
          sendProgress(id, 0.15, 'Applying hybrid dynamic processor...');
          buffer = processHybridDynamic(buffer, 'mastering');
        }

        // Polish Section
        if (settings.polishSectionEnabled !== false) {
          // 2. Exciter / Add Air
          if (settings.addAir) {
            sendProgress(id, 0.3, 'Applying exciter...');
            buffer = applyExciter(buffer);
          }

          // 3. Multiband Saturation / Tape Warmth
          if (settings.tapeWarmth) {
            sendProgress(id, 0.40, 'Applying multiband saturation...');
            buffer = applyTapeWarmth(buffer);
          }

          // 3.5. Tube Saturator
          if (settings.tubeSaturator) {
            sendProgress(id, 0.48, 'Applying tube saturation...');
            buffer = applyTubeSaturation(buffer, {
              preset: settings.tubePreset || 'warm',
              drive: settings.tubeDrive,
              mix: settings.tubeMix
            });
          }
        }

        // 4. Multiband Transient / Add Punch - Quick Fix
        if (settings.addPunch) {
          sendProgress(id, 0.55, 'Applying multiband transient...');
          buffer = applyMultibandTransient(buffer);
        }

        // 4.5. Auto Level (Dynamic Leveling)
        if (settings.loudnessSectionEnabled !== false && settings.autoLevel) {
          sendProgress(id, 0.58, 'Applying auto level...');
          buffer = applyDynamicLeveling(buffer);
        }

        // --- PREVIEW MODE END ---
        if (mode === 'preview') {
          console.log('[Worker Chain] Preview render complete (Heavy FX only)');
          sendProgress(id, 1.0, 'Complete');

          const outputChannels = bufferToChannels(buffer);
          const transferables = outputChannels.map(ch => ch.buffer);

          result = {
            channels: outputChannels,
            lufs: NaN,
            measuredLufs: NaN
          };

          self.postMessage({ id, success: true, result }, transferables);
          return;
        }

        // --- EXPORT MODE WITH STAGE CACHE ---

        const fingerprint = getInputFingerprint(channels, sampleRate);
        const inputChanged = fingerprint !== stageCache.inputFingerprint;
        const aChanged = inputChanged || stageChanged(stageCache.prevSettings, settings, STAGE_A_KEYS);
        const bChanged = aChanged || stageChanged(stageCache.prevSettings, settings, STAGE_B_KEYS);
        // C always runs (it's cheap)

        let startStage = 'A';
        if (!aChanged && stageCache.afterA) startStage = 'B';
        if (!bChanged && stageCache.afterB) startStage = 'C';

        console.log(`[Worker Cache] Start from stage ${startStage} (input:${inputChanged ? 'new' : 'cached'} A:${aChanged ? 'changed' : 'cached'} B:${bChanged ? 'changed' : 'cached'})`);

        // === STAGE A: Pre-LUFS ===
        if (startStage === 'A') {
          // 5. Final Filters (HPF 30Hz / LPF 18k)
          if (!!settings.cleanLowEnd || !!settings.highCut) {
            sendProgress(id, 0.58, 'Applying final filters...');
            buffer = applyFinalFilters(buffer, {
              highpass: !!settings.cleanLowEnd,
              lowpass: !!settings.highCut
            });
          }

          // 6. EQ (7-Band) + Cut Mud
          sendProgress(id, 0.65, 'Applying EQ...');
          buffer = applyParametricEQ(buffer, settings);

          // 7. Glue Compressor
          if (settings.glueCompression) {
            sendProgress(id, 0.70, 'Applying glue compressor...');
            buffer = applyGlueCompressor(buffer);
          }

          // 7.5 Stereo processing
          // Width: bake only for export (real-time playback uses live M/S gain nodes)
          // Center Bass: always bake (requires frequency-domain splitting)
          if (buffer.numberOfChannels === 2 && settings.stereoSectionEnabled !== false) {
            const bassMono = !!settings.centerBass;
            const stereoWidthValue = Number(settings.stereoWidth);
            const width = Number.isFinite(stereoWidthValue) ? stereoWidthValue / 100 : 1.0;
            const clampedWidth = Math.max(0, Math.min(2, width));
            const applyWidth = mode === 'export' && Math.abs(clampedWidth - 1.0) > 1e-6;

            if (bassMono || applyWidth) {
              sendProgress(id, 0.72, 'Applying stereo processing...');
              buffer = adjustStereoWidth(buffer, applyWidth ? clampedWidth : 1.0, bassMono, 200);
            }

            // L/R Balance
            const bal = Number(settings.balance) || 0;
            if (bal !== 0 && buffer.numberOfChannels === 2) {
              const leftFactor = bal <= 0 ? 1.0 : 1.0 - bal / 100;
              const rightFactor = bal >= 0 ? 1.0 : 1.0 + bal / 100;
              const L = buffer.getChannelData(0);
              const R = buffer.getChannelData(1);
              for (let i = 0; i < L.length; i++) { L[i] *= leftFactor; }
              for (let i = 0; i < R.length; i++) { R[i] *= rightFactor; }
            }
          }

          stageCache.afterA = cloneBuffer(buffer);
          stageCache.inputFingerprint = fingerprint;
        } else {
          buffer = cloneBuffer(stageCache.afterA);
          console.log('[Worker Cache] Stage A: using cache');
          sendProgress(id, 0.72, 'Using cached pre-LUFS...');
        }

        // === STAGE B: LUFS Normalize (inline — no redundant measurements) ===
        let lufsGainApplied = 0;
        if (startStage === 'A' || startStage === 'B') {
          if (settings.loudnessSectionEnabled !== false) {
            if (settings.normalizeLoudness && settings.targetLufs) {
              sendProgress(id, 0.75, 'Analyzing loudness...');
              const currentLufs = measureLUFS(buffer);
              if (isFinite(currentLufs)) {
                lufsGainApplied = Number(settings.targetLufs) - currentLufs;
                const gainLin = Math.pow(10, lufsGainApplied / 20);
                for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                  const chData = buffer.getChannelData(ch);
                  for (let i = 0; i < chData.length; i++) {
                    chData[i] *= gainLin;
                  }
                }
              }
            }
          }
          stageCache.afterB = cloneBuffer(buffer);
        } else {
          buffer = cloneBuffer(stageCache.afterB);
          console.log('[Worker Cache] Stage B: using cache');
          sendProgress(id, 0.82, 'Using cached LUFS...');
        }

        // === STAGE C: Post-LUFS (always runs, cheap) ===
        if (settings.loudnessSectionEnabled !== false && settings.maximizer) {
          // 9. Soft Clipper
          sendProgress(id, 0.85, 'Applying soft clipper...');
          const ceiling = settings.truePeakCeiling || -1;
          buffer = applyMasteringSoftClip(buffer, {
            ceiling: ceiling,
            lookaheadMs: 0.5,
            releaseMs: 10,
            drive: 1.5
          });

          // 10. Lookahead Limiter (with optional true peak detection)
          sendProgress(id, 0.95, 'Applying limiter...');
          const ceilingLinear = Math.pow(10, ceiling / 20);
          buffer = applyLookaheadLimiter(
            buffer,
            ceilingLinear,
            LIMITER_DEFAULTS.LOOKAHEAD_MS,
            LIMITER_DEFAULTS.RELEASE_MS,
            LIMITER_DEFAULTS.KNEE_DB,
            true,
            !!settings.truePeakLimit
          );
        }

        // Save settings for next diff
        stageCache.prevSettings = { ...settings };

        // Measure final LUFS — skip if limiter wasn't used (gain-only → estimate)
        let finalLufs;
        const limiterWasUsed = settings.loudnessSectionEnabled !== false && settings.maximizer;
        if (limiterWasUsed) {
          finalLufs = measureLUFS(buffer);
        } else if (lufsGainApplied !== 0 && settings.normalizeLoudness) {
          finalLufs = Number(settings.targetLufs) || -12;
        } else {
          finalLufs = measureLUFS(buffer);
        }
        const outputChannels = bufferToChannels(buffer);
        const transferables = outputChannels.map(ch => ch.buffer);

        result = {
          channels: outputChannels,
          lufs: finalLufs,
          measuredLufs: finalLufs
        };

        sendProgress(id, 1.0, 'Complete');
        self.postMessage({ id, success: true, result }, transferables);
        return;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    sendProgress(id, 1.0, 'Complete');
    self.postMessage({ id, success: true, result });

  } catch (error) {
    console.error('[Worker] Error:', error);
    self.postMessage({ id, success: false, error: error.message });
  }
};

console.log('[DSP Worker] Initialized');

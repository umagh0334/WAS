import { Fader } from '../components/Fader.js';

// EQ values (managed by faders)
export const eqValues = {
  subBass: 0,
  low: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  high: 0,
  air: 0
};

export let inputGainValue = 0;  // dB
export let ceilingValueDb = -1.0; // dB
export let targetLufsDb = -15; // Target LUFS for normalization

const faders = {
  inputGain: null,
  ceiling: null,
  eqSubBass: null,
  eqLow: null,
  eqLowMid: null,
  eqMid: null,
  eqHighMid: null,
  eqHigh: null,
  eqAir: null
};

// Section toggles
const eqSectionEnabled = document.getElementById('eqSectionEnabled');
const polishSectionEnabled = document.getElementById('polishSectionEnabled');
const stereoSectionEnabled = document.getElementById('stereoSectionEnabled');
const loudnessSectionEnabled = document.getElementById('loudnessSectionEnabled');
const editSectionEnabled = document.getElementById('editSectionEnabled');

const normalizeLoudness = document.getElementById('normalizeLoudness');
const maximizer = document.getElementById('maximizer');
const truePeakLimit = document.getElementById('truePeakLimit');
const cleanLowEnd = document.getElementById('cleanLowEnd');
const highCut = document.getElementById('highCut');
const glueCompression = document.getElementById('glueCompression');
const deharsh = document.getElementById('deharsh');
const stereoWidthSlider = document.getElementById('stereoWidth');
const stereoWidthValue = document.getElementById('stereoWidthValue');
const balanceSlider = document.getElementById('balance');
const balanceValue = document.getElementById('balanceValue');
const centerBass = document.getElementById('centerBass');
const phaseInvert = document.getElementById('phaseInvert');
const cutMud = document.getElementById('cutMud');
const addAir = document.getElementById('addAir');
const tapeWarmth = document.getElementById('tapeWarmth');
const tubeSaturator = document.getElementById('tubeSaturator');
const tubeDrive = document.getElementById('tubeDrive');
const tubeMix = document.getElementById('tubeMix');
const autoLevel = document.getElementById('autoLevel');
const addPunch = document.getElementById('addPunch');
const reverseAudio = document.getElementById('reverseAudio');
const sampleRate = document.getElementById('sampleRate');
const bitDepth = document.getElementById('bitDepth');

/**
 * Get current settings from all UI controls
 * @returns {Object} Current settings object
 */
export function getCurrentSettings() {
  return {
    // Section enabled states
    eqSectionEnabled: eqSectionEnabled.checked,
    polishSectionEnabled: polishSectionEnabled.checked,
    stereoSectionEnabled: stereoSectionEnabled.checked,
    loudnessSectionEnabled: loudnessSectionEnabled.checked,
    editSectionEnabled: editSectionEnabled.checked,

    normalizeLoudness: normalizeLoudness.checked,
    targetLufs: targetLufsDb,
    maximizer: maximizer.checked,
    truePeakLimit: truePeakLimit.checked,
    truePeakCeiling: ceilingValueDb,
    cleanLowEnd: cleanLowEnd.checked,
    highCut: highCut.checked,
    glueCompression: glueCompression.checked,
    deharsh: deharsh.checked,
    stereoWidth: parseInt(stereoWidthSlider.value) || 100,
    balance: parseInt(balanceSlider.value) || 0,
    centerBass: centerBass.checked,
    phaseInvert: phaseInvert.checked,
    cutMud: cutMud.checked,
    addAir: addAir.checked,
    tapeWarmth: tapeWarmth.checked,
    tubeSaturator: tubeSaturator.checked,
    tubePreset: document.querySelector('.tube-preset-btn.active')?.dataset.tube || 'warm',
    tubeDrive: parseInt(tubeDrive.value) / 100,
    tubeMix: parseInt(tubeMix.value) / 100,
    autoLevel: autoLevel.checked,
    addPunch: addPunch.checked,
    reverseAudio: reverseAudio.checked,
    inputGain: inputGainValue,
    eqSubBass: eqValues.subBass,
    eqLow: eqValues.low,
    eqLowMid: eqValues.lowMid,
    eqMid: eqValues.mid,
    eqHighMid: eqValues.highMid,
    eqHigh: eqValues.high,
    eqAir: eqValues.air
  };
}

/**
 * Get export-specific settings (includes format options)
 * @returns {Object} Export settings object
 */
export function getExportSettings() {
  const base = getCurrentSettings();
  return {
    ...base,
    sampleRate: parseInt(sampleRate.value) || 44100,
    bitDepth: parseInt(bitDepth.value) || 16
  };
}

/**
 * Initialize all faders
 * @param {Object} callbacks - Callback functions for fader changes
 * @param {Function} callbacks.onInputGainChange - Called when input gain changes (during drag)
 * @param {Function} callbacks.onInputGainChangeEnd - Called when input gain drag ends
 * @param {Function} callbacks.onCeilingChange - Called when ceiling changes (during drag)
 * @param {Function} callbacks.onCeilingChangeEnd - Called when ceiling drag ends
 * @param {Function} callbacks.onEQChange - Called when any EQ fader changes (during drag)
 * @param {Function} callbacks.onEQChangeEnd - Called when any EQ fader drag ends
 */
export function initFaders(callbacks = {}) {
  // Destroy old faders before creating new ones (prevents memory leaks on re-init)
  Object.keys(faders).forEach(key => {
    if (faders[key] && typeof faders[key].destroy === 'function') {
      faders[key].destroy();
    }
    faders[key] = null;
  });

  // Input Gain Fader
  faders.inputGain = new Fader('#inputGainFader', {
    min: -12,
    max: 12,
    value: 0,
    step: 0.5,
    label: 'Input',
    unit: 'dB',
    orientation: 'vertical',
    height: 120,
    showScale: false,
    decimals: 1,
    onChange: (val) => {
      inputGainValue = val;
      if (callbacks.onInputGainChange) callbacks.onInputGainChange(val);
    },
    onChangeEnd: (val) => {
      if (callbacks.onInputGainChangeEnd) callbacks.onInputGainChangeEnd(val);
    }
  });

  // Target LUFS Fader
  faders.targetLufs = new Fader('#targetLufsFader', {
    min: -29,
    max: -1,
    value: -15,
    defaultValue: -15,
    step: 0.5,
    label: 'Target',
    unit: 'LUFS',
    orientation: 'vertical',
    height: 120,
    showScale: false,
    decimals: 1,
    onChange: (val) => {
      targetLufsDb = val;
      if (callbacks.onTargetLufsChange) callbacks.onTargetLufsChange(val);
    },
    onChangeEnd: (val) => {
      if (callbacks.onTargetLufsChangeEnd) callbacks.onTargetLufsChangeEnd(val);
    }
  });

  // Ceiling Fader
  faders.ceiling = new Fader('#ceilingFader', {
    min: -6,
    max: 0,
    value: -1.0,
    defaultValue: -1.0,
    step: 0.5,
    label: 'Ceiling',
    unit: 'dB',
    orientation: 'vertical',
    height: 120,
    showScale: false,
    decimals: 1,
    onChange: (val) => {
      ceilingValueDb = val;
      if (callbacks.onCeilingChange) callbacks.onCeilingChange(val);
    },
    onChangeEnd: (val) => {
      if (callbacks.onCeilingChangeEnd) callbacks.onCeilingChangeEnd(val);
    }
  });

  // EQ Faders
  const eqConfig = [
    { key: 'eqSubBass', selector: '#eqSubBassFader', label: '60Hz', stateKey: 'subBass' },
    { key: 'eqLow', selector: '#eqLowFader', label: '150Hz', stateKey: 'low' },
    { key: 'eqLowMid', selector: '#eqLowMidFader', label: '400Hz', stateKey: 'lowMid' },
    { key: 'eqMid', selector: '#eqMidFader', label: '1kHz', stateKey: 'mid' },
    { key: 'eqHighMid', selector: '#eqHighMidFader', label: '3kHz', stateKey: 'highMid' },
    { key: 'eqHigh', selector: '#eqHighFader', label: '8kHz', stateKey: 'high' },
    { key: 'eqAir', selector: '#eqAirFader', label: '16kHz', stateKey: 'air' }
  ];

  eqConfig.forEach(({ key, selector, label, stateKey }) => {
    faders[key] = new Fader(selector, {
      min: -12,
      max: 12,
      value: 0,
      step: 0.5,
      label: label,
      unit: 'dB',
      orientation: 'vertical',
      height: 120,
      showScale: false,
      decimals: 1,
      onChange: (val) => {
        eqValues[stateKey] = val;
        clearActivePreset();
        if (callbacks.onEQChange) callbacks.onEQChange(eqValues);
      },
      onChangeEnd: (val) => {
        if (callbacks.onEQChangeEnd) callbacks.onEQChangeEnd(eqValues);
      }
    });
  });
}

/**
 * Clear active preset button highlight
 */
export function clearActivePreset() {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

/**
 * Apply an EQ preset
 * @param {Object} preset - Preset values { low, lowMid, mid, highMid, high }
 * @param {Function} onEQChange - Callback when EQ changes
 */
export function applyEQPreset(preset, onEQChange) {
  // Update eqValues state
  eqValues.subBass = preset.subBass;
  eqValues.low = preset.low;
  eqValues.lowMid = preset.lowMid;
  eqValues.mid = preset.mid;
  eqValues.highMid = preset.highMid;
  eqValues.high = preset.high;
  eqValues.air = preset.air;

  // Update fader displays
  if (faders.eqSubBass) faders.eqSubBass.setValue(preset.subBass);
  if (faders.eqLow) faders.eqLow.setValue(preset.low);
  if (faders.eqLowMid) faders.eqLowMid.setValue(preset.lowMid);
  if (faders.eqMid) faders.eqMid.setValue(preset.mid);
  if (faders.eqHighMid) faders.eqHighMid.setValue(preset.highMid);
  if (faders.eqHigh) faders.eqHigh.setValue(preset.high);
  if (faders.eqAir) faders.eqAir.setValue(preset.air);

  if (onEQChange) onEQChange(eqValues);
}

/**
 * Set target LUFS value
 * @param {number} value - New target LUFS
 */
export function setTargetLufs(value) {
  targetLufsDb = value;
}

/**
 * Setup EQ preset buttons
 * @param {Object} presets - EQ presets object
 * @param {Function} onEQChange - Callback when EQ changes
 */
export function setupEQPresets(presets, onEQChange) {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = presets[btn.dataset.preset];
      if (preset) {
        applyEQPreset(preset, onEQChange);
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });
}

/**
 * Setup output format preset buttons
 * @param {Object} presets - Output presets object
 */
export function setupOutputPresets(presets) {
  document.querySelectorAll('.output-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = presets[btn.dataset.preset];
      if (preset) {
        sampleRate.value = preset.sampleRate;
        bitDepth.value = preset.bitDepth;
        document.querySelectorAll('.output-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });
}

export const dom = {
  eqSectionEnabled,
  polishSectionEnabled,
  stereoSectionEnabled,
  loudnessSectionEnabled,
  editSectionEnabled,
  normalizeLoudness,
  maximizer,
  truePeakLimit,
  cleanLowEnd,
  highCut,
  glueCompression,
  deharsh,
  centerBass,
  cutMud,
  addAir,
  tapeWarmth,
  tubeSaturator,
  tubeDrive,
  tubeMix,
  autoLevel,
  addPunch,
  phaseInvert,
  reverseAudio,
  stereoWidthSlider,
  stereoWidthValue,
  balanceSlider,
  balanceValue,
  sampleRate,
  bitDepth
};

export { faders };

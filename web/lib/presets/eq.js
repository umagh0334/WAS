/**
 * EQ preset definitions
 * Each preset defines gain values in dB for the 7-band EQ:
 * - subBass: 60Hz (lowshelf)
 * - low: 150Hz (peaking)
 * - lowMid: 400Hz (peaking)
 * - mid: 1kHz (peaking)
 * - highMid: 3kHz (peaking)
 * - high: 8kHz (peaking)
 * - air: 16kHz (highshelf)
 */
export const eqPresets = {
  flat: { subBass: 0, low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, air: 0 },
  vocal: { subBass: -2, low: -1, lowMid: 0, mid: 2, highMid: 3, high: 2, air: 1 },
  bass: { subBass: 6, low: 4, lowMid: 1, mid: 0, highMid: -1, high: -1, air: -2 },
  bright: { subBass: -1, low: 0, lowMid: 0, mid: 1, highMid: 3, high: 4, air: 5 },
  warm: { subBass: 4, low: 3, lowMid: 1, mid: 0, highMid: -2, high: -2, air: -3 },
  aifix: { subBass: 1, low: 0, lowMid: -2, mid: 1, highMid: -1, high: 1, air: 2 }
};

/**
 * Output format presets
 */
export const outputPresets = {
  streaming: { sampleRate: 44100, bitDepth: 16 },  // Standard streaming quality
  studio: { sampleRate: 48000, bitDepth: 24 }       // Professional studio quality
};

/**
 * Get preset names for UI population
 * @returns {string[]} Array of preset names
 */
export function getPresetNames() {
  return Object.keys(eqPresets);
}

/**
 * Get a specific EQ preset
 * @param {string} name - Preset name
 * @returns {Object|null} Preset object or null if not found
 */
export function getPreset(name) {
  return eqPresets[name] || null;
}

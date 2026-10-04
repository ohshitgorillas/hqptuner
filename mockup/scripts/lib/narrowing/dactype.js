// DAC type (Shaping drawer: PCM out asks R-2R?, SDM out asks ESS Sabre?): an HQPTuner pref, live, never staged. It
// collapses the shaper list groups the manual calls the wrong fit (components/option-list.js), never hides them:
//   r2r = '1'  dither list: the Additive family folds (R-2R: noise shaping corrects "linearity errors inherent to all R2R
//              DACs", manual §4)
//   ess = '1'  modulator list: every Seventh order variant folds ("For ESS Sabre based DACs, fifth order modulators are
//              recommended", manual §4.6)
// A tap on a folded header still opens it.

/** @typedef {{ r2r: string, ess: string }} DacType  each pref's value: '1' = that DAC type, '0' = not */

/** @type {DacType} */
const st = { r2r: "0", ess: "0" };

/**
 * The DAC-type prefs as they stand, as a copy.
 *
 * @returns {DacType}
 */
export const dacType = () => ({ ...st });

/**
 * Set one DAC-type pref; when it changes, the bus hears `dactype` with both prefs.
 *
 * @param {keyof DacType} k
 * @param {string} v
 * @param {import('../shell/bus.js').Bus} bus
 */
export function setDacType(k, v, bus) {
  if (st[k] === v) return;
  st[k] = v;
  bus.emit("dactype", { ...st });
}

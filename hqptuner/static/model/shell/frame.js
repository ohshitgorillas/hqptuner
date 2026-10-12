// Faceplate composition model: the decisions the faceplate's wiring paints, free of the DOM. The engine row's zones and
// speed gauge, the source meter's no-stream line and the page's top section each come back as a value; the caller
// writes it into the page.

/** Zone seams [bad|warn, warn|ok]. @typedef {[number, number]} Seams */

/**
 * The speed gauge's needle end and figure.
 *
 * @typedef {object} GaugeReading
 * @property {string} x2    needle end x, one decimal
 * @property {string} y2    needle end y, one decimal
 * @property {string} text  the figure
 * @property {string} zone  bad | warn | ok, '' with nothing playing
 */

/**
 * What a scenario plays.
 *
 * @typedef {object} Scene
 * @property {string} id
 * @property {boolean} playing
 * @property {string} [family]   pcm | dsd
 * @property {string} [source]   the rail's Source value
 * @property {string} [stage]    the rate stage, '1x' | 'nx'
 * @property {number} [nyquist]  Hz
 */

/** @typedef {{ meterIdle: string, meterDsd: string }} MeterCopy */

/**
 * The page's top section: the Matrix section at the top, folded to its header line, and whether the spectrum shows.
 *
 * @typedef {object} FillLayout
 * @property {boolean} profile    the Matrix section has the top
 * @property {boolean} fold       the Matrix section sits on one line above the spectrum
 * @property {boolean} show       the spectrum shows
 * @property {string | null} why  'off' while hidden, else the no-stream line, null for a running meter
 * @property {string} key         what the page meter shows: it remounts only when this changes
 */

/**
 * Red | amber | green by the seams; null (nothing playing) is no zone.
 *
 * @param {number | null | undefined} v
 * @param {Seams} seams
 * @returns {string}
 */
export const zone = (v, [lo, hi]) => (v == null ? "" : v < lo ? "bad" : v < hi ? "warn" : "ok");

/**
 * The process speed gauge: × on a log scale, 1× at the warn | ok seam; nothing playing rests the needle at the left
 * stop. The figure takes the zone its needle sits in.
 *
 * @param {number | null | undefined} v
 * @param {Seams} seams
 * @returns {GaugeReading}
 */
export function gaugeReading(v, seams) {
  const th = ((v == null ? 180 : Math.max(0, Math.min(180, 107.2 - 74.7 * Math.log2(v)))) * Math.PI) / 180;
  return {
    x2: (55 + 44 * Math.cos(th)).toFixed(1),
    y2: (54 - 44 * Math.sin(th)).toFixed(1),
    text: v == null ? "—" : v.toFixed(2) + "×",
    zone: zone(v, seams),
  };
}

/**
 * The no-stream line a source meter shows instead of running: nothing playing, or DSD with the matrix engine bypassed.
 * Null when the meter runs.
 *
 * @param {Scene} scene
 * @param {boolean} mxApplied
 * @param {MeterCopy} copy
 * @returns {string | null}
 */
export function noStream(scene, mxApplied, copy) {
  if (!scene.playing) return copy.meterIdle;
  return scene.family === "dsd" && !mxApplied ? copy.meterDsd : null;
}

/**
 * The page's top section from the Layout preference (auto | profile | spectrum) and the matrix engine as applied.
 * Bypassed, there is no profile: the spectrum takes the top and nothing folds.
 *
 * @param {boolean} mxApplied
 * @param {string} pref
 * @param {Scene} scene
 * @param {MeterCopy} copy
 * @returns {FillLayout}
 */
export function fillLayout(mxApplied, pref, scene, copy) {
  const profile = mxApplied && pref === "profile";
  const show = !profile;
  const why = show ? noStream(scene, mxApplied, copy) : "off";
  return { profile, fold: mxApplied && pref === "auto", show, why, key: `${why}|${scene.id}` };
}

// Response plot geometry, free of the DOM: log frequency across, linear dB up, dB labels in a left gutter and
// frequency labels in a bottom band. Every function takes the box in px and the scale in Hz / dB as arguments, so the
// plots (components/matrix-plot.js, components/resp-plot.js) draw what they get back and a test drives it from a table.

export const GUTTER = 28;   // left, for dB labels
export const BAND = 16;     // bottom, for frequency labels
export const PAD = 6;       // top
const RIGHT = 4;            // right inset of the highest frequency

/**
 * A plot's box in px and its scale.
 *
 * @typedef {object} PlotBox
 * @property {number} W     px
 * @property {number} H     px
 * @property {number} fMin  Hz at the left edge
 * @property {number} fMax  Hz at the right edge
 * @property {number} lo    dB at the bottom
 * @property {number} hi    dB at the top
 */

/**
 * A level's y from its scale and the plot's height in px.
 *
 * @typedef {(lo: number, hi: number, plotH: number) => (d: number) => number} LevelMap
 */

/**
 * The box with its maps: x(f) and y(d) in px, the level span's height, the decades across, and the frame's edges
 * rounded to a tenth (x0, x1 the lowest and highest frequency, yb the lowest level).
 *
 * @typedef {PlotBox & { plotH: number, decades: number, x: (f: number) => number, y: (d: number) => number,
 *   x0: number, x1: number, yb: number }} PlotGeometry
 */

/**
 * The level lines a scale draws: majors on every step, minors between them, the levels that carry a label (the majors
 * and 0 dB, inside the scale), and whether the minors have room to show.
 *
 * @typedef {object} LevelGrid
 * @property {number[]} major
 * @property {number[]} minor
 * @property {number[]} labels
 * @property {boolean} roomy
 */

/**
 * A px value rounded to a tenth.
 *
 * @param {number} v
 * @returns {number}
 */
export const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Linear level map: hi at the top pad, lo on the frequency band.
 *
 * @type {LevelMap}
 */
export const levelY = (lo, hi, plotH) => (d) => PAD + plotH * (hi - d) / (hi - lo);

/**
 * The same map for a scale symmetric about 0 dB (lo = −hi), drawn from the middle out.
 *
 * @type {LevelMap}
 */
export const centredLevelY = (_lo, hi, plotH) => (d) => PAD + plotH / 2 - d * (plotH / 2) / hi;

/**
 * A plot's maps and frame edges for its box.
 *
 * @param {PlotBox} box
 * @param {LevelMap} [levelMap]  levelY unless given
 * @returns {PlotGeometry}
 */
export function plotGeometry(box, levelMap = levelY) {
  const { W, H, fMin, fMax, lo, hi } = box;
  const decades = Math.log10(fMax / fMin);
  const plotH = H - PAD - BAND;
  /** @param {number} f */
  const x = (f) => GUTTER + (W - GUTTER - RIGHT) * Math.log10(f / fMin) / decades;
  const y = levelMap(lo, hi, plotH);
  return { ...box, plotH, decades, x, y, x0: round1(x(fMin)), x1: round1(x(fMax)), yb: round1(y(lo)) };
}

/**
 * The level lines for a scale on a plot `plotH` px tall; the minors have room once each gap between them reaches
 * `minGap` px.
 *
 * @param {{ lo: number, hi: number, step: number, minor?: number }} scale
 * @param {number} plotH
 * @param {number} minGap
 * @returns {LevelGrid}
 */
export function levelGrid({ lo, hi, step, minor }, plotH, minGap) {
  /** @type {number[]} */
  const majors = [];
  /** @type {number[]} */
  const minors = [];
  const m = minor || step;
  for (let d = Math.ceil(lo / m) * m; d <= hi + 1e-9; d += m) {
    if (Math.abs(d) < 1e-9) continue;
    (Math.abs(d / step - Math.round(d / step)) < 1e-9 ? majors : minors).push(Math.round(d * 10) / 10);
  }
  return {
    major: majors,
    minor: minors,
    labels: [...majors, 0].filter((d) => d >= lo && d <= hi),
    roomy: plotH / ((hi - lo) / m) >= minGap,
  };
}

/**
 * SVG path data for a level curve sampled at `n` + 1 frequencies evenly spaced on the log axis, each point rounded to
 * a tenth of a px.
 *
 * @param {PlotGeometry} geo
 * @param {number} n
 * @param {(f: number) => number} fn  dB at f
 * @returns {string}
 */
export function tracePath(geo, n, fn) {
  const { fMin, decades, x, y } = geo;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const f = fMin * 10 ** (decades * i / n);
    d += (i ? ' L' : 'M') + round1(x(f)) + ' ' + round1(y(fn(f)));
  }
  return d;
}

/**
 * The frequency and level under a point in px: frequency held to the axis in whole Hz, level in 0.1 dB.
 *
 * @param {PlotGeometry} geo
 * @param {number} px
 * @param {number} py
 * @returns {[number, number]}  [Hz, dB]
 */
export function pointAt(geo, px, py) {
  const { W, fMin, fMax, decades, plotH, lo, hi } = geo;
  const f = fMin * 10 ** (decades * (px - GUTTER) / (W - GUTTER - RIGHT));
  const d = hi - (py - PAD) * (hi - lo) / plotH;
  return [Math.round(Math.max(fMin, Math.min(fMax, f))), round1(d)];
}

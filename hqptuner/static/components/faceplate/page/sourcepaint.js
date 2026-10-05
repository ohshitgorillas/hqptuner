// The page Source section's moving parts, painted outside preact's render: once per animation frame the meter loop
// (store/meter/loop.js) hands its scene here, and the trace, the held peaks, the level bars and the readings table are
// written straight into the elements SourceMeter rendered. Nothing re-renders while the meter runs.

import { fraction } from "../../../model/gauges/meter.js";
import { minusText } from "../../../model/shell/format.js";

/** @typedef {import("../../../store/meter/loop.js").MeterScene} MeterScene */

/** The spectrum's viewBox; the stylesheet stretches it over the plot. */
export const SW = 600;
export const SH = 170;

/**
 * A fraction of a bar as a CSS percentage.
 *
 * @param {number} f
 */
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * A level array as a path across the viewBox: one point at each column's centre, down from full scale to `range`
 * below it, clamped to the plot.
 *
 * @param {ArrayLike<number>} levels  dBFS
 * @param {number} range  dB
 * @returns {string}
 */
function pathOf(levels, range) {
  const n = levels.length;
  let d = "";
  for (let c = 0; c < n; c++) {
    const y = Math.min(SH, Math.max(0, (-levels[c] / range) * SH));
    d += `${c ? " L" : "M"}${(((c + 0.5) / n) * SW).toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/**
 * Set one attribute on the first element under `root` matching `sel`, where there is one.
 *
 * @param {Element} root
 * @param {string} sel
 * @param {string} name
 * @param {string} value
 */
function setOn(root, sel, name, value) {
  const el = root.querySelector(sel);
  if (el) el.setAttribute(name, value);
}

/**
 * Write one scene into the section rendered under `root`.
 *
 * @param {Element} root
 * @param {MeterScene} scene
 * @param {number} range  dB, the page's Range
 */
export function paintSourcePage(root, scene, range) {
  const sp = scene.spectrum;
  const line = sp ? pathOf(sp.disp, range) : "";
  setOn(root, "path.strace", "d", line);
  setOn(root, "path.shold", "d", sp ? pathOf(sp.peak, range) : "");
  setOn(root, "path.sarea", "d", line && `${line} L${SW},${SH} L0,${SH} Z`);
  const floor = -range;
  Array.from(root.querySelectorAll(".lvb")).forEach((bar, i) => {
    const lv = scene.levels[i];
    const pk = /** @type {HTMLElement | null} */ (bar.querySelector(".pk"));
    const rm = /** @type {HTMLElement | null} */ (bar.querySelector(".rm"));
    const hd = /** @type {HTMLElement | null} */ (bar.querySelector(".hd"));
    if (pk) pk.style.height = pct(lv ? fraction(lv.peak, floor) : 0);
    if (rm) rm.style.height = pct(lv ? fraction(lv.rms, floor) : 0);
    if (hd) {
      hd.style.bottom = pct(lv ? fraction(lv.hold, floor) : 0);
      hd.style.visibility = lv ? "" : "hidden";
    }
  });
  const npk = Array.from(root.querySelectorAll(".npk"));
  const nrm = Array.from(root.querySelectorAll(".nrm"));
  npk.forEach((cell, i) => {
    const lv = scene.levels[i];
    cell.textContent = lv ? minusText(lv.hold.toFixed(1)) : "";
  });
  nrm.forEach((cell, i) => {
    const lv = scene.levels[i];
    cell.textContent = lv ? minusText(lv.rms.toFixed(1)) : "";
  });
}

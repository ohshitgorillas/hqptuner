// The page Source section's moving parts, painted outside preact's render: once per animation frame the meter loop
// (store/meter/loop.js) hands its scene here, and the trace, the level bars and the readings table are
// written straight into the elements SourceMeter rendered. Nothing re-renders while the meter runs.

import { clamp } from "../../../lib/coerce.js";
import { fraction, meterColors } from "../../../model/gauges/meter.js";
import { minusText } from "../../../model/shell/format.js";
import { levelsFloor } from "../../../store/faceplate/page/meter.js";
import { spectrumColors } from "../../../store/ui/prefs.js";
import { accentInForce } from "../../../store/ui/theme.js";

/** @typedef {import("../../../store/meter/loop.js").MeterScene} MeterScene */
/** @typedef {{ peak: number, rms: number, hold: number }} BarFractions */
/** @typedef {{ peak: string, rms: string, hold: string, readout: string }} MeterInks */

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
    const y = clamp((-levels[c] / range) * SH, 0, SH);
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

/** The spectrum styles the SVG draws the trace, its area and its ghost under. */
const TRACED = new Set(["trace"]);

/**
 * Write the colour a level mark or readout is drawn in onto `el` as its `--lv-ink`, which the stylesheet shades the
 * mark from; an empty colour clears it, leaving the stylesheet's instrument amber.
 *
 * @param {Element | null} el
 * @param {string} colour
 */
function inkOn(el, colour) {
  /** @type {HTMLElement | null} */ (el)?.style.setProperty("--lv-ink", colour);
}

/**
 * One level bar as painted: its marks at bar fractions, their colours, and whether the scene has a reading for it.
 *
 * @typedef {{ at: BarFractions, inks: MeterInks, shown: boolean }} BarLook
 */

/** A bar the scene has no reading for: empty, its hold hidden, its marks and readout in the stylesheet's amber. */
const NO_BAR = /** @type {BarLook} */ ({
  at: { peak: 0, rms: 0, hold: 0 },
  inks: { peak: "", rms: "", hold: "", readout: "" },
  shown: false,
});

/**
 * How one reading is painted on a bar running up from `floor`: its marks at their bar fractions, in the colours the
 * meter model picks for those levels under `palette` and `accent`.
 *
 * @param {import("../../../model/gauges/meter.js").LevelReading | undefined} lv
 * @param {number} floor  dBFS
 * @param {string} palette
 * @param {string} accent
 * @returns {BarLook}
 */
function barLook(lv, floor, palette, accent) {
  if (!lv) return NO_BAR;
  const at = { peak: fraction(lv.peak, floor), rms: fraction(lv.rms, floor), hold: fraction(lv.hold, floor) };
  return { at, inks: meterColors(palette, at, accent), shown: true };
}

/**
 * Size and colour one level bar's peak, RMS and hold marks as `look` has them.
 *
 * @param {Element} bar
 * @param {BarLook} look
 */
function paintBar(bar, { at, inks, shown }) {
  const pk = /** @type {HTMLElement | null} */ (bar.querySelector(".pk"));
  const rm = /** @type {HTMLElement | null} */ (bar.querySelector(".rm"));
  const hd = /** @type {HTMLElement | null} */ (bar.querySelector(".hd"));
  if (pk) pk.style.height = pct(at.peak);
  if (rm) rm.style.height = pct(at.rms);
  if (hd) {
    hd.style.bottom = pct(at.hold);
    hd.style.visibility = shown ? "" : "hidden";
  }
  inkOn(pk, inks.peak);
  inkOn(rm, inks.rms);
  inkOn(hd, inks.hold);
}

/**
 * Write one scene into the section rendered under `root`, the spectrum's SVG paths blank where `style` draws on the
 * effects or shader canvas instead, the level bars up from the Levels floor, and the bars and the peak readout in the
 * colours the meter model picks for their levels under the spectrum's palette and the accent in force. `style` is
 * written to the grid's `data-style` on every paint, so the stylesheet follows the style actually drawn rather than
 * the one picked.
 *
 * @param {Element} root
 * @param {MeterScene} scene
 * @param {number} range  dB, the page's Range, the spectrum's span
 * @param {string} [style]  the spectrum style
 */
export function paintSourcePage(root, scene, range, style = "trace") {
  const sp = scene.spectrum;
  setOn(root, ".sgrid1", "data-style", style);
  const line = sp && TRACED.has(style) ? pathOf(sp.disp, range) : "";
  setOn(root, "path.strace", "d", line);
  setOn(root, "path.sarea", "d", line && `${line} L${SW},${SH} L0,${SH} Z`);
  setOn(root, "path.shold", "d", sp && TRACED.has(style) ? pathOf(sp.ghost, range) : "");
  const floor = levelsFloor();
  const palette = spectrumColors.value;
  const accent = accentInForce();
  const looks = scene.levels.map((lv) => barLook(lv, floor, palette, accent));
  Array.from(root.querySelectorAll(".lvb")).forEach((bar, i) => paintBar(bar, looks[i] ?? NO_BAR));
  const npk = Array.from(root.querySelectorAll(".npk"));
  const nrm = Array.from(root.querySelectorAll(".nrm"));
  npk.forEach((cell, i) => {
    const lv = scene.levels[i];
    cell.textContent = lv ? minusText(lv.hold.toFixed(1)) : "";
    inkOn(cell, (looks[i] ?? NO_BAR).inks.readout);
  });
  nrm.forEach((cell, i) => {
    const lv = scene.levels[i];
    cell.textContent = lv ? minusText(lv.rms.toFixed(1)) : "";
  });
}

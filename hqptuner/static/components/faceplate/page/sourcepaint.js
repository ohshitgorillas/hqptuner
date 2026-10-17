// The Source section's per-paint painter: the level bars, the VU needles, the trace and the effects canvases, painted
// from each meter-loop scene. Every moving part steps through the model on the `dt` the paint is handed; the painter
// keeps the stepped state between paints and starts it afresh at a restart or a change in the number of channels.

import { fraction, meterColors, pickBins, spanShare, traceColumns } from "../../../model/gauges/meter/meter.js";
import { freshLevels, freshSpectrum, stepLevels, stepSpectrum } from "../../../model/gauges/meter/steps.js";
import { restVu, stepVu } from "../../../model/gauges/meter/vu.js";
import { levelsFloor } from "../../../store/faceplate/page/meter.js";
import { freqSpan } from "../../../store/faceplate/view.js";
import { vuReference } from "../../../store/ui/prefs.js";
import { accentInForce } from "../../../store/ui/theme.js";
import { paintVu } from "./VuMeter.js";

/** The trace SVG's viewBox width. */
export const SW = 1000;
/** The trace SVG's viewBox height. */
export const SH = 400;

/** @typedef {{ fx: ReturnType<typeof import("./spectrumfx.js").fxPainter>, aurora: import("./aurora.js").AuroraPainter | null }} Painters */

/**
 * @typedef {object} SceneLook
 * @property {number} range The dB span of the trace, positive.
 * @property {string} picked The spectrum style the Display popover picked.
 * @property {string} suite The color suite.
 * @property {number} dt Wall time since the last paint, in seconds.
 */

/** @typedef {import("../../../store/meter/loop.js").MeterScene} MeterScene */

const COLS = 256; // trace columns across the viewBox
const CANVAS_STYLES = new Set(["bars", "ridges", "fade", "fire"]);
const NO_COLUMNS = new Float32Array(0);
const INK = "--lv-ink";

/** The stepped state the painter keeps from one paint to the next. */
const kept = {
  channels: -1,
  levels: freshLevels(0),
  vu: restVu(0),
  /** @type {number[]} */
  rms: [],
  spectrum: freshSpectrum(0),
  /** @type {Float32Array | undefined} */
  pick: undefined,
  reading: { peak: 0, rms: 0, hold: 0 },
};

/**
 * Start every state afresh for `channels` channels.
 *
 * @param {number} channels
 */
function restartAll(channels) {
  kept.channels = channels;
  kept.levels = freshLevels(channels);
  kept.vu = restVu(channels);
  kept.rms = new Array(channels).fill(-Infinity);
  kept.spectrum = freshSpectrum(0);
}

/**
 * Step the levels, the needles and the spectrum through `dt` toward `scene`; the bins the spectrum stepped toward, or
 * null with no channel.
 *
 * @param {MeterScene} scene
 * @param {number} dt
 */
function stepAll(scene, dt) {
  const chs = scene.channels;
  stepLevels(kept.levels, chs, dt);
  for (let i = 0; i < chs.length; i++) kept.rms[i] = chs[i].rms;
  kept.vu = stepVu(kept.vu, kept.rms, dt, Number(vuReference.value));
  if (!chs.length) return;
  kept.pick = pickBins(scene, "sum", kept.pick);
  if (kept.spectrum.disp.length !== kept.pick.length) kept.spectrum = freshSpectrum(kept.pick.length);
  stepSpectrum(kept.spectrum, kept.pick, dt);
}

/**
 * Write `share` of the trough as a percentage.
 *
 * @param {number} share  0 to 1
 */
const pct = (share) => `${(share * 100).toFixed(2)}%`;

/**
 * Paint the level bars and held marks under `root` from the kept readings.
 *
 * @param {Element} root
 * @param {string} suite
 */
function paintBars(root, suite) {
  const span = -levelsFloor();
  const accent = accentInForce();
  const pk = root.querySelectorAll(".lvb .pk");
  const rm = root.querySelectorAll(".lvb .rm");
  const hd = root.querySelectorAll(".lvb .hd");
  const r = kept.reading;
  for (let i = 0; i < kept.levels.length; i++) {
    const v = kept.levels[i];
    r.peak = fraction(v.peak, span);
    r.rms = fraction(v.rms, span);
    r.hold = fraction(v.hold, span);
    const ink = meterColors(suite, r, accent);
    const [p, m, h] = /** @type {HTMLElement[]} */ ([pk[i], rm[i], hd[i]]);
    if (p) {
      p.style.height = pct(r.peak);
      p.style.setProperty(INK, ink.peak);
    }
    if (m) {
      m.style.height = pct(r.rms);
      m.style.setProperty(INK, ink.rms);
    }
    if (h) {
      h.style.bottom = pct(r.hold);
      h.style.visibility = v.hold === -Infinity ? "hidden" : "visible";
      h.style.setProperty(INK, ink.hold);
    }
  }
}

/**
 * The x of column `c` of COLS in the viewBox.
 *
 * @param {number} c
 */
const xOf = (c) => ((c / (COLS - 1)) * SW).toFixed(2);

/**
 * The y of level `db` in the viewBox on a `range` dB trace.
 *
 * @param {number} db
 * @param {number} range
 */
const yOf = (db, range) => ((1 - fraction(db, range)) * SH).toFixed(2);

/**
 * The points of `cols` as absolute path commands, the first a move unless `joined`.
 *
 * @param {ArrayLike<number>} cols  dBFS
 * @param {number} range
 * @param {boolean} joined
 */
function pathOf(cols, range, joined) {
  let d = "";
  for (let c = 0; c < cols.length; c++) d += `${c || joined ? "L" : "M"}${xOf(c)},${yOf(cols[c], range)}`;
  return d;
}

/**
 * Write the trace's line, shadow and area under `root`; with no columns, empty paths.
 *
 * @param {Element} root
 * @param {Float32Array} line  dBFS per column
 * @param {Float32Array} shadow  dBFS per column
 * @param {number} range
 */
function paintTrace(root, line, shadow, range) {
  const [area] = root.querySelectorAll(".sarea");
  const [held] = root.querySelectorAll(".shold");
  const [trace] = root.querySelectorAll(".strace");
  const top = pathOf(line, range, true);
  area?.setAttribute("d", line.length ? `M0,${SH}${top}L${SW},${SH}Z` : "");
  held?.setAttribute("d", pathOf(shadow, range, false));
  trace?.setAttribute("d", line.length ? `M${top.slice(1)}` : "");
}

/**
 * Hand the effects painters the shown columns under the picked style, and no spectrum to the one not drawing.
 *
 * @param {Painters} painters
 * @param {Float32Array} cols  dBFS per column
 * @param {SceneLook} look
 * @param {boolean} restart
 */
function paintCanvases(painters, cols, look, restart) {
  const { range, picked, suite, dt } = look;
  const aurora = picked === "aurora";
  const fxCols = CANVAS_STYLES.has(picked) ? cols : NO_COLUMNS;
  painters.fx.paint(fxCols, range, picked, { suite, dt, restart });
  painters.aurora?.paint(aurora ? cols : null, range, suite, { dt, restart });
}

/**
 * Paint one meter-loop scene into the section under `root` and onto the painters' canvases.
 *
 * @param {Element | null} root
 * @param {MeterScene} scene
 * @param {Painters | null} painters
 * @param {SceneLook} look
 */
export function paintSourceScene(root, scene, painters, look) {
  const { dt, range } = look;
  if (typeof dt !== "number" || !Number.isFinite(dt)) throw new TypeError(`paintSourceScene: dt ${String(dt)}`);
  const restart = scene.restart || scene.channels.length !== kept.channels;
  if (restart) restartAll(scene.channels.length);
  stepAll(scene, dt);
  const share = spanShare(freqSpan.value);
  const has = scene.channels.length > 0;
  const line = has ? traceColumns(kept.spectrum.disp, COLS, share) : NO_COLUMNS;
  if (root) {
    paintBars(root, look.suite);
    paintVu(root, kept.vu.vu);
    const shadow = has ? traceColumns(kept.spectrum.ghost, COLS, share) : NO_COLUMNS;
    paintTrace(root, line, shadow, range);
  }
  if (painters) paintCanvases(painters, line, look, restart);
}

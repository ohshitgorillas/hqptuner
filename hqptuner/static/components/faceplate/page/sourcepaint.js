// The Source section's per-paint painter: the level bars, the VU needles, the trace and the effects canvases, painted
// from each meter-loop scene. Each section has one painter, on the section's elements and canvas painters; it holds
// the stepped state between paints and resets it at a restart or when the number of channels changes. Every moving
// part steps through the model on the `dt` the paint carries. Only the picked style's canvas painter is painted; one
// the pick has just left, and every unpicked one at a restart, gets a single empty paint that clears it.

import { fraction, pickBins, spanShare, traceColumns } from "../../../model/gauges/meter/meter.js";
import { hexAt, rampOf } from "../../../model/gauges/meter/spectrumfx.js";
import { freshLevels, freshSpectrum, stepLevels, stepSpectrum } from "../../../model/gauges/meter/steps.js";
import { restVu, stepVu } from "../../../model/gauges/meter/vu.js";
import { levelsFloor } from "../../../store/faceplate/page/meter.js";
import { freqSpan } from "../../../store/faceplate/view.js";
import { pageRange, spectrumColors, spectrumStyle, vuReference } from "../../../store/ui/prefs.js";
import { accentInForce } from "../../../store/ui/theme.js";
import { needlePainter } from "./VuMeter.js";

/** The trace SVG's viewBox width. */
export const SW = 1000;
/** The trace SVG's viewBox height. */
export const SH = 400;

/** @typedef {import("../../../store/meter/loop.js").MeterScene} MeterScene */
/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").Ramp} Ramp */

/**
 * The Source section's elements, found once when it mounts, and its canvas painters.
 *
 * @typedef {object} SourceElements
 * @property {HTMLElement[]} peaks  per channel, the peak fill
 * @property {HTMLElement[]} rmses  per channel, the RMS fill
 * @property {HTMLElement[]} holds  per channel, the held peak mark
 * @property {Element[]} needles  per channel, the VU needle
 * @property {Element} area  the trace's filled area
 * @property {Element} shadow  the trace's shadow
 * @property {Element} trace  the trace's line
 * @property {ReturnType<typeof import("./spectrumfx.js").fxPainter> | null} fx
 * @property {import("./aurora.js").AuroraPainter | null} aurora
 */

/**
 * What one paint paints under, read from the stores at the paint, and written over by the next.
 *
 * @typedef {object} SceneLook
 * @property {number} range  the dB span of the trace, positive
 * @property {string} picked  the spectrum style the Display popover picked
 * @property {string} suite  the color suite
 * @property {string} selected  the canvas painter the picked style draws on, "" for none
 * @property {number} dt  wall time since the last paint, s
 * @property {boolean} restart
 */

/**
 * The stepped state and the buffers a painter keeps from one paint to the next.
 *
 * @typedef {object} Kept
 * @property {number} channels
 * @property {ReturnType<typeof freshLevels>} levels
 * @property {import("../../../model/gauges/meter/vu.js").VuState} vu
 * @property {number[]} rms
 * @property {ReturnType<typeof freshSpectrum>} spectrum
 * @property {Float32Array | undefined} pick
 * @property {Float32Array} line  dBFS per trace column
 * @property {Float32Array} shadow  dBFS per trace column
 * @property {string} suite  the suite the ramp was built under
 * @property {string} accent  the accent the ramp was built under
 * @property {Ramp | null} ramp
 * @property {string} drawn  the canvas painter whose canvas holds a drawing, "" for none
 * @property {SceneLook} look
 */

const COLS = 256; // trace columns across the viewBox
const CANVAS_STYLES = new Set(["bars", "ridges", "fade", "fire"]);
const NO_COLUMNS = new Float32Array(0);
const INK = "--lv-ink";
const FX = "fx";
const AURORA = "aurora";

/** @returns {Kept} */
function freshKept() {
  return {
    channels: -1,
    levels: freshLevels(0),
    vu: restVu(0),
    rms: [],
    spectrum: freshSpectrum(0),
    pick: undefined,
    line: new Float32Array(COLS),
    shadow: new Float32Array(COLS),
    suite: "",
    accent: "",
    ramp: null,
    drawn: "",
    look: { range: 0, picked: "", suite: "", selected: "", dt: 0, restart: false },
  };
}

/**
 * Start every state in `kept` afresh for `channels` channels.
 *
 * @param {Kept} kept
 * @param {number} channels
 */
function restartAll(kept, channels) {
  kept.channels = channels;
  kept.levels = freshLevels(channels);
  kept.vu = restVu(channels);
  kept.rms = new Array(channels).fill(-Infinity);
  kept.spectrum = freshSpectrum(0);
}

/**
 * The canvas painter `picked` draws on: the effects canvas, the aurora's, or none.
 *
 * @param {string} picked
 */
function selectedOf(picked) {
  if (picked === AURORA) return AURORA;
  return CANVAS_STYLES.has(picked) ? FX : "";
}

/**
 * Fill `look` from the stores for a paint `dt` seconds after the last.
 *
 * @param {SceneLook} look
 * @param {number} dt
 * @param {boolean} restart
 */
function lookNow(look, dt, restart) {
  look.range = Number(pageRange.value);
  look.picked = spectrumStyle.value;
  look.suite = spectrumColors.value;
  look.selected = selectedOf(look.picked);
  look.dt = dt;
  look.restart = restart;
  return look;
}

/**
 * Step the levels, the needles and the spectrum in `kept` through `dt` toward `scene`.
 *
 * @param {Kept} kept
 * @param {MeterScene} scene
 * @param {number} dt
 */
function stepAll(kept, scene, dt) {
  const chs = scene.channels;
  stepLevels(kept.levels, chs, dt);
  for (let i = 0; i < chs.length; i++) kept.rms[i] = chs[i].rms;
  stepVu(kept.vu, kept.rms, dt, Number(vuReference.value));
  if (!chs.length) return;
  kept.pick = pickBins(scene, "sum", kept.pick);
  if (kept.spectrum.disp.length !== kept.pick.length) kept.spectrum = freshSpectrum(kept.pick.length);
  stepSpectrum(kept.spectrum, kept.pick, dt);
}

/**
 * The ramp the bars draw in under `suite` and `accent`, built again only when either changes.
 *
 * @param {Kept} kept
 * @param {string} suite
 * @param {string} accent
 * @returns {Ramp}
 */
function rampFor(kept, suite, accent) {
  if (!kept.ramp || kept.suite !== suite || kept.accent !== accent) {
    kept.ramp = rampOf(suite, accent);
    kept.suite = suite;
    kept.accent = accent;
  }
  return kept.ramp;
}

/**
 * A share of the trough as a CSS percentage.
 *
 * @param {number} share  0 to 1
 */
const pct = (share) => `${(share * 100).toFixed(2)}%`;

/**
 * Paint the level bars and held marks in `els` from `levels`, each part in `ramp`'s color at its own level.
 *
 * @param {SourceElements} els
 * @param {Kept["levels"]} levels
 * @param {Ramp} ramp
 */
function paintBars(els, levels, ramp) {
  const span = -levelsFloor();
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    const peak = fraction(v.peak, span);
    const rms = fraction(v.rms, span);
    const hold = fraction(v.hold, span);
    const p = els.peaks[i];
    const m = els.rmses[i];
    const h = els.holds[i];
    if (p) {
      p.style.height = pct(peak);
      p.style.setProperty(INK, hexAt(ramp, peak));
    }
    if (m) {
      m.style.height = pct(rms);
      m.style.setProperty(INK, hexAt(ramp, rms));
    }
    if (h) {
      h.style.bottom = pct(hold);
      h.style.visibility = v.hold === -Infinity ? "hidden" : "visible";
      h.style.setProperty(INK, hexAt(ramp, hold));
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
 * Write the trace's line, shadow and area in `els`; with no columns, empty paths.
 *
 * @param {SourceElements} els
 * @param {Float32Array} line  dBFS per column
 * @param {Float32Array} shadow  dBFS per column
 * @param {number} range
 */
function paintTrace(els, line, shadow, range) {
  const top = pathOf(line, range, true);
  els.area.setAttribute("d", line.length ? `M0,${SH}${top}L${SW},${SH}Z` : "");
  els.shadow.setAttribute("d", pathOf(shadow, range, false));
  els.trace.setAttribute("d", line.length ? `M${top.slice(1)}` : "");
}

/**
 * The columns canvas painter `who` is handed: `cols` while its style is picked, none when the pick has just left it
 * or at a restart, and null, no paint at all, otherwise.
 *
 * @param {string} who
 * @param {string} drawn  the painter the last paint's style drew on
 * @param {SceneLook} look
 * @param {Float32Array} cols
 * @returns {Float32Array | null}
 */
function handed(who, drawn, look, cols) {
  if (who === look.selected) return cols;
  return look.restart || drawn === who ? NO_COLUMNS : null;
}

/**
 * Hand the picked style's canvas painter the shown columns, and one empty paint to one the pick has just left or, at a
 * restart, to every one not picked.
 *
 * @param {Kept} kept
 * @param {SourceElements} els
 * @param {Float32Array} cols  dBFS per column
 * @param {SceneLook} look
 */
function paintCanvases(kept, els, cols, look) {
  const toFx = handed(FX, kept.drawn, look, cols);
  const toAurora = handed(AURORA, kept.drawn, look, cols);
  if (els.fx && toFx) els.fx.paint(toFx, look.range, look.picked, look);
  if (els.aurora && toAurora) els.aurora.paint(toAurora, look.range, look.suite, look);
  kept.drawn = look.selected;
}

/**
 * A painter on the Source section whose elements and canvas painters `els` holds.
 *
 * @param {SourceElements} els
 */
export function sourcePainter(els) {
  const kept = freshKept();
  const vu = needlePainter(els.needles);
  return {
    /**
     * Paint one meter-loop scene into the section and onto the picked style's canvas.
     *
     * @param {MeterScene} scene
     * @param {{ dt: number }} o  dt is wall seconds since the last paint
     */
    paint(scene, { dt }) {
      if (typeof dt !== "number" || !Number.isFinite(dt)) throw new TypeError(`sourcePainter paint: dt ${String(dt)}`);
      const look = lookNow(kept.look, dt, scene.restart || scene.channels.length !== kept.channels);
      if (look.restart) restartAll(kept, scene.channels.length);
      stepAll(kept, scene, dt);
      const has = scene.channels.length > 0;
      const share = spanShare(freqSpan.value);
      const line = has ? traceColumns(kept.spectrum.disp, COLS, kept.line, share) : NO_COLUMNS;
      const shadow = has ? traceColumns(kept.spectrum.ghost, COLS, kept.shadow, share) : NO_COLUMNS;
      paintBars(els, kept.levels, rampFor(kept, look.suite, accentInForce()));
      vu.paint(kept.vu);
      paintTrace(els, line, shadow, look.range);
      paintCanvases(kept, els, line, look);
    },
  };
}

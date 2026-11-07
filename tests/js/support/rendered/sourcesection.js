// The Source section as the suites for hqptuner/static/components/faceplate/page/sourcepaint.js reach it, and the
// scenes they paint into it. No test() and no assert lives here: every assertion stays at its call site in the suite
// that owns it.
//
// A section is an element bag of fake elements, handed to `sourcePainter` once when the section is made, and the
// painter made from it. The bag holds, one per channel and in channel order, the peak fills, the RMS fills, the held
// peak marks and the VU needles, then the trace's area, shadow and line paths, and the canvas painters, none unless a
// suite hands them in. Each fake keeps its inline style, custom properties and attributes for a suite to read. Its
// elements start with no inline style, so a part the painter never writes reads as empty, except a held mark's
// visibility where a suite states what an earlier paint left. A trace path is read as the pairs of numbers its `d`
// holds, x then y, which assumes absolute coordinates. A needle carries its half sweep, degrees, hung on it as
// `vuSweep` the way its face hangs it, and is turned by a `rotate(...)` transform: a needle at share s of the VU scale
// stands at (2s - 1) times its half sweep, the bottom of the scale at minus the half sweep and the top at plus it.
//
// A scene is a meter-loop scene: channels of peak, RMS and bins in dBFS, the linear power of one frame of them, and
// whether the paint restarts. Every run a helper starts begins with a restart, as the meter loop's first paint does. A
// paint is told the seconds since the last one; the page's Range, the spectrum style and the color suite it paints
// under are the prefs store's, which `paint` sets from the look it is handed before each paint, so a suite using it
// restores `pageRange`, `spectrumStyle` and `spectrumColors` after each test.

import { SH, sourcePainter } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { pageRange, spectrumColors, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { rasterCanvas } from "../raster.js";

/** @typedef {{ peak: number, rms: number, bins: Float32Array }} Channel */
/** @typedef {{ channels: Channel[], power: Float64Array[], restart: boolean }} Scene */
/** @typedef {ReturnType<typeof fakeElement>} Fake */
/** @typedef {ReturnType<typeof fxPainter>} FxPainter */
/** @typedef {{ fx: FxPainter | null, aurora: null }} Painters */
/**
 * @typedef {object} Bag
 * @property {Fake[]} peaks
 * @property {Fake[]} rmses
 * @property {Fake[]} holds
 * @property {Fake[]} needles
 * @property {Fake} area
 * @property {Fake} shadow
 * @property {Fake} trace
 * @property {FxPainter | null} fx
 * @property {null} aurora
 */
/** @typedef {{ els: Bag, painter: ReturnType<typeof sourcePainter> }} Section */
/** @typedef {(root: Section) => number[]} Reader */
/** @typedef {{ range?: number, picked?: string, suite?: string }} Look */

/** Bins a channel carries: bin k of BINS sits at k/(BINS-1) of Nyquist. */
export const BINS = 65;
/** The narrowest Range, dB. */
export const RANGE = 120;
/** One steady paint, s. */
export const STEP_S = 1 / 32;
/** A long settle, s. */
export const SETTLE_S = 5;
/** Levels, dBFS. */
export const LOUD_DB = -6;
export const MID_DB = -30;
export const QUIET_DB = -54;
/** The spectrum style that draws on no canvas, and a color suite, as the store holds them. */
export const TRACE = "trace";
export const MONO = "mono";
/** The half sweep a needle's face carries, degrees. */
const HALF_SWEEP = 40;
/** The effects canvas, device pixels, its glass fill, and what its random source always answers. */
const W = 64;
const H = 32;
const GLASS = "#101418";
const DRAW = 0.5;

/**
 * One element: inline style, custom properties and attributes, kept as written.
 *
 * @param {Record<string, string>} [attrs]
 * @param {Record<string, string>} [inline]
 */
function fakeElement(attrs = {}, inline = {}) {
  /** @type {Map<string, string>} */
  const custom = new Map();
  /** @type {Map<string, string>} */
  const attributes = new Map(Object.entries(attrs));
  const style = {
    height: "",
    bottom: "",
    visibility: "",
    ...inline,
    setProperty: (/** @type {string} */ name, /** @type {string} */ value) => void custom.set(name, String(value)),
    getPropertyValue: (/** @type {string} */ name) => custom.get(name) ?? "",
    removeProperty: (/** @type {string} */ name) => void custom.delete(name),
  };
  return {
    style,
    setAttribute: (/** @type {string} */ name, /** @type {unknown} */ value) =>
      void attributes.set(name, String(value)),
    getAttribute: (/** @type {string} */ name) => attributes.get(name) ?? null,
    removeAttribute: (/** @type {string} */ name) => void attributes.delete(name),
  };
}

/** No canvas painters. */
const NO_PAINTERS = { fx: null, aurora: null };

/**
 * A Source section of `n` channels and the painter made on it with the canvas painters `painters`, its held marks
 * starting with the inline visibility `held`.
 *
 * @param {number} n
 * @param {string} [held]
 * @param {Painters} [painters]
 * @returns {Section}
 */
export function section(n, held = "", painters = NO_PAINTERS) {
  const many = (/** @type {() => Fake} */ make) => Array.from({ length: n }, make);
  /** @type {Bag} */
  const els = {
    peaks: many(() => fakeElement()),
    rmses: many(() => fakeElement()),
    holds: many(() => fakeElement({}, { visibility: held })),
    needles: many(() => Object.assign(fakeElement(), { vuSweep: { half: HALF_SWEEP } })),
    area: fakeElement(),
    shadow: fakeElement(),
    trace: fakeElement(),
    ...painters,
  };
  return { els, painter: sourcePainter(/** @type {any} */ (els)) };
}

/**
 * The number an inline percentage holds; NaN where none was written.
 *
 * @param {string} value
 */
const pct = (value) => (value.trim().endsWith("%") ? Number.parseFloat(value) : Number.NaN);

/** @type {Reader} */
export const peaks = (root) => root.els.peaks.map((e) => pct(e.style.height));
/** @type {Reader} */
export const rmses = (root) => root.els.rmses.map((e) => pct(e.style.height));
/** @type {Reader} */
export const holds = (root) => root.els.holds.map((e) => pct(e.style.bottom));

/**
 * The angle a needle's transform turns it to, degrees; NaN where none was written.
 *
 * @param {Fake} needle
 */
function angleOf(needle) {
  const m = /rotate\(\s*(-?[\d.]+)/.exec(needle.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : Number.NaN;
}

/** @type {Reader} */
export const needles = (root) => root.els.needles.map(angleOf);

/**
 * The angle a needle stands at, degrees, at `share` of the VU scale.
 *
 * @param {number} share
 */
export const angleAt = (share) => (2 * share - 1) * HALF_SWEEP;

/**
 * The points a path's `d` holds, as x, y pairs.
 *
 * @param {Fake} path
 * @returns {[number, number][]}
 */
export function pointsOf(path) {
  const nums = (path.getAttribute("d") ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  /** @type {[number, number][]} */
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([Number(nums[i]), Number(nums[i + 1])]);
  return pts;
}

/**
 * The mean y of the trace line; NaN with no line.
 *
 * @param {Section} root
 */
export function lineY(root) {
  const ys = pointsOf(root.els.trace).map(([, y]) => y);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.NaN;
}

/**
 * The mean level the trace line shows on a RANGE dB trace, dBFS; NaN with no line.
 *
 * @param {Section} root
 */
export const lineLevel = (root) => (-lineY(root) / SH) * RANGE;

/**
 * One channel: its peak and RMS, and every bin at `bin`, or the bins handed.
 *
 * @param {number} peak
 * @param {number} rms
 * @param {number | Float32Array} bin
 * @returns {Channel}
 */
export const channel = (peak, rms, bin) => ({
  peak,
  rms,
  bins: typeof bin === "number" ? new Float32Array(BINS).fill(bin) : bin,
});

/**
 * A scene of `channels`, its power the linear power of one frame of them.
 *
 * @param {Channel[]} channels
 * @param {boolean} [restart]
 * @returns {Scene}
 */
export function sceneOf(channels, restart = false) {
  const power = channels.map((c) => {
    const p = new Float64Array(c.bins.length + 1);
    c.bins.forEach((db, k) => (p[k] = 10 ** (db / 10)));
    p[c.bins.length] = 10 ** (c.rms / 10);
    return p;
  });
  return { channels, power, restart };
}

/**
 * A stereo scene, both channels at `db` for peak, RMS and every bin.
 *
 * @param {number} db
 * @param {boolean} [restart]
 */
export const level = (db, restart = false) => sceneOf([channel(db, db, db), channel(db, db, db)], restart);

/** A stereo scene with nothing heard, restarting. */
export const nothing = () => level(-Infinity, true);

/**
 * Paint `scene` into `root` under the look, `dt` seconds after the last paint.
 *
 * @param {Section} root
 * @param {Scene} scene
 * @param {number} dt
 * @param {Look} [o]
 */
export function paint(root, scene, dt, o = {}) {
  pageRange.value = String(o.range ?? RANGE);
  spectrumStyle.value = o.picked ?? TRACE;
  spectrumColors.value = o.suite ?? MONO;
  root.painter.paint(/** @type {any} */ (scene), { dt });
}

/**
 * `seconds` of steady paints of `scene`, STEP_S apart.
 *
 * @param {Section} root
 * @param {() => Scene} scene
 * @param {number} seconds
 * @param {Look} [o]
 */
export function hold(root, scene, seconds, o = {}) {
  for (let t = 0; t < seconds - 1e-9; t += STEP_S) paint(root, scene(), STEP_S, o);
}

/**
 * A stereo section that has shown `db` steadily for `seconds`, starting with a restart.
 *
 * @param {number} db
 * @param {number} [seconds]
 */
export function steady(db, seconds = SETTLE_S) {
  const root = section(2);
  paint(root, level(db, true), STEP_S);
  hold(root, () => level(db), seconds);
  return root;
}

/** A raster effects canvas under the real fx painter, handed a random source that always answers DRAW. */
export function fxCanvas() {
  const canvas = rasterCanvas(W, H);
  const seams = { random: () => DRAW, makeCanvas: rasterCanvas };
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), { glass: GLASS }, seams);
  return { canvas, fx };
}

/**
 * The ink a canvas holds in all.
 *
 * @param {{ ink: Float32Array }} canvas
 */
export const inkOf = (canvas) => canvas.ink.reduce((a, b) => a + b, 0);

/**
 * How far apart two readings stand, number by number; NaN where they differ in length or hold none.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
export function apart(a, b) {
  if (!a.length || a.length !== b.length) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

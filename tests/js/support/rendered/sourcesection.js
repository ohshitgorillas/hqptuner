// The Source section as the suites for hqptuner/static/components/faceplate/page/sourcepaint.js reach it, and the
// scenes they paint into it. No test() and no assert lives here: every assertion stays at its call site in the suite
// that owns it.
//
// The section is a fake element tree that answers `querySelectorAll` from a table keyed by the selectors the section's
// markup is reached by, and keeps each element's inline style, custom properties and attributes for a suite to read; a
// selector outside the table throws, naming itself. Its elements start with no inline style, so a part the painter
// never writes reads as empty, except a held mark's visibility where a suite states what an earlier paint left. A
// trace path is read as the pairs of numbers its `d` holds, x then y, which assumes absolute coordinates.
//
// A scene is a meter-loop scene: channels of peak, RMS and bins in dBFS, the linear power of one frame of them, and
// whether the paint restarts. Every run a helper starts begins with a restart, as the meter loop's first paint does.

import { paintSourceScene, SH } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { paintVu } from "../../../../hqptuner/static/components/faceplate/page/VuMeter.js";
import { rasterCanvas } from "../raster.js";

/** @typedef {{ peak: number, rms: number, bins: Float32Array }} Channel */
/** @typedef {{ channels: Channel[], power: Float64Array[], restart: boolean }} Scene */
/** @typedef {ReturnType<typeof section>} Section */
/** @typedef {ReturnType<typeof fakeElement>} Fake */
/** @typedef {{ paints: unknown[][], clears: number, paint: (...a: unknown[]) => void, clear: () => void }} Recorder */
/** @typedef {(root: Section) => number[]} Reader */
/** @typedef {{ painters?: unknown, range?: number, picked?: string, suite?: string }} Look */

/** Bins a channel carries: bin k of BINS sits at k/(BINS-1) of Nyquist. */
export const BINS = 65;
/** A 60 dB trace. */
export const RANGE = 60;
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
const HALF_SWEEP = "40";
/** The effects canvas, device pixels, and its glass fill. */
const W = 64;
const H = 32;
const GLASS = "#101418";

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

/**
 * A Source section of `n` channels, its held marks starting with the inline visibility `held`.
 *
 * @param {number} n
 * @param {string} [held]
 */
export function section(n, held = "") {
  const many = (/** @type {() => Fake} */ make) => Array.from({ length: n }, make);
  /** @type {Record<string, Fake[]>} */
  const table = {
    ".lvb": many(() => fakeElement()),
    ".lvb .pk": many(() => fakeElement()),
    ".lvb .rm": many(() => fakeElement()),
    ".lvb .hd": many(() => fakeElement({}, { visibility: held })),
    ".vun": many(() => fakeElement({ "data-half": HALF_SWEEP })),
    ".sarea": [fakeElement()],
    ".shold": [fakeElement()],
    ".strace": [fakeElement()],
  };
  /** @param {string} sel */
  const all = (sel) => {
    const key = sel.trim();
    if (!(key in table)) throw new Error(`fake section: no table row for selector ${key}`);
    return table[key];
  };
  return { table, querySelectorAll: all, querySelector: (/** @type {string} */ sel) => all(sel)[0] ?? null };
}

/**
 * The number an inline percentage holds; NaN where none was written.
 *
 * @param {string} value
 */
const pct = (value) => (value.trim().endsWith("%") ? Number.parseFloat(value) : Number.NaN);

/** @type {Reader} */
export const peaks = (root) => root.table[".lvb .pk"].map((e) => pct(e.style.height));
/** @type {Reader} */
export const rmses = (root) => root.table[".lvb .rm"].map((e) => pct(e.style.height));
/** @type {Reader} */
export const holds = (root) => root.table[".lvb .hd"].map((e) => pct(e.style.bottom));

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
export const needles = (root) => root.table[".vun"].map(angleOf);

/**
 * The angle paintVu turns a needle to for `reading` VU, or for no reading at all.
 *
 * @param {number} [reading]
 */
export function oracleAngle(reading) {
  const needle = fakeElement({ "data-half": HALF_SWEEP });
  const root = /** @type {Element} */ (/** @type {unknown} */ ({ querySelectorAll: () => [needle] }));
  paintVu(root, reading === undefined ? [] : [reading]);
  return angleOf(needle);
}

/**
 * The points a path's `d` holds, as x, y pairs.
 *
 * @param {Section} root
 * @param {string} sel
 * @returns {[number, number][]}
 */
export function pointsOf(root, sel) {
  const nums = (root.table[sel][0].getAttribute("d") ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  /** @type {[number, number][]} */
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([Number(nums[i]), Number(nums[i + 1])]);
  return pts;
}

/** @type {Reader} */
export const lineYs = (root) => pointsOf(root, ".strace").map(([, y]) => y);
/** @type {Reader} */
export const shadowYs = (root) => pointsOf(root, ".shold").map(([, y]) => y);

/**
 * The level, dBFS on a `range` dB trace, that a y in the viewBox stands for.
 *
 * @param {number} y
 * @param {number} [range]
 */
export const levelAt = (y, range = RANGE) => (-y / SH) * range;

/**
 * The mean y of the trace line; NaN with no line.
 *
 * @param {Section} root
 */
export function lineY(root) {
  const ys = lineYs(root);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.NaN;
}

/**
 * The mean level the trace line shows on a RANGE dB trace, dBFS; NaN with no line.
 *
 * @param {Section} root
 */
export const lineLevel = (root) => levelAt(lineY(root));

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
 * Paint `scene` into `root` and the look's painters, `dt` seconds after the last paint.
 *
 * @param {Section | null} root
 * @param {Scene} scene
 * @param {number} dt
 * @param {Look} [o]
 */
export function paint(root, scene, dt, o = {}) {
  const painters = /** @type {any} */ (o.painters ?? null);
  const seen = { range: o.range ?? RANGE, picked: o.picked ?? TRACE, suite: o.suite ?? MONO, dt };
  paintSourceScene(/** @type {any} */ (root), /** @type {any} */ (scene), painters, seen);
}

/**
 * `seconds` of steady paints of `scene`, STEP_S apart.
 *
 * @param {Section | null} root
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

/**
 * A stereo section after a loud restart and then `seconds` of quiet.
 *
 * @param {number} seconds
 */
export function loudThenQuiet(seconds) {
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S);
  hold(root, () => level(QUIET_DB), seconds);
  return root;
}

/** A raster effects canvas under the real fx painter. */
export function fxCanvas() {
  const canvas = rasterCanvas(W, H);
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), { glass: GLASS });
  return { canvas, fx };
}

/**
 * The ink a canvas holds in all.
 *
 * @param {{ ink: Float32Array }} canvas
 */
export const inkOf = (canvas) => canvas.ink.reduce((a, b) => a + b, 0);

/**
 * A painter that keeps each call's arguments and draws nothing.
 *
 * @returns {Recorder}
 */
export function recorder() {
  /** @type {Recorder} */
  const r = {
    paints: [],
    clears: 0,
    paint: (...args) => void r.paints.push(args),
    clear: () => void (r.clears += 1),
  };
  return r;
}

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

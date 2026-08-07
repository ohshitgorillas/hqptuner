// --- matrix stage responses (matrix-spec.md "Response plot") -----------------
// Same RBJ cookbook discipline as the loudness bands: exact coefficients, no
// approximation. A pipeline chain's response is the per-stage sum (dB / deg).
//
// Its own module because this is the plugin-name dispatch layer: it owns the
// mapping from a stage's `kind`/`type` to the kernel call that evaluates it, and
// nothing about that dispatch belongs in the kernel itself.

import {
  DEG,
  TAU,
  biquadMagDb,
  biquadPhaseDeg,
  firstOrder,
  iirContext,
  plainBiquad,
  rawBiquad,
  rbjAlpha,
  shelfFromAlpha,
  peakBiquad,
  wrapDeg,
} from "./biquad.js";
import { convResponse } from "./impulse.js";

/**
 * @typedef {import("./biquad.js").StageArgs} StageArgs
 * @typedef {import("./biquad.js").Biquad} Biquad
 * @typedef {import("./biquad.js").Response} Response
 * @typedef {import("./biquad.js").IirCtx} IirCtx
 * @typedef {{ kind: string, args?: StageArgs, file?: string }} Stage
 *   One matrix-pipeline stage. `args` is OPTIONAL because a conv stage carries
 *   a `file` and no arguments at all — stageResponse dispatches it to
 *   convResponse(stage.file) without ever reading `args`. Declaring it required
 *   made every parseProcess() result (lib/matrixspec.js, which has always had it
 *   optional) unassignable to Stage, which is what stood behind the errors in
 *   matrixplot-traces.js, XfeedComp.js and StructuralXfeed.js.
 */

// The two sides of that optionality, read one way. `args` belongs to the plugin
// stages and `file` to conv, so each is absent on the other's kind; the empty
// value returned for a wrong-kind stage is what the absent key already meant.
// Local rather than imported from lib/matrixspec.js: `Stage` above is structural
// on purpose, and dsp depends on no other module for it.
/**
 * @param {Stage} stage
 * @returns {StageArgs}
 */
export const stageArgs = (stage) => stage.args || {};
/**
 * @param {Stage} stage
 * @returns {string}
 */
export const stageFile = (stage) => stage.file || "";

// Second-order types, dispatched by name. Shelves carry the gain into their
// own alpha (A); the plain pass/reject types take A = 1 — they have no gain.
/** @type {Record<string, (c: IirCtx) => Biquad>} */
const SECOND_ORDER = {
  peak: (c) => peakBiquad(c.w0, rbjAlpha(c.w0, c.args, c.A), c.A),
  lshelf: (c) => shelfFromAlpha("lshelf", rbjAlpha(c.w0, c.args, c.A), c),
  hshelf: (c) => shelfFromAlpha("hshelf", rbjAlpha(c.w0, c.args, c.A), c),
  lp: (c) => plainBiquad("lp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  hp: (c) => plainBiquad("hp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  bp: (c) => plainBiquad("bp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  notch: (c) => plainBiquad("notch", c.w0, rbjAlpha(c.w0, c.args, 1)),
  ap: (c) => plainBiquad("ap", c.w0, rbjAlpha(c.w0, c.args, 1)),
};

const FIRST_ORDER = new Set(["lp1", "hp1"]);

// One iir-plugin stage -> normalized biquad coefficients (null = unplottable).
/**
 * @param {StageArgs} args
 * @param {number} fs
 * @returns {Biquad | null}
 */
export function iirStageCoeffs(args, fs) {
  const type = String(args.type);
  if (type === "biquad") return rawBiquad(args);
  const f0 = Number(args.f);
  if (!Number.isFinite(f0) || f0 <= 0 || f0 >= fs / 2) return null;
  if (FIRST_ORDER.has(type)) return firstOrder(type, f0, fs);
  const build = SECOND_ORDER[type];
  return build ? build(iirContext(args, f0, fs)) : null;
}

// --- non-IIR stages ----------------------------------------------------------

const SPEED_OF_SOUND = 343.956;

/**
 * @param {StageArgs} args
 * @param {number} fs
 * @returns {number}
 */
function delaySeconds(args, fs) {
  if (args.t !== undefined) return Number(args.t);
  if (args.s !== undefined) return Number(args.s) / fs;
  if (args.d !== undefined) return Number(args.d) / (Number(args.v) || SPEED_OF_SOUND);
  return 0;
}

// RIAA de-emphasis: zero at 318 µs, poles at 3180 µs and 75 µs, normalized to
// 0 dB at 1 kHz; optional first-order 20 Hz subsonic pole.
/**
 * @param {number} f
 * @returns {Response}
 */
function riaaRaw(f) {
  const w = TAU * f;
  const db =
    20 * Math.log10(Math.hypot(1, w * 318e-6)) -
    20 * Math.log10(Math.hypot(1, w * 3180e-6)) -
    20 * Math.log10(Math.hypot(1, w * 75e-6));
  const deg = (Math.atan2(w * 318e-6, 1) - Math.atan2(w * 3180e-6, 1) - Math.atan2(w * 75e-6, 1)) * DEG;
  return { db, deg };
}
const RIAA_REF_DB = riaaRaw(1000).db;

/**
 * @param {number} f
 * @param {boolean} subsonic
 * @returns {Response}
 */
export function riaaResponse(f, subsonic) {
  const r = riaaRaw(f);
  let db = r.db - RIAA_REF_DB;
  let deg = r.deg;
  if (subsonic) {
    const w = TAU * f;
    const w0 = TAU * 20;
    db += 20 * Math.log10(w / Math.hypot(w, w0));
    deg += (Math.PI / 2 - Math.atan2(w, w0)) * DEG;
  }
  return { db, deg: wrapDeg(deg) };
}

// One stage's response at f. null = unplottable (bad args, or a conv file not
// uploaded this session — the plot marks the row partial).
/**
 * @param {Stage} stage
 * @param {number} f
 * @param {number} fs
 * @returns {Response | null}
 */
export function stageResponse(stage, f, fs) {
  if (stage.kind === "iir") {
    const c = iirStageCoeffs(stageArgs(stage), fs);
    return c && { db: biquadMagDb(c, f, fs), deg: biquadPhaseDeg(c, f, fs) };
  }
  if (stage.kind === "delay") {
    return { db: 0, deg: wrapDeg(-360 * f * delaySeconds(stageArgs(stage), fs)) };
  }
  if (stage.kind === "riaa") return riaaResponse(f, stageArgs(stage).subsonic !== "0");
  if (stage.kind === "conv") return convResponse(stageFile(stage), f);
  return null;
}

// Recognition: reverse-engineer the three physical controls back out of sixteen
// compiled rows. Structural, exactly like msRecognize: no tag, no metadata, no
// stored flag. The block is over-determined — alphaNear and alphaFar both derive
// from the speaker angle, and three of the eight gains per ear are redundant —
// so the redundancy IS the hand-edit detector. A block that fails any cross-check
// is not "broken", it is simply not ours: it stands as ordinary rows and the card
// steps back.
//
// Its own module because it is the inverse of compile.js and much the larger
// half: a pipeline of independent structural checks that only the card's badge
// path needs.

import { SPEED_OF_SOUND, ALPHA_MIN, THETA_MIN, pathParams } from "./geometry.js";
import { earCoefficients } from "./compile.js";

/**
 * @typedef {import("../matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("./geometry.js").PathParams} PathParams
 * @typedef {{ lambda: number, angle: number, headRadius: number,
 *   preampDb: { left: number, right: number }, eqProcess: { left: string, right: string } }} StructuralRecognition
 *   The controls recognizeRows recovers from sixteen compiled rows.
 */

const ANGLE_TOLERANCE = 0.5; // degrees, between the two independent recoveries
const GAIN_TOLERANCE = 1e-6; // on redundant gains, well above 9-decimal wire rounding

// The (lowpass, delayed, opposite) signature each of an ear's eight rows carries,
// in the order compileRows emits them.
const EAR_PATTERN = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [true, true, false],
  [false, false, true],
  [true, false, true],
  [false, true, true],
  [true, true, true],
];

// Split a row's chain into the block's own prefix stages and whatever EQ follows.
/**
 * @param {string} process
 * @returns {{ corner: number | null, delaySec: number | null, eqProcess: string }}
 */
function splitChain(process) {
  const stages = process ? process.split(",") : [];
  let i = 0;
  let corner = null;
  let delaySec = null;
  const lp = /^iir:type=lp1;f=([\d.]+)$/.exec(stages[i] || "");
  if (lp) {
    corner = Number(lp[1]);
    i += 1;
  }
  const dl = /^delay:t=([\d.]+)$/.exec(stages[i] || "");
  if (dl) {
    delaySec = Number(dl[1]);
    i += 1;
  }
  return { corner, delaySec, eqProcess: stages.slice(i).join(",") };
}

// Invert eq. (5): the speaker angle that produces this alpha, or null if none does.
/**
 * @param {number} alpha
 * @param {string} ear "near" or "far"
 * @returns {number | null}
 */
function angleFromAlpha(alpha, ear) {
  const arg = (alpha - (1 + ALPHA_MIN / 2)) / (1 - ALPHA_MIN / 2);
  if (!(arg >= -1 && arg <= 1)) return null;
  const theta = (THETA_MIN / Math.PI) * Math.acos(arg);
  return ear === "near" ? 90 - theta : theta - 90;
}

// Recognize a compiled block at rows[at..at+15]. Returns the controls that
// produced it — {lambda, angle, headRadius, preampDb, eqProcess} — or null.
// A row this recognizer can even look at. Rows reaching here are whatever the
// user last hand-edited, so a malformed one must DECLINE the block (dropping the
// badge, per the card's contract) rather than throw: recognition runs inside a
// render path, and a TypeError there takes the tab down instead of the badge.
// `process` absent is legal — a bare flat row carries no chain.
const usableRow = (/** @type {PipelineRow} */ r) =>
  !!r && r.gainunit === "Lin" && (r.process == null || typeof r.process === "string");

// Recognition is a pipeline of independent checks, each of which either yields
// the next stage's input or refuses the block. The helpers below are private:
// the contract is recognizeRows' return value, and tests/js/binaural.test.js
// reaches every one of them through it.

const snap = (/** @type {number} */ x, /** @type {number} */ step) => Math.round(x / step) * step;

// The chain structure shared across the block: one EQ tail per ear, and exactly
// eight lowpass corners and eight delays, each set internally identical.
/**
 * @param {PipelineRow[]} block the sixteen candidate rows
 * @returns {{ eqProcess: { left: string, right: string }, corner: number, delay: number } | null}
 */
function chainParts(block) {
  const parts = block.map((r) => splitChain(r.process));
  // per ear, not globally — the two ears may carry different corrections
  const eqProcess = { left: parts[0].eqProcess, right: parts[8].eqProcess };
  if (parts.slice(0, 8).some((p) => p.eqProcess !== eqProcess.left)) return null;
  if (parts.slice(8).some((p) => p.eqProcess !== eqProcess.right)) return null;
  const corners = parts.filter((p) => p.corner !== null).map((p) => p.corner);
  const delays = parts.filter((p) => p.delaySec !== null).map((p) => p.delaySec);
  if (corners.length !== 8 || delays.length !== 8) return null;
  if (corners.some((c) => c !== corners[0]) || delays.some((d) => d !== delays[0])) return null;
  return { eqProcess, corner: corners[0], delay: delays[0] };
}

// One row against its position in the eight-row ear signature.
/**
 * @param {PipelineRow} row
 * @param {number} i the row's position within its ear
 * @param {number} e the ear index, 0 or 1
 * @param {{ outs: string[], srcs: string[] }} routing
 * @returns {boolean}
 */
function rowMatchesPattern(row, i, e, { outs, srcs }) {
  const [lp, delayed, opposite] = EAR_PATTERN[i];
  const p = splitChain(row.process);
  if ((p.corner !== null) !== lp || (p.delaySec !== null) !== delayed) return false;
  return row.mixdown === outs[e] && row.source === srcs[opposite ? 1 - e : e];
}

// The two ears, once their routing is confirmed. Distinct mixdowns is what
// rejects a degenerate block feeding both ears from one source.
/**
 * @param {PipelineRow[]} block
 * @returns {PipelineRow[][] | null}
 */
function earLayout(block) {
  const ears = [block.slice(0, 8), block.slice(8, 16)];
  const outs = [ears[0][0].mixdown, ears[1][0].mixdown];
  const srcs = [ears[0][0].source, ears[1][0].source];
  if (outs[0] === outs[1] || srcs[0] !== outs[0] || srcs[1] !== outs[1]) return null;
  const routed = ears.every((ear, e) => ear.every((row, i) => rowMatchesPattern(row, i, e, { outs, srcs })));
  return routed ? ears : null;
}

// One ear's controls, from its own eight gains.
/**
 * @param {PipelineRow[]} ear one ear's eight rows
 * @returns {{ k: number, lambda: number, alphaFar: number, alphaNear: number } | null}
 */
function recoverEar(ear) {
  const g = ear.map((r) => Number(r.gain));
  const same = g[6] + g[7]; // (lambda+1)/4 * k
  const cross = g[2] + g[3]; // (lambda-1)/4 * k
  const diff = same - cross; // k/2
  if (!(diff > 0)) return null;
  return {
    k: 2 * diff,
    lambda: (same + cross) / diff,
    alphaFar: g[6] / same,
    alphaNear: 1 - g[1] / same,
  };
}

// Per-ear preamps mean the two k values may legitimately differ, but lambda and
// the two alphas describe one crossfeed and must agree across ears — a
// disagreement is a hand-edit.
/**
 * @param {PipelineRow[][]} ears
 * @returns {{ lambda: number, alphaNear: number, alphaFar: number, ks: number[] } | null}
 */
function recoverBoth(ears) {
  const [a, b] = ears.map(recoverEar);
  if (!a || !b) return null;
  if (Math.abs(a.lambda - b.lambda) > 1e-4) return null;
  if (Math.abs(a.alphaNear - b.alphaNear) > 1e-4) return null;
  if (Math.abs(a.alphaFar - b.alphaFar) > 1e-4) return null;
  return {
    lambda: (a.lambda + b.lambda) / 2,
    alphaNear: (a.alphaNear + b.alphaNear) / 2,
    alphaFar: (a.alphaFar + b.alphaFar) / 2,
    ks: [a.k, b.k],
  };
}

// Near and far ear are independent routes to the speaker angle; require both to
// be in the model's domain and to agree.
/**
 * @param {number} alphaNear
 * @param {number} alphaFar
 * @returns {number | null}
 */
function angleFromAlphas(alphaNear, alphaFar) {
  const fromNear = angleFromAlpha(alphaNear, "near");
  const fromFar = angleFromAlpha(alphaFar, "far");
  if (fromNear === null || fromFar === null) return null;
  if (Math.abs(fromNear - fromFar) > ANGLE_TOLERANCE) return null;
  return (fromNear + fromFar) / 2;
}

// Every one of the sixteen gains must match what the recovered controls
// generate, each ear against its own preamp. This subsumes the redundancy
// within an ear and covers both — an edit to a second-ear row would otherwise
// pass unnoticed.
/**
 * @param {PipelineRow[][]} ears
 * @param {number} lambda
 * @param {PathParams} p
 * @param {{ left: number, right: number }} preampDb
 * @returns {boolean}
 */
function gainsMatch(ears, lambda, p, preampDb) {
  const coeffs = earCoefficients(lambda, p.alphaNear, p.alphaFar);
  const ks = [10 ** (preampDb.left / 20), 10 ** (preampDb.right / 20)];
  return ears.every((ear, e) =>
    ear.every((row, i) => Math.abs(Number(row.gain) - coeffs[i].gain * ks[e]) <= GAIN_TOLERANCE),
  );
}

/**
 * @param {PipelineRow[]} rows
 * @param {number} [at] first row of the candidate block
 * @returns {StructuralRecognition | null}
 */
export function recognizeRows(rows, at = 0) {
  const block = rows.slice(at, at + 16);
  if (block.length < 16 || !block.every(usableRow)) return null;

  const chains = chainParts(block);
  if (!chains) return null;
  const ears = earLayout(block);
  if (!ears) return null;
  const raw = recoverBoth(ears);
  if (!raw) return null;
  const angle = angleFromAlphas(raw.alphaNear, raw.alphaFar);
  if (angle === null) return null;

  // Snap to the control grid before anything else. The gains arrive quantized to
  // the wire's 9 decimals, so raw recovery lands a few ulps off the values that
  // produced them; recompiling from those would differ in the last digit and the
  // block would read as edited on every render. Snapping is what makes
  // compile -> recognize -> compile byte-stable, the same reason msRecognize
  // snaps its slider fraction to a 1 % grid. It is also why an off-grid control
  // is REFUSED rather than rounded: the gain check below re-derives from the
  // snapped value at a tolerance far tighter than the snap step.
  const lambda = snap(raw.lambda, 1e-4);
  const headRadius = snap(SPEED_OF_SOUND / (Math.PI * chains.corner), 1e-5);
  const preampDb = {
    left: snap(20 * Math.log10(raw.ks[0]), 1e-3),
    right: snap(20 * Math.log10(raw.ks[1]), 1e-3),
  };

  const angleSnapped = snap(angle, 0.01);
  const p = pathParams(angleSnapped, headRadius);
  if (!gainsMatch(ears, lambda, p, preampDb)) return null;
  // corner and delay are independent routes to the head radius; require agreement
  if (Math.abs(p.itd - chains.delay) > 2e-6) return null;

  return { lambda, angle: angleSnapped, headRadius, preampDb, eqProcess: chains.eqProcess };
}

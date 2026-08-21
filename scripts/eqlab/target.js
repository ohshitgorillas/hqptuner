// Target curves — what the chain SHOULD look like, so deviation from it can be
// scored directly. This is what makes an objective ungameable: collateral
// damage anywhere in a scored range costs the objective itself, instead of
// hiding outside whatever scalar proxy the objective happened to name.
//
// Job field:
//   "target": { "from": "current" | "flat" | "points" | "chain" | "parametric_eq" | "difference",
//               ...source args (points: [[hz,db],...] or {path, format:"fr_text"},
//                               chain: {bands}, parametric_eq: {path},
//                               difference: {a: {...target spec...}, b: {...target spec...}}),
//               "despike": {"window": 7, "threshold_db": 3},        // points source only
//               "smooth":   {"octaves": 1},                       // box smoothing in log f
//               "tilt":     {"db_per_octave": -0.5, "pivot": 1000},
//               "override": {"range": [1700, 2600], "method": "..."} | [ ... ],
//               "align":    "mean" | "none" | {"at": 1000} }         // default "mean"
//
// Transforms apply in fixed order: smooth, tilt, override, align. Alignment is
// last and defaults to "mean" because a fit must ignore overall offset — preamp
// owns level, and a fitter that chases level misreports every candidate.
//
// Override methods:
//   interpolate_edges — straight line in (log f, dB) joining the curve's values
//                       at the two range edges: "the curve without the peak".
//   smooth            — the span replaced by its box-smoothed self (octaves,
//                       default 1), neighbors included in the window.
//   fit_trend         — least-squares line in (log2 f, dB) fitted over flanking
//                       context (flank_octaves each side, default 1, span itself
//                       excluded), evaluated across the span.
//
// The `difference` source composes two target specs: a MINUS b, each operand
// resolved in full (its own source and its own smooth/tilt/override/align),
// with this spec's own transform pipeline applied on top of the difference.
// A nested operand's `align` defaults to "none", not "mean" — mean-aligning
// both operands before subtracting would erase the very offset a difference is
// usually asked for. An explicit `align` inside an operand is still honoured.

import { readFile } from "node:fs/promises";
import { parseEqText } from "../../hqptuner/static/lib/eqimport.js";
import { bandToStage } from "./chain.js";
import { curveOf, linfit, round, valueAt } from "./curve.js";
import { despikePoints, notPositive, pointsDb, pointsList, rejectDetail } from "./target-points.js";

/** @typedef {import("./curve.js").CurveLike} CurveLike */
/** @typedef {import("./curve.js").Curve} Curve */
/** @typedef {import("./chain.js").Band} Band */
/** @typedef {import("./target-points.js").Point} Point */

/**
 * One override span: which range to replace, and how.
 *
 * `octaves` belongs to the `smooth` method and `flank_octaves` to `fit_trend`;
 * each is read only by its own method.
 *
 * @typedef {{ range: [number, number], method: string, octaves?: number, flank_octaves?: number }} Override
 */

/**
 * A job's `target` spec. One shape across all six sources, matching the header
 * above: each source reads the keys it names and validates them itself.
 *
 * @typedef {{
 *   from: string,
 *   db?: number,
 *   points?: Point[],
 *   path?: string,
 *   format?: string,
 *   despike?: boolean | { window?: number, threshold_db?: number },
 *   bands?: Band[],
 *   a?: TargetSpec,
 *   b?: TargetSpec,
 *   smooth?: { octaves: number },
 *   tilt?: { db_per_octave: number, pivot?: number },
 *   override?: Override | Override[],
 *   align?: "mean" | "none" | { at: number },
 * }} TargetSpec
 */

/**
 * What a source produced, before the transform pipeline runs over it.
 *
 * `db` is a plain array throughout this module: the interpolating sources build
 * one, and the two chain-backed sources convert, so the transforms below never
 * have to straddle `Float64Array` and `Array` map signatures.
 *
 * @typedef {{ db: number[], partial: boolean, detail: string }} SourceDb
 */

/**
 * A resolved target curve. Same grid as the base chain, plain arrays per
 * `SourceDb`.
 *
 * @typedef {{ freqs: number[], db: number[], fs: number, partial: boolean }} TargetCurve
 */

const ln = Math.log;

/**
 * @template T
 * @param {T | T[] | undefined} x
 * @returns {T[]}
 */
const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/**
 * @param {TargetSpec} spec
 * @param {number[]} freqs
 * @returns {Promise<SourceDb>}
 */
async function pointsSource(spec, freqs) {
  const src = await pointsList(spec);
  const sorted = [...src.points].sort((a, b) => a[0] - b[0]);
  const skipNote = src.skipped ? `, ${src.skipped} non-numeric line(s) skipped` : "";
  if (!spec.despike) return { db: pointsDb(freqs, sorted), partial: false, detail: `${src.detail}${skipNote}` };
  const { points, rejected } = despikePoints(sorted, spec.despike);
  return {
    db: pointsDb(freqs, points),
    partial: false,
    detail: `${src.detail}${skipNote}${rejectDetail(rejected, sorted.length)}`,
  };
}

/**
 * @param {TargetSpec} spec
 * @param {Curve} base
 * @param {number} fs
 * @returns {Promise<SourceDb>}
 */
async function differenceDb(spec, base, fs) {
  for (const key of /** @type {const} */ (["a", "b"])) {
    if (!spec[key] || typeof spec[key] !== "object")
      throw new Error(`target: difference needs "a" and "b" target specs, missing "${key}"`);
  }
  // Non-null past the loop above, which throws for either operand missing.
  const a = /** @type {NonNullable<Awaited<ReturnType<typeof resolveTarget>>>} */ (
    await resolveTarget(spec.a, base, fs, { nested: true })
  );
  const b = /** @type {NonNullable<Awaited<ReturnType<typeof resolveTarget>>>} */ (
    await resolveTarget(spec.b, base, fs, { nested: true })
  );
  return {
    db: a.curve.db.map((v, i) => v - b.curve.db[i]),
    partial: a.curve.partial || b.curve.partial,
    detail: `difference of (${a.meta.detail}) minus (${b.meta.detail})`,
  };
}

/**
 * @param {TargetSpec} spec
 * @param {number} fs
 * @returns {Promise<SourceDb>}
 */
async function parametricEqDb(spec, fs) {
  if (!spec.path) throw new Error("target: parametric_eq source needs a path");
  const { stages, skipped } = parseEqText(await readFile(spec.path, "utf8"));
  if (stages.length === 0) throw new Error(`target: no filters parsed from ${spec.path}`);
  const curve = curveOf(stages, fs);
  const skip = skipped.length ? `, ${skipped.length} line(s) skipped` : "";
  // Array.from, not the Float64Array itself: every transform below is written
  // against plain arrays (see SourceDb).
  return {
    db: Array.from(curve.db),
    partial: curve.partial,
    detail: `${spec.path} (${stages.length} filters${skip})`,
  };
}

/**
 * @param {TargetSpec} spec
 * @param {number} fs
 * @returns {SourceDb}
 */
function chainDb(spec, fs) {
  if (!Array.isArray(spec.bands)) throw new Error("target: chain source needs bands: [...]");
  const curve = curveOf(spec.bands.map(bandToStage), fs);
  return { db: Array.from(curve.db), partial: curve.partial, detail: `chain of ${spec.bands.length} bands` };
}

/**
 * @param {TargetSpec} spec
 * @param {Curve} base
 * @param {number} fs
 * @returns {Promise<SourceDb>}
 */
async function sourceDb(spec, base, fs) {
  switch (spec.from) {
    case "current":
      return { db: [...base.db], partial: base.partial, detail: "current chain response" };
    case "flat":
      return { db: base.freqs.map(() => spec.db ?? 0), partial: false, detail: `flat ${spec.db ?? 0} dB` };
    case "points":
      return pointsSource(spec, base.freqs);
    case "chain":
      return chainDb(spec, fs);
    case "parametric_eq":
      return parametricEqDb(spec, fs);
    case "difference":
      return differenceDb(spec, base, fs);
    default:
      throw new Error(
        `target: unknown source "${spec.from}" (current, flat, points, chain, parametric_eq, difference)`,
      );
  }
}

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {number} octaves
 * @returns {number[]}
 */
function boxSmooth(freqs, db, octaves) {
  if (notPositive(octaves)) throw new Error(`target: smooth octaves must be positive, got ${octaves}`);
  const perOctave = Math.LN2 / ln(freqs[1] / freqs[0]);
  const half = Math.max(1, Math.round((octaves / 2) * perOctave));
  return db.map((_, i) => {
    const [a, b] = [Math.max(0, i - half), Math.min(db.length - 1, i + half)];
    let sum = 0;
    for (let j = a; j <= b; j += 1) sum += db[j];
    return sum / (b - a + 1);
  });
}

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {{ db_per_octave: number, pivot?: number }} spec
 * @returns {number[]}
 */
function tiltDb(freqs, db, spec) {
  if (typeof spec.db_per_octave !== "number") throw new Error("target: tilt needs db_per_octave");
  const pivot = spec.pivot ?? 1000;
  return db.map((v, i) => v + (spec.db_per_octave * ln(freqs[i] / pivot)) / Math.LN2);
}

const inSpan = (/** @type {number} */ f, /** @type {number} */ a, /** @type {number} */ b) => f >= a && f <= b;

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {Override} ov
 * @returns {number[]}
 */
function interpolateEdges(freqs, db, ov) {
  const [a, b] = ov.range;
  const [ya, yb] = [valueAt({ freqs, db }, a), valueAt({ freqs, db }, b)];
  return db.map((v, i) => (inSpan(freqs[i], a, b) ? ya + ((yb - ya) * ln(freqs[i] / a)) / ln(b / a) : v));
}

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {Override} ov
 * @returns {number[]}
 */
function smoothSpan(freqs, db, ov) {
  const smoothed = boxSmooth(freqs, db, ov.octaves ?? 1);
  const [a, b] = ov.range;
  return db.map((v, i) => (inSpan(freqs[i], a, b) ? smoothed[i] : v));
}

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {Override} ov
 * @returns {number[]}
 */
function fitTrend(freqs, db, ov) {
  const [a, b] = ov.range;
  const flank = ov.flank_octaves ?? 1;
  const [lo, hi] = [a / 2 ** flank, b * 2 ** flank];
  /** @type {Point[]} */
  const pts = [];
  freqs.forEach((f, i) => {
    if ((f >= lo && f < a) || (f > b && f <= hi)) pts.push([Math.log2(f), db[i]]);
  });
  if (pts.length < 2)
    throw new Error(
      "target: fit_trend has no flanking context inside the grid — widen flank_octaves or use interpolate_edges",
    );
  const { slope, icept } = linfit(pts);
  return db.map((v, i) => (inSpan(freqs[i], a, b) ? icept + slope * Math.log2(freqs[i]) : v));
}

/** @type {Record<string, (freqs: number[], db: number[], ov: Override) => number[]>} */
const OVERRIDES = { interpolate_edges: interpolateEdges, smooth: smoothSpan, fit_trend: fitTrend };

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @param {Override} ov
 * @returns {number[]}
 */
function overrideSpan(freqs, db, ov) {
  const [a, b] = ov.range || [];
  if (!(a > 0 && b > a)) throw new Error(`target: override needs range [lo, hi], got ${JSON.stringify(ov.range)}`);
  const method = OVERRIDES[ov.method];
  if (!method) throw new Error(`target: unknown override method "${ov.method}" (${Object.keys(OVERRIDES).join(", ")})`);
  return method(freqs, db, ov);
}

const meanOf = (/** @type {number[]} */ xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

/**
 * @param {number[]} freqs
 * @param {number[]} targetDb
 * @param {Curve} base
 * @param {TargetSpec["align"]} align
 * @returns {number}
 */
function alignShift(freqs, targetDb, base, align) {
  if (align === "none") return 0;
  if (align === "mean" || align === undefined) return meanOf(Array.from(base.db)) - meanOf(targetDb);
  if (align && typeof align.at === "number")
    return valueAt(base, align.at) - valueAt({ freqs, db: targetDb }, align.at);
  throw new Error(`target: align must be "mean", "none" or {"at": hz}, got ${JSON.stringify(align)}`);
}

/**
 * @param {number[]} freqs
 * @param {number[]} db
 * @returns {(number | null)[][]}
 */
function preview(freqs, db) {
  /** @type {(number | null)[][]} */
  const out = [];
  for (let i = 0; i < db.length; i += 128) out.push([round(freqs[i], 1), round(db[i], 2)]);
  out.push([round(freqs[freqs.length - 1], 1), round(db[db.length - 1], 2)]);
  return out;
}

/**
 * Resolve a job's `target` spec against the base chain's curve. Returns
 * { curve, meta } or null when no target is declared. The target is derived
 * from the BASE chain once, so before/after (and every search candidate) are
 * scored against the same reference.
 *
 * `opts.nested` marks an operand of a `difference` composer: its alignment
 * defaults to "none" instead of "mean", so the subtraction sees the operands'
 * own levels.
 *
 * @param {TargetSpec | null | undefined} spec
 * @param {Curve} base
 * @param {number} fs
 * @param {{ nested?: boolean }} [opts]
 * @returns {Promise<{
 *   curve: TargetCurve,
 *   meta: {
 *     from: string,
 *     detail: string,
 *     transforms: string[],
 *     align: TargetSpec["align"],
 *     shift_db: number | null,
 *     summary: string,
 *     preview: (number | null)[][],
 *   },
 * } | null>}
 */
export async function resolveTarget(spec, base, fs, opts = {}) {
  if (!spec) return null;
  const src = await sourceDb(spec, base, fs);
  let db = src.db;
  /** @type {string[]} */
  const applied = [];
  if (spec.smooth) {
    db = boxSmooth(base.freqs, db, spec.smooth.octaves);
    applied.push(`smooth ${spec.smooth.octaves} oct`);
  }
  if (spec.tilt) {
    db = tiltDb(base.freqs, db, spec.tilt);
    applied.push(`tilt ${spec.tilt.db_per_octave} dB/oct`);
  }
  for (const ov of asList(spec.override)) {
    db = overrideSpan(base.freqs, db, ov);
    applied.push(`override ${ov.range[0]}-${ov.range[1]} ${ov.method}`);
  }
  const align = spec.align === undefined ? (opts.nested ? "none" : "mean") : spec.align;
  const shift = alignShift(base.freqs, db, base, align);
  if (shift !== 0) db = db.map((v) => v + shift);
  const summary = `from ${spec.from}${applied.length ? `, ${applied.join(", ")}` : ""}, align ${JSON.stringify(align)} (shift ${round(shift, 2)} dB)`;
  return {
    curve: { freqs: base.freqs, db, fs, partial: src.partial },
    meta: {
      from: spec.from,
      detail: src.detail,
      transforms: applied,
      align,
      shift_db: round(shift, 3),
      summary,
      preview: preview(base.freqs, db),
    },
  };
}

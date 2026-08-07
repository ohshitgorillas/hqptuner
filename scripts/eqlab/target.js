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
//                       default 1), neighbours included in the window.
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
import { curveOf, linfit, round, valueAt } from "./metrics.js";

const ln = Math.log;
const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function pointsDb(freqs, points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("target: points needs two or more [hz, db] pairs");
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  return freqs.map((f) => {
    if (f <= pts[0][0]) return pts[0][1];
    if (f >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let i = 0;
    while (pts[i + 1][0] < f) i += 1;
    const [[f0, y0], [f1, y1]] = [pts[i], pts[i + 1]];
    return y0 + ((y1 - y0) * ln(f / f0)) / ln(f1 / f0);
  });
}

// --- points sources ---------------------------------------------------------

const NUMBER_RE = /^[-+]?(\d+(?:\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Plain measured-response text: one point per line, whitespace-separated,
 * first two numeric columns taken as (Hz, dB). Any further columns (phase) are
 * ignored, and any line whose first two tokens are not both numeric — blank,
 * comment, header — is skipped and counted, because provenance varies.
 */
function parseFrText(text, path) {
  const points = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens.length < 2 || !NUMBER_RE.test(tokens[0]) || !NUMBER_RE.test(tokens[1])) skipped += 1;
    else points.push([Number(tokens[0]), Number(tokens[1])]);
  }
  if (points.length < 2) throw new Error(`target: fewer than two [hz, db] points parsed from ${path}`);
  return { points, skipped };
}

const POINT_FORMATS = { fr_text: parseFrText };

async function readPointsFile(spec) {
  const parse = POINT_FORMATS[spec.format];
  if (!parse) {
    throw new Error(
      `target: points file needs "format": one of ${Object.keys(POINT_FORMATS).join(", ")}, got ${JSON.stringify(spec.format)}`,
    );
  }
  return parse(await readFile(spec.path, "utf8"), spec.path);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Consistency constant: MAD * 1.4826 estimates the standard deviation of
// normally distributed data.
const MAD_SCALE = 1.4826;

// NaN fails every comparison, so `x <= 0` lets a NaN through where the older
// `!(x > 0)` spelling caught it. This keeps that guard in one place.
const notPositive = (x) => Number.isNaN(x) || x <= 0;

function despikeOptions(spec) {
  const opts = spec === true ? {} : spec;
  if (!opts || typeof opts !== "object")
    throw new Error(`target: despike must be an object, got ${JSON.stringify(spec)}`);
  const window = opts.window ?? 7;
  const threshold = opts.threshold_db ?? 3;
  if (!(Number.isInteger(window) && window >= 3 && window % 2 === 1))
    throw new Error(`target: despike window must be an odd integer >= 3, got ${JSON.stringify(opts.window)}`);
  if (notPositive(threshold))
    throw new Error(`target: despike threshold_db must be positive, got ${JSON.stringify(opts.threshold_db)}`);
  return { half: (window - 1) / 2, threshold };
}

/**
 * Median/MAD outlier rejection over a frequency-sorted point list. A point is
 * dropped only when its deviation from the window median exceeds BOTH
 * threshold_db and 3 robust sigma: the dB threshold is an absolute floor, and
 * the MAD term keeps a genuinely steep — but real — stretch of curve from
 * being shaved. Rejected points are dropped, not replaced; interpolation
 * closes the gap.
 */
function despikePoints(points, spec) {
  const { half, threshold } = despikeOptions(spec);
  const kept = [];
  const rejected = [];
  points.forEach(([f, v], i) => {
    const window = points.slice(Math.max(0, i - half), Math.min(points.length, i + half + 1)).map((p) => p[1]);
    const med = median(window);
    const dev = Math.abs(v - med);
    if (dev > threshold && dev > 3 * MAD_SCALE * median(window.map((x) => Math.abs(x - med)))) rejected.push(f);
    else kept.push([f, v]);
  });
  if (kept.length < 2) throw new Error(`target: despike rejected all but ${kept.length} of ${points.length} points`);
  return { points: kept, rejected };
}

const REJECT_PREVIEW = 8;

function rejectDetail(rejected, total) {
  if (rejected.length === 0) return ", despiked 0 points";
  const shown = rejected.slice(0, REJECT_PREVIEW).map((f) => round(f, 1));
  const more = rejected.length > REJECT_PREVIEW ? `, +${rejected.length - REJECT_PREVIEW} more` : "";
  return `, despiked ${rejected.length} of ${total} points (${shown.join(", ")}${more} Hz)`;
}

async function pointsList(spec) {
  if (spec.path !== undefined) {
    if (spec.points !== undefined) throw new Error('target: points source takes "points" or "path", never both');
    const { points, skipped } = await readPointsFile(spec);
    return { points, detail: `${points.length} points from ${spec.path}`, skipped };
  }
  if (!Array.isArray(spec.points) || spec.points.length < 2)
    throw new Error("target: points needs two or more [hz, db] pairs");
  return { points: spec.points, detail: `${spec.points.length} points`, skipped: 0 };
}

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

async function differenceDb(spec, base, fs) {
  for (const key of ["a", "b"]) {
    if (!spec[key] || typeof spec[key] !== "object")
      throw new Error(`target: difference needs "a" and "b" target specs, missing "${key}"`);
  }
  const a = await resolveTarget(spec.a, base, fs, { nested: true });
  const b = await resolveTarget(spec.b, base, fs, { nested: true });
  return {
    db: a.curve.db.map((v, i) => v - b.curve.db[i]),
    partial: a.curve.partial || b.curve.partial,
    detail: `difference of (${a.meta.detail}) minus (${b.meta.detail})`,
  };
}

async function parametricEqDb(spec, fs) {
  if (!spec.path) throw new Error("target: parametric_eq source needs a path");
  const { stages, skipped } = parseEqText(await readFile(spec.path, "utf8"));
  if (stages.length === 0) throw new Error(`target: no filters parsed from ${spec.path}`);
  const curve = curveOf(stages, fs);
  const skip = skipped.length ? `, ${skipped.length} line(s) skipped` : "";
  return { db: curve.db, partial: curve.partial, detail: `${spec.path} (${stages.length} filters${skip})` };
}

function chainDb(spec, fs) {
  if (!Array.isArray(spec.bands)) throw new Error("target: chain source needs bands: [...]");
  const curve = curveOf(spec.bands.map(bandToStage), fs);
  return { db: curve.db, partial: curve.partial, detail: `chain of ${spec.bands.length} bands` };
}

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

function tiltDb(freqs, db, spec) {
  if (typeof spec.db_per_octave !== "number") throw new Error("target: tilt needs db_per_octave");
  const pivot = spec.pivot ?? 1000;
  return db.map((v, i) => v + (spec.db_per_octave * ln(freqs[i] / pivot)) / Math.LN2);
}

const inSpan = (f, a, b) => f >= a && f <= b;

function interpolateEdges(freqs, db, ov) {
  const [a, b] = ov.range;
  const [ya, yb] = [valueAt({ freqs, db }, a), valueAt({ freqs, db }, b)];
  return db.map((v, i) => (inSpan(freqs[i], a, b) ? ya + ((yb - ya) * ln(freqs[i] / a)) / ln(b / a) : v));
}

function smoothSpan(freqs, db, ov) {
  const smoothed = boxSmooth(freqs, db, ov.octaves ?? 1);
  const [a, b] = ov.range;
  return db.map((v, i) => (inSpan(freqs[i], a, b) ? smoothed[i] : v));
}

function fitTrend(freqs, db, ov) {
  const [a, b] = ov.range;
  const flank = ov.flank_octaves ?? 1;
  const [lo, hi] = [a / 2 ** flank, b * 2 ** flank];
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

const OVERRIDES = { interpolate_edges: interpolateEdges, smooth: smoothSpan, fit_trend: fitTrend };

function overrideSpan(freqs, db, ov) {
  const [a, b] = ov.range || [];
  if (!(a > 0 && b > a)) throw new Error(`target: override needs range [lo, hi], got ${JSON.stringify(ov.range)}`);
  const method = OVERRIDES[ov.method];
  if (!method) throw new Error(`target: unknown override method "${ov.method}" (${Object.keys(OVERRIDES).join(", ")})`);
  return method(freqs, db, ov);
}

const meanOf = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

function alignShift(freqs, targetDb, base, align) {
  if (align === "none") return 0;
  if (align === "mean" || align === undefined) return meanOf(base.db) - meanOf(targetDb);
  if (align && typeof align.at === "number")
    return valueAt(base, align.at) - valueAt({ freqs, db: targetDb }, align.at);
  throw new Error(`target: align must be "mean", "none" or {"at": hz}, got ${JSON.stringify(align)}`);
}

function preview(freqs, db) {
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
 */
export async function resolveTarget(spec, base, fs, opts = {}) {
  if (!spec) return null;
  const src = await sourceDb(spec, base, fs);
  let db = src.db;
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

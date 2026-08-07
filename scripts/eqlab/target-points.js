// Measured points as a target source: reading a points file, parsing it into
// [hz, db] pairs, rejecting spikes, and interpolating the survivors onto a
// frequency grid. Measurement provenance varies, so parsing tolerates junk
// lines and reports how many it dropped, and despiking reports which points it
// rejected — a target built from someone else's sweep has to say what it threw
// away.

import { readFile } from "node:fs/promises";
import { round } from "./curve.js";

/** @typedef {import("./target.js").TargetSpec} TargetSpec */

/**
 * One [hz, db] measurement.
 *
 * @typedef {[number, number]} Point
 */

const ln = Math.log;

/**
 * Measured points resampled onto a frequency grid: dB interpolated linearly
 * against log f between neighbours, and held flat at the end points' dB
 * outside the measured span.
 *
 * @param {number[]} freqs
 * @param {Point[]} points
 * @returns {number[]}
 */
export function pointsDb(freqs, points) {
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
/**
 * @param {string} text
 * @param {string} path
 * @returns {{ points: Point[], skipped: number }}
 */
function parseFrText(text, path) {
  /** @type {Point[]} */
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

/** @type {Record<string, (text: string, path: string) => { points: Point[], skipped: number }>} */
const POINT_FORMATS = { fr_text: parseFrText };

/**
 * @param {TargetSpec} spec
 * @returns {Promise<{ points: Point[], skipped: number }>}
 */
async function readPointsFile(spec) {
  const parse = POINT_FORMATS[spec.format ?? ""];
  if (!parse) {
    throw new Error(
      `target: points file needs "format": one of ${Object.keys(POINT_FORMATS).join(", ")}, got ${JSON.stringify(spec.format)}`,
    );
  }
  const path = String(spec.path);
  return parse(await readFile(path, "utf8"), path);
}

/**
 * @param {number[]} xs
 * @returns {number}
 */
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
/** True for anything that is not a strictly positive number, NaN included. */
export const notPositive = (/** @type {number} */ x) => Number.isNaN(x) || x <= 0;

/**
 * @param {boolean | { window?: number, threshold_db?: number } | undefined} spec
 * @returns {{ half: number, threshold: number }}
 */
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
 *
 * @param {Point[]} points
 * @param {boolean | { window?: number, threshold_db?: number } | undefined} spec
 * @returns {{ points: Point[], rejected: number[] }}
 */
export function despikePoints(points, spec) {
  const { half, threshold } = despikeOptions(spec);
  /** @type {Point[]} */
  const kept = [];
  /** @type {number[]} */
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

/**
 * The despiking clause of a target's detail line: how many points were
 * rejected out of how many, and the first few of their frequencies in Hz.
 *
 * @param {number[]} rejected
 * @param {number} total
 * @returns {string}
 */
export function rejectDetail(rejected, total) {
  if (rejected.length === 0) return ", despiked 0 points";
  const shown = rejected.slice(0, REJECT_PREVIEW).map((f) => round(f, 1));
  const more = rejected.length > REJECT_PREVIEW ? `, +${rejected.length - REJECT_PREVIEW} more` : "";
  return `, despiked ${rejected.length} of ${total} points (${shown.join(", ")}${more} Hz)`;
}

/**
 * The [hz, db] pairs a target spec names, from an inline `points` list or a
 * measurement file at `path` — never both — with the detail line naming the
 * source and the count of unparsed lines.
 *
 * @param {TargetSpec} spec
 * @returns {Promise<{ points: Point[], detail: string, skipped: number }>}
 */
export async function pointsList(spec) {
  if (spec.path !== undefined) {
    if (spec.points !== undefined) throw new Error('target: points source takes "points" or "path", never both');
    const { points, skipped } = await readPointsFile(spec);
    return { points, detail: `${points.length} points from ${spec.path}`, skipped };
  }
  if (!Array.isArray(spec.points) || spec.points.length < 2)
    throw new Error("target: points needs two or more [hz, db] pairs");
  return { points: spec.points, detail: `${spec.points.length} points`, skipped: 0 };
}

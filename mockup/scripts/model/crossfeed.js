// Crossfeed lookups and derivations, free of the DOM: the name a mode shows, the Bauer preset a stored value names, the
// Structural preset a speaker angle and center character land on, the values each folded line summarizes, what the
// Bauer plot draws, which fields are live, and the top-down view's listening geometry and readouts. Stored values may
// arrive as strings (the family's values).

/**
 * The name of crossfeed mode `mode` in `modes`, or undefined for a mode the table does not hold.
 *
 * @template L
 * @param {readonly { v: string, label: L }[]} modes
 * @param {string} mode
 * @returns {L | undefined}
 */
export const modeName = (modes, mode) => modes.find((m) => m.v === mode)?.label;

/**
 * The Bauer preset whose value is `v`, or undefined.
 *
 * @template {{ v: string }} T
 * @param {readonly T[]} presets
 * @param {string} v
 * @returns {T | undefined}
 */
export const bauerPreset = (presets, v) => presets.find((p) => p.v === v);

/**
 * Whether two values match: within `tol` (strictly) when a tolerance is given, else exactly as numbers.
 *
 * @param {number | string} a
 * @param {number | string} b
 * @param {number} [tol]
 * @returns {boolean}
 */
const near = (a, b, tol) => (tol ? Math.abs(+a - +b) < tol : +a === +b);

/**
 * The first Structural preset at speaker angle `angle` and center character `lambda`, or undefined. Exact without
 * `tol`; with it, each value strictly within its own tolerance.
 *
 * @template {{ angle: number, lambda: number }} T
 * @param {readonly T[]} presets
 * @param {number | string} angle
 * @param {number | string} lambda
 * @param {{ angle: number, lambda: number }} [tol]
 * @returns {T | undefined}
 */
export const structuralPreset = (presets, angle, lambda, tol) =>
  presets.find((p) => near(p.angle, angle, tol?.angle) && near(p.lambda, lambda, tol?.lambda));

/** @typedef {{ preset: string, freq: number, level: number, comp: number }} BauerFields */
/** @typedef {{ angle: number, circ: number, lambda: number }} StructuralFields */
/** @typedef {Readonly<Record<string, readonly [number, number]>>} BauerCorners  preset value → [frequency, level] */
/** @typedef {[number, number]} Point */

/**
 * The corner a Bauer line installs, [frequency Hz, level dB]: Custom's own fields, else the preset's row in `corners`.
 *
 * @param {BauerFields} st
 * @param {BauerCorners} corners
 * @returns {readonly [number, number]}
 */
export const bauerCorner = (st, corners) => (st.preset === "custom" ? [st.freq, st.level] : corners[st.preset]);

/**
 * What the folded Bauer line summarizes: the picked preset's label (undefined on Custom), the installed corner and
 * the compensation as a whole percent.
 *
 * @template L
 * @param {BauerFields} st
 * @param {readonly { v: string, label: L }[]} presets
 * @param {BauerCorners} corners
 */
export function bauerSummary(st, presets, corners) {
  const [fc, feed] = bauerCorner(st, corners);
  return { label: bauerPreset(presets, st.preset)?.label, fc, feed, comp: Math.round(st.comp) };
}

/**
 * What the folded Structural line summarizes: the label of the preset the values land on within `tol` (undefined
 * off every preset), the speaker angle, the head circumference and the center character as a whole percent.
 *
 * @template L
 * @param {StructuralFields} st
 * @param {readonly { angle: number, lambda: number, label: L }[]} presets
 * @param {{ angle: number, lambda: number }} tol
 */
export const structuralSummary = (st, presets, tol) => ({
  label: structuralPreset(presets, st.angle, st.lambda, tol)?.label,
  angle: st.angle,
  circ: st.circ,
  lambda: Math.round(st.lambda * 100),
});

/**
 * What the Bauer response plot draws: the installed corner, the correction `k` the compensation applies to the
 * center (a fraction, 1 = fully back to neutral), whether the uncorrected center shows as a ghost, and the
 * compensation as a whole percent.
 *
 * @param {BauerFields} st
 * @param {BauerCorners} corners
 */
export function bauerPlot(st, corners) {
  const [fc, feed] = bauerCorner(st, corners);
  const k = st.comp / 100;
  return { fc, feed, k, ghost: k > 0, pct: Math.round(st.comp) };
}

/**
 * Which crossfeed fields are live. `mxWhy` is the matrix engine's gray reason ('' while it runs); a bypassed matrix
 * grays the whole block. Bypassed here, the implementations' controls go dead and their lines gray while the gate and
 * the Bauer | Structural pick stay live. Frequency and Level are live only on Custom. `conflict`: Structural under
 * the matrix's linear IIR-to-FIR conversion ('2').
 *
 * @param {{ gate: string, preset: string, impl: string }} st
 * @param {string} mxWhy
 * @param {string} iir2fir
 */
export function crossfeedGray(st, mxWhy, iir2fir) {
  const matrix = !!mxWhy,
    off = st.gate === "0",
    custom = st.preset === "custom";
  return {
    matrix,
    off,
    gate: !matrix,
    controls: !matrix && !off,
    custom: !matrix && !off && custom,
    linesGrayed: off && !matrix,
    customGrayed: !custom,
    conflict: st.impl === "structural" && iir2fir === "2",
  };
}

// The top-down view's frame: listener low and facing up, the speakers on a fixed circle (angle is the variable).
const CX = 200,
  CY = 140,
  R = 112;

/**
 * The view point at `deg` (0 straight ahead, positive to the right) and radius `rr` from the head's centre.
 *
 * @param {number} deg
 * @param {number} rr
 * @returns {Point}
 */
const at = (deg, rr) => [CX + rr * Math.sin((deg * Math.PI) / 180), CY - rr * Math.cos((deg * Math.PI) / 180)];

/**
 * A far path: from speaker `P` to the tangent point over the front of a head of radius `r`, then around it to `ear`.
 *
 * @param {Point} P
 * @param {Point} ear
 * @param {number} r
 * @param {0 | 1} sweep
 */
function farPath(P, ear, r, sweep) {
  const dx = P[0] - CX,
    dy = P[1] - CY,
    d = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx),
    al = Math.acos(r / d);
  const via = [phi + al, phi - al]
    .map((q) => /** @type {Point} */ ([CX + r * Math.cos(q), CY + r * Math.sin(q)]))
    .sort((u, v) => u[1] - v[1])[0]; // the tangent point on the front (upper) side
  return { from: P, via, to: ear, sweep };
}

/**
 * The listening geometry of the top-down view at speaker angle `angle` (°) and head circumference `circ` (cm): the
 * head's centre and the cm radius it models (`a`), the drawn head radius `r` (the 6.5–10.5 cm band mapped onto
 * 15–25), the ears, the speakers toed in at ±angle, the centre axis, the ±30° reference ticks, the angle arc and its
 * label, and the two far paths (left speaker to right ear, then right speaker to left ear).
 *
 * @param {number} angle
 * @param {number} circ
 */
export function listeningGeometry(angle, circ) {
  const a = circ / (2 * Math.PI);
  const r = 15 + (Math.max(6.5, Math.min(10.5, a)) - 6.5) * 2.5;
  /** @type {Point} */ const earL = [CX - r, CY];
  /** @type {Point} */ const earR = [CX + r, CY];
  const speakers = [-angle, angle].map((d) => ({ d, p: at(d, R) }));
  const tick = (/** @type {number} */ d) => {
    const [x1, y1] = at(d, R - 16),
      [x2, y2] = at(d, R + 16);
    return { x1, y1, x2, y2 };
  };
  return {
    cx: CX,
    cy: CY,
    a,
    r,
    earL,
    earR,
    speakers,
    axis: { x1: CX, y1: CY - r, x2: CX, y2: CY - R - 14 },
    ref: [-30, 30].map(tick),
    arc: { r: 40, from: /** @type {Point} */ ([CX, CY - 40]), to: at(angle, 40) },
    label: at(angle / 2, 54),
    far: [farPath(speakers[0].p, earR, r, 1), farPath(speakers[1].p, earL, r, 0)],
  };
}

/**
 * The view's readouts from the path parameters (lib/xdsp.js pathParams) and center character `lambda`: the ray
 * ear-to-ear delay and its low-frequency value (plus the far path's excess head-shadow group delay), both in whole
 * µs; the far-ear treble in dB; and the center shift in dB at `lambda`.
 *
 * @param {{ an: number, af: number, itd: number, gdN: number, gdF: number }} pp
 * @param {number} lambda
 */
export const geometryReadouts = (pp, lambda) => ({
  itd: Math.round(pp.itd * 1e6),
  itdLow: Math.round((pp.itd + pp.gdF - pp.gdN) * 1e6),
  far: 20 * Math.log10(pp.af),
  center: 20 * Math.log10((lambda * (pp.an + pp.af)) / 2 + (1 - lambda)),
});

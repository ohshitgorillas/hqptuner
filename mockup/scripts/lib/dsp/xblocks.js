// Crossfeed blocks the matrix carries as pipelines (v1 xfeed). Both rebuild the stereo pair (In L/R → Out L/R) and carry
// each ear's EQ (the pair's own process chain + its gain) on every row feeding that ear: EQ distributes over the sum.
//
//   structural  16 rows, Brown & Duda head model (v1 docs/crossfeed-math.md §6.1). Per output ear, 8 rows: near / far
//               source × {flat, lp1, delay, lp1 + delay}; lp1 corner = 2ω₀ (ω₀ = c/a), delay = the ray ITD; Lin gains
//               from λ (center character) and the near / far α.
//   comp        8 rows, mid / side (v1 matrix-spec "Crossfeed compensation (M/S)", wire shape table): Bauer stays the
//               post-process; the M rows carry the compensation (two treble shelves; v1 fits them to bs2b's center tilt,
//               the mock uses its seed corners with the tilt split evenly), the S rows don't.
// Rows reuse the ear's EQ stage objects, so editing that EQ in any of its rows edits them all (v1's shared prefix).
// The block's own stages carry `blk: true` (never grouped with the ear's EQ; set by Crossfeed, not edited here).

import { pathParams, bauerMS, BAUER_PRESETS, toDb, gainLin } from "./xdsp.js";

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** @param {{0:object,1:object}} ear  the pair's pipelines (In L→Out L, In R→Out R) */
export function structuralRows(ear, { angle, circ, lambda }) {
  const a = circ / 100 / (2 * Math.PI);
  const { an, af, itd, w0 } = pathParams(angle, a);
  const lp1 = () => ({ kind: "iir", type: "lp1", f: Math.round(w0 / Math.PI), blk: true });
  const dl = () => ({ kind: "delay", t: +itd.toFixed(6), blk: true });
  const L = lambda;
  // [source is near?, extra stages, gain] — crossfeed-math §6.1 table, rows 1–8.
  const ROWS = [
    [true, [], ((L + 1) * an) / 4 + (1 - L) / 2],
    [true, ["lp1"], ((L + 1) * (1 - an)) / 4],
    [true, ["delay"], ((L - 1) * af) / 4],
    [true, ["lp1", "delay"], ((L - 1) * (1 - af)) / 4],
    [false, [], ((L - 1) * an) / 4 + (1 - L) / 2],
    [false, ["lp1"], ((L - 1) * (1 - an)) / 4],
    [false, ["delay"], ((L + 1) * af) / 4],
    [false, ["lp1", "delay"], ((L + 1) * (1 - af)) / 4],
  ];
  const out = [];
  for (const o of [0, 1]) {
    const e = ear[o];
    if (!e) continue;
    for (const [near, extra, g] of ROWS) {
      out.push({
        src: near ? o : 1 - o,
        mix: o,
        unit: "Lin",
        gain: r4(g * gainLin(e)),
        gen: "structural",
        ear: o,
        stages: [...e.stages, ...extra.map((x) => (x === "lp1" ? lp1() : dl()))],
      });
    }
  }
  return out;
}

/** Bauer compensation: 8 M/S rows (v1 wire shape), comp on the M rows. */
export function compRows(ear, { preset, freq, level, comp }) {
  const [fc, feed] = preset === "custom" ? [freq, level] : BAUER_PRESETS[preset];
  const tilt = (-toDb(bauerMS(fc, feed, 20000).mid) * comp) / 100; // dB of treble the M path gets back
  const shelves = () => [
    { kind: "iir", type: "hshelf", f: Math.round(0.54 * fc), q: 0.58, g: +(tilt / 2).toFixed(2), blk: true },
    { kind: "iir", type: "hshelf", f: Math.round(1.6 * fc), q: 0.66, g: +(tilt / 2).toFixed(2), blk: true },
  ];
  // [src offset, comp?, sign] per output, wire-shape rows 1–4 (out L) and 5–8 (out R).
  const SHAPE = {
    0: [
      [0, true, 1],
      [1, true, 1],
      [0, false, 1],
      [1, false, -1],
    ],
    1: [
      [0, true, 1],
      [1, true, 1],
      [0, false, -1],
      [1, false, 1],
    ],
  };
  const out = [];
  for (const o of [0, 1]) {
    const e = ear[o];
    if (!e) continue;
    for (const [src, c, sign] of SHAPE[o]) {
      out.push({
        src,
        mix: o,
        unit: "Lin",
        gain: r4(0.5 * sign * gainLin(e)),
        gen: "comp",
        ear: o,
        stages: [...e.stages, ...(c ? shelves() : [])],
      });
    }
  }
  return out;
}

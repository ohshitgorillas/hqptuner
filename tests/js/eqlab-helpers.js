// Shared fixtures for the eqlab suites (eqlab-*.test.js). No test() and no
// assert lives here: this file builds chains, curves and the fake wire, and
// every assertion stays at its call site in the suite that owns it.
//
// Deliberately NOT named *.test.js — `make test-js` globs tests/js/*.test.js,
// and a helpers module has nothing for the runner to run.

import { curveOf } from "../../scripts/eqlab/metrics.js";
import { bandToStage } from "../../scripts/eqlab/chain.js";

export const FS = 48000;

// [ok, message] for spreading into ONE assert.ok — house idiom, see dsp.test.js.
export const near = (actual, expected, tol = 0.05) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];
export const below = (actual, ceiling) => [actual < ceiling, `expected < ${ceiling}, got ${actual}`];
export const above = (actual, floor) => [actual > floor, `expected > ${floor}, got ${actual}`];

// Arithmetic mean of the grid points whose frequency falls inside [lo, hi] —
// the reference a `mean` metric is compared against, computed off the public
// curve.freqs / curve.db rather than trusted from the panel's own shape.
export const meanOfRange = (c, lo, hi) => {
  const inside = c.db.filter((_, i) => c.freqs[i] >= lo && c.freqs[i] <= hi);
  return inside.reduce((acc, v) => acc + v, 0) / inside.length;
};

export const band = (f, g, q = 1, type = "peak") => bandToStage({ type, f, q, g });
export const curve = (bands) => curveOf(bands, FS);
export const argNum = (stage, key) => Number(stage.args[key]);

export const REAL_FETCH = globalThis.fetch;

// Fake the wire, not the client: the real GET /api/matrix body shape.
export function serveRows(rows) {
  const seen = { calls: 0, path: null, method: null };
  globalThis.fetch = async (path, opts) => {
    seen.calls += 1;
    seen.path = String(path);
    seen.method = (opts && opts.method) || "GET";
    return { ok: true, status: 200, json: async () => ({ data: { rows }, loaded_at: 0, stale: false }) };
  };
  return seen;
}

export const XFEED = "iir:type=lp1;f=1162.7";
export const TAIL = "iir:type=peak;f=1000;q=1;g=3,iir:type=peak;f=3000;q=2;g=-2";

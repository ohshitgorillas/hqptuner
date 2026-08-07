// How closely a replacement segment reproduces the segment it removed.
//
// A replace edit swaps one set of bands for another. The residual is the two
// sets' responses measured alone and subtracted, reduced to an rmse over the
// fit range and the single worst point in it.

import { curveOf, F_HI, F_LO, round } from "./curve.js";
import { rangeIndices } from "./metrics.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */

/**
 * One replacement's residual against what it removed.
 *
 * @typedef {{ rmse: number, maxdev: number, hz: number, range: [number, number] }} Fit
 */

/**
 * Fit of a replacement segment against the segment it removed: the residual is
 * the replacement bands' response minus the removed bands' contribution, each
 * measured alone. Reported, never gating — a deliberate reshape has a large
 * residual on purpose.
 *
 * @param {MatrixStage[]} removedStages
 * @param {MatrixStage[]} addedStages
 * @param {number} fs
 * @param {[number, number]} [range]
 * @returns {Fit}
 */
export function residualFit(removedStages, addedStages, fs, range) {
  const rem = curveOf(removedStages, fs);
  const add = curveOf(addedStages, fs);
  const residual = { freqs: rem.freqs, db: add.db.map((v, i) => v - rem.db[i]) };
  const { lo, hi } = rangeIndices(residual, range || [F_LO, F_HI]);
  let [best, sq] = [lo, 0];
  for (let i = lo; i <= hi; i += 1) {
    sq += residual.db[i] * residual.db[i];
    if (Math.abs(residual.db[i]) > Math.abs(residual.db[best])) best = i;
  }
  return {
    rmse: round(Math.sqrt(sq / (hi - lo + 1))),
    maxdev: round(Math.abs(residual.db[best])),
    hz: round(residual.freqs[best], 2),
    range: range || [F_LO, F_HI],
  };
}

/**
 * Per replace edit, its residual fit — [] when the change set replaced nothing.
 *
 * @param {import("./chain.js").Edit[] | null | undefined} edits
 * @param {number} fs
 * @returns {ReturnType<typeof residualFit>[]}
 */
export function fitOfEdits(edits, fs) {
  return (edits || [])
    .filter((e) => e.kind === "replace")
    .map((e) =>
      residualFit(
        e.removed.map((r) => ({ kind: "iir", args: r.before })),
        e.added.map((a) => ({ kind: "iir", args: a.after })),
        fs,
        e.fit_range,
      ),
    );
}

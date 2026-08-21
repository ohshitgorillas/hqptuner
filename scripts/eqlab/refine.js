// Deterministic continuous optimizers for the refinement pass — coordinate
// descent to walk off the grid, Nelder-Mead to polish. Both work on the unit
// box [0,1]^n; the caller (search.js) maps real parameters (log f, linear g,
// log Q) onto it and back, so nothing here knows about EQ bands.
//
// No randomness anywhere: coordinate descent is a fixed halving pattern
// search, and Nelder-Mead builds its initial simplex from fixed per-coordinate
// offsets — the same seed always walks the same path.

/**
 * The function being minimized: a point in the unit box -> its cost.
 *
 * @typedef {(x: number[]) => number} Objective
 */

/**
 * One optimizer's answer: where it stopped, what it cost there, how many
 * evaluations it spent, and whether it stopped because it converged rather than
 * because it ran out of budget.
 *
 * @typedef {{ x: number[], fx: number, evals: number, converged: boolean }} RefineResult
 */

/**
 * One simplex vertex.
 *
 * @typedef {{ x: number[], fx: number }} Vertex
 */

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

// A coordinate move below this fraction of the box is under any parameter
// resolution worth reporting; reaching it is the convergence signal.
const STEP_FLOOR = 1e-3;

// Initial steps: coordinate descent starts at 1/8 of the box, the Nelder-Mead
// simplex spans 1/16 per coordinate around the (already descended) seed.
const CD_STEP = 0.125;
const NM_DELTA = 0.0625;

/**
 * One ±step trial per coordinate; first improvement restarts the sweep.
 *
 * @param {Objective} f
 * @param {{ x: number[], fx: number, evals: number }} state
 * @param {number} step
 * @param {number} maxEvals
 * @returns {boolean}
 */
function sweepOnce(f, state, step, maxEvals) {
  for (let i = 0; i < state.x.length; i += 1) {
    for (const dir of [1, -1]) {
      if (state.evals >= maxEvals) return false;
      const xi = clamp01(state.x[i] + dir * step);
      if (xi === state.x[i]) continue;
      const trial = state.x.slice();
      trial[i] = xi;
      const ft = f(trial);
      state.evals += 1;
      if (ft < state.fx) {
        state.x = trial;
        state.fx = ft;
        return true;
      }
    }
  }
  return false;
}

/**
 * Pattern search: try ±step per coordinate, halve the step when a full sweep buys nothing.
 *
 * @param {Objective} f
 * @param {number[]} x0
 * @param {{ maxEvals?: number }} [opts]
 * @returns {RefineResult}
 */
export function coordinateDescent(f, x0, { maxEvals = 300 } = {}) {
  const x = x0.map(clamp01);
  const state = { x, fx: f(x), evals: 1 };
  let step = CD_STEP;
  while (state.evals < maxEvals && step >= STEP_FLOOR) {
    if (!sweepOnce(f, state, step, maxEvals)) step /= 2;
  }
  return { ...state, converged: step < STEP_FLOOR };
}

/**
 * @param {Objective} f
 * @param {number[]} x0
 * @returns {Vertex[]}
 */
function initialSimplex(f, x0) {
  const seed = x0.map(clamp01);
  const verts = [seed];
  for (let i = 0; i < seed.length; i += 1) {
    const p = seed.slice();
    p[i] = p[i] + NM_DELTA <= 1 ? p[i] + NM_DELTA : p[i] - NM_DELTA;
    verts.push(p);
  }
  return verts.map((x) => ({ x, fx: f(x) }));
}

/**
 * Centroid of every vertex except the worst (the last after sorting).
 *
 * @param {Vertex[]} simplex
 * @returns {number[]}
 */
function centroidOf(simplex) {
  const n = simplex.length - 1;
  const c = new Array(simplex[0].x.length).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < c.length; j += 1) c[j] += simplex[i].x[j] / n;
  }
  return c;
}

/**
 * One Nelder-Mead iteration with the standard coefficients (reflect 1,
 * expand 2, contract ±0.5, shrink 0.5), every point clamped to the box.
 *
 * @param {Objective} f
 * @param {Vertex[]} simplex
 * @param {{ evals: number }} state
 * @returns {void}
 */
function nmStep(f, simplex, state) {
  const last = simplex.length - 1;
  const worst = simplex[last];
  const c = centroidOf(simplex);
  const evalAt = (/** @type {number} */ t) => {
    const x = c.map((cj, j) => clamp01(cj + t * (cj - worst.x[j])));
    state.evals += 1;
    return { x, fx: f(x) };
  };
  const refl = evalAt(1);
  if (refl.fx < simplex[0].fx) {
    const exp = evalAt(2);
    simplex[last] = exp.fx < refl.fx ? exp : refl;
    return;
  }
  if (refl.fx < simplex[last - 1].fx) {
    simplex[last] = refl;
    return;
  }
  const con = evalAt(refl.fx < worst.fx ? 0.5 : -0.5);
  if (con.fx < Math.min(refl.fx, worst.fx)) {
    simplex[last] = con;
    return;
  }
  for (let i = 1; i < simplex.length; i += 1) {
    const x = simplex[i].x.map((v, j) => clamp01(simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])));
    simplex[i] = { x, fx: f(x) };
    state.evals += 1;
  }
}

/**
 * Nelder-Mead in the unit box; stops when the simplex value spread drops under tol.
 *
 * @param {Objective} f
 * @param {number[]} x0
 * @param {{ maxEvals?: number, tol?: number }} [opts]
 * @returns {RefineResult}
 */
export function nelderMead(f, x0, { maxEvals = 300, tol = 1e-5 } = {}) {
  const simplex = initialSimplex(f, x0);
  const state = { evals: simplex.length };
  const spread = () => Math.abs(simplex[simplex.length - 1].fx - simplex[0].fx);
  simplex.sort((a, b) => a.fx - b.fx);
  while (state.evals < maxEvals && spread() > tol) {
    nmStep(f, simplex, state);
    simplex.sort((a, b) => a.fx - b.fx);
  }
  return { x: simplex[0].x, fx: simplex[0].fx, evals: state.evals, converged: spread() <= tol };
}

/**
 * The refinement pass: coordinate descent from the seed, Nelder-Mead polish
 * from where it lands, one eval budget across both. Returns the better of the
 * two endpoints — the polish is never allowed to lose ground.
 *
 * @param {Objective} f
 * @param {number[]} x0
 * @param {{ maxEvals?: number, tol?: number }} [opts]
 * @returns {RefineResult}
 */
export function refinePoint(f, x0, { maxEvals = 600, tol = 1e-5 } = {}) {
  const cd = coordinateDescent(f, x0, { maxEvals: Math.floor(maxEvals / 2) });
  const nm = nelderMead(f, cd.x, { maxEvals: Math.max(maxEvals - cd.evals, simplexMin(x0)), tol });
  const best = nm.fx <= cd.fx ? nm : cd;
  return { x: best.x, fx: best.fx, evals: cd.evals + nm.evals, converged: cd.converged && nm.converged };
}

// Nelder-Mead needs at least its initial simplex worth of evals.
const simplexMin = (/** @type {number[]} */ x0) => x0.length + 1;

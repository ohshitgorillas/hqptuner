// --- Sampled signal to plot columns ------------------------------------------
// Reduces a sampled signal to the points a polyline needs, one rule per
// regime (docs/plans/filter-primer-math.md section 5.4). Dense, more samples
// than columns: the M4 reduction, first, min, max and last per column, which
// draws the same picture as every sample would. Sparse, fewer samples than
// columns: a monotone cubic through the samples evaluated once per column, so
// the curve is smooth, never overshoots a sample and stays flat where the
// samples are flat, which is what keeps a causal response from being drawn
// before its first sample. Pure functions.

/**
 * Tangent per sample for the Fritsch-Carlson monotone cubic on a unit grid.
 * @param {Float64Array} y
 * @returns {Float64Array}
 */
function tangents(y) {
  const n = y.length;
  const m = new Float64Array(n);
  if (n < 2) return m;
  const d = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k += 1) d[k] = y[k + 1] - y[k];
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k += 1) {
    if (d[k - 1] * d[k] <= 0) continue;
    const a = (d[k - 1] + d[k]) / 2;
    const alpha = a / d[k - 1];
    const beta = a / d[k];
    const s = alpha * alpha + beta * beta;
    m[k] = s > 9 ? (a * 3) / Math.sqrt(s) : a;
  }
  return m;
}

/**
 * The monotone cubic through `y` at fractional index `t`; zero outside the
 * samples.
 * @param {Float64Array} y
 * @param {Float64Array} m
 * @param {number} t
 * @returns {number}
 */
function hermite(y, m, t) {
  if (t <= 0 || t >= y.length - 1) return t === 0 || t === y.length - 1 ? y[t] : 0;
  const k = Math.floor(t);
  const u = t - k;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y[k] + (u3 - 2 * u2 + u) * m[k] + (-2 * u3 + 3 * u2) * y[k + 1] + (u3 - u2) * m[k + 1];
}

/**
 * The points a polyline draws for `y` over the index window `[from, to]`
 * across `columns` columns: `[index, value]` pairs in index order. Indices
 * outside the samples read as zero.
 * @param {Float64Array} y
 * @param {number} from
 * @param {number} to
 * @param {number} columns
 * @returns {[number, number][]}
 */
export function traceColumns(y, from, to, columns) {
  const per = (to - from) / columns;
  if (per < 1) {
    const m = tangents(y);
    return Array.from({ length: columns + 1 }, (_, c) => {
      const t = from + c * per;
      return [t, hermite(y, m, t)];
    });
  }
  /** @type {[number, number][]} */
  const out = [];
  for (let c = 0; c < columns; c += 1) {
    const lo = Math.max(0, Math.ceil(from + c * per));
    const hi = Math.min(y.length - 1, Math.floor(from + (c + 1) * per - 1e-9));
    if (lo > hi) continue;
    let min = lo;
    let max = lo;
    for (let i = lo + 1; i <= hi; i += 1) {
      if (y[i] < y[min]) min = i;
      if (y[i] > y[max]) max = i;
    }
    const keep = [...new Set([lo, Math.min(min, max), Math.max(min, max), hi])];
    for (const i of keep) out.push([i, y[i]]);
  }
  return out;
}

/**
 * The indices a spectrum's polyline keeps over the index window `[from, to)`
 * across `columns` columns: first, the column's maximum, and last, in index
 * order (section 5.4 rules 2 and 3). A spectrum is a level, so the picture the
 * reader needs is the peak of what fell in the column, not its excursion;
 * where a column holds one sample or fewer every index is kept and the
 * reduction is a no-op. Indices, not values, so every curve sharing a grid
 * stays on one x mapping.
 * @param {ArrayLike<number>} values
 * @param {number} from
 * @param {number} to
 * @param {number} columns
 * @returns {number[]}
 */
export function peakColumns(values, from, to, columns) {
  const per = (to - from) / columns;
  if (per <= 1) return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  /** @type {number[]} */
  const out = [];
  for (let c = 0; c < columns; c += 1) {
    const lo = Math.max(from, Math.ceil(from + c * per));
    const hi = Math.min(to - 1, Math.floor(from + (c + 1) * per - 1e-9));
    if (lo > hi) continue;
    let max = lo;
    for (let i = lo + 1; i <= hi; i += 1) if (values[i] > values[max]) max = i;
    for (const i of new Set([lo, max, hi])) out.push(i);
  }
  return out;
}

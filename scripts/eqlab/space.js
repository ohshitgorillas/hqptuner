// Search-space expansion: declarative change specs -> the concrete candidate
// list a search sweeps. Pure data transformation, no measurement.

import { round } from "./metrics.js";

// Runaway guards, nothing more. They exist so a typo'd step of 0.0001 fails in
// a second instead of eating the machine — they are NOT a budget, and hitting
// one is not a decision to escalate. A space too big for one pass is split and
// run in batches. Measured rate: 2880 candidates in 4.3 s with two varied bands
// on the 4096-point grid (~670/s), so plan batches by the clock, not by asking.
export const MAX_COMBOS = 2_000_000;
export const MAX_STEPS = 100_000;

const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function rangeValues(from, to, step) {
  if (!(step > 0)) throw new Error(`search: step must be positive, got ${step}`);
  if (to < from) throw new Error(`search: range [${from}, ${to}] runs backwards`);
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  if (n > MAX_STEPS)
    throw new Error(`search: range [${from}, ${to}] step ${step} yields ${n} values (max ${MAX_STEPS})`);
  return Array.from({ length: n }, (_, i) => round(from + i * step, 6));
}

const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number");

/** One parameter spec -> its list of values. [a,b,step] is a range; any other array is a literal list. */
export function expandValue(spec) {
  if (isTriple(spec)) {
    const values = rangeValues(spec[0], spec[1], spec[2]);
    // A triple whose range collapses to one value is never what anyone meant:
    // a fixed value is a scalar, and [0, 0.5, 1.0] is almost always a literal
    // three-value list that this grammar reads as a range. Fail loud.
    if (values.length === 1)
      throw new Error(
        `search: range [${spec[0]}, ${spec[1]}] step ${spec[2]} yields a single value — ` +
          `use a scalar for a fixed value, or {"values": [${spec.join(", ")}]} for a literal list`,
      );
    return values;
  }
  if (Array.isArray(spec)) return spec;
  if (spec && typeof spec === "object" && Array.isArray(spec.values)) return spec.values;
  if (spec && typeof spec === "object" && "from" in spec) return rangeValues(spec.from, spec.to, spec.step);
  return [spec];
}

/** A change spec with per-parameter value lists -> every concrete change object. */
export function expandChange(spec) {
  if (!spec) return [null];
  const keys = Object.keys(spec);
  return keys.reduce(
    (acc, key) => acc.flatMap((partial) => expandValue(spec[key]).map((v) => ({ ...partial, [key]: v }))),
    [{}],
  );
}

// Every combination across a LIST of change specs — one concrete change per
// spec per combination. This is what lets a space carry two appends (a cut
// plus a broader lift): one append forced every candidate to solve a
// two-feature problem with a single band.
function crossChanges(specs) {
  return specs.reduce((acc, spec) => acc.flatMap((set) => expandChange(spec).map((c) => [...set, c])), [[]]);
}

// `select` stays a literal inside each amend spec: a search varies band
// parameters, never which band a spec amends — the fixed-stage split in
// the measurer depends on it, and "which band" is a different question that a
// second amend spec answers directly.
function checkSelects(specs) {
  for (const spec of specs) {
    if (spec && typeof spec.select === "object")
      throw new Error(
        "search: select must be a literal frequency per amend spec — to vary which band moves, give one amend spec per band",
      );
  }
}

// A replace spec's `remove` list is literal, like `select`; only its `with`
// bands expand. An empty `with` list is one candidate: pure removal.
function expandReplace(spec) {
  return crossChanges(asList(spec.with)).map((w) => ({
    remove: spec.remove,
    with: w,
    ...(spec.fit_range ? { fit_range: spec.fit_range } : {}),
  }));
}

/** Every concrete candidate change set of a declared space. */
export function candidates(space) {
  const amendSpecs = asList(space.amend);
  checkSelects(amendSpecs);
  const amendSets = crossChanges(amendSpecs);
  const replaceSets = asList(space.replace).reduce(
    (acc, spec) => acc.flatMap((set) => expandReplace(spec).map((c) => [...set, c])),
    [[]],
  );
  const appendSets = crossChanges(asList(space.append));
  const out = [];
  for (const amend of amendSets) {
    for (const replace of replaceSets) {
      for (const append of appendSets) {
        out.push({
          ...(amend.length ? { amend } : {}),
          ...(replace.length ? { replace } : {}),
          ...(append.length ? { append } : {}),
        });
      }
    }
  }
  if (out.length > MAX_COMBOS) {
    throw new Error(
      `search: ${out.length} combinations exceeds the ${MAX_COMBOS} runaway guard — split the space and run it in batches`,
    );
  }
  return out;
}

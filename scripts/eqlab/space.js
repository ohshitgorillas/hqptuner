// Search-space expansion: declarative change specs -> the concrete candidate
// list a search sweeps. Pure data transformation, no measurement.

import { round } from "./curve.js";

// Runaway guards, nothing more. They exist so a typo'd step of 0.0001 fails in
// a second instead of eating the machine — they are NOT a budget, and hitting
// one is not a decision to escalate. A space too big for one pass is split and
// run in batches. Measured rate: 2880 candidates in 4.3 s with two varied bands
// on the 4096-point grid (~670/s), so plan batches by the clock, not by asking.
/**
 * One parameter's declared values: a `[from, to, step]` triple, a literal list,
 * an explicit `{values}` or `{from, to, step}` object, or a bare scalar.
 *
 * The members stay `unknown` because this module never interprets a value — it
 * only multiplies the lists out and hands the results to the change appliers,
 * which is where a band argument acquires meaning.
 *
 * @typedef {{ values: unknown[] }} ValuesSpec
 * @typedef {{ from: number, to: number, step: number }} RangeSpec
 * @typedef {unknown[] | ValuesSpec | RangeSpec | string | number | boolean | null | undefined} ValueSpec
 */

/**
 * One concrete change: parameter name -> the single value this candidate uses.
 *
 * @typedef {Record<string, unknown>} Change
 */

/**
 * A declared search space. Each section holds change specs whose parameters
 * carry value LISTS rather than values; `candidates` multiplies them out.
 *
 * @typedef {{
 *   remove: unknown,
 *   with?: Record<string, ValueSpec> | Record<string, ValueSpec>[],
 *   fit_range?: [number, number],
 * }} ReplaceSpaceSpec
 *
 * @typedef {{
 *   amend?: Record<string, ValueSpec> | Record<string, ValueSpec>[],
 *   replace?: ReplaceSpaceSpec | ReplaceSpaceSpec[],
 *   append?: Record<string, ValueSpec> | Record<string, ValueSpec>[],
 * }} Space
 */

export const MAX_COMBOS = 2_000_000;
export const MAX_STEPS = 100_000;

/**
 * @template T
 * @param {T | T[] | undefined} x
 * @returns {T[]}
 */
const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/**
 * @param {number} from
 * @param {number} to
 * @param {number} step
 * @returns {number[]}
 */
function rangeValues(from, to, step) {
  if (Number.isNaN(step) || step <= 0) throw new Error(`search: step must be positive, got ${step}`);
  if (to < from) throw new Error(`search: range [${from}, ${to}] runs backwards`);
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  if (n > MAX_STEPS)
    throw new Error(`search: range [${from}, ${to}] step ${step} yields ${n} values (max ${MAX_STEPS})`);
  return Array.from({ length: n }, (_, i) => round(from + i * step, 6));
}

/**
 * @param {unknown} v
 * @returns {v is [number, number, number]}
 */
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number");

/**
 * The literal list of an explicit `{values: [...]}` spec, or null for anything
 * else. Separate from `expandValue` so that each of the two object forms costs
 * that function one branch rather than three.
 *
 * @param {ValueSpec} spec
 * @returns {unknown[] | null}
 */
const valuesOf = (spec) =>
  spec && typeof spec === "object" && "values" in spec && Array.isArray(spec.values) ? spec.values : null;

/**
 * An explicit `{from, to, step}` spec, or null for anything else.
 *
 * @param {ValueSpec} spec
 * @returns {RangeSpec | null}
 */
const rangeOf = (spec) => (spec && typeof spec === "object" && "from" in spec ? /** @type {RangeSpec} */ (spec) : null);

/**
 * One parameter spec -> its list of values. [a,b,step] is a range; any other array is a literal list.
 *
 * @param {ValueSpec} spec
 * @returns {unknown[]}
 */
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
  const values = valuesOf(spec);
  if (values) return values;
  const range = rangeOf(spec);
  if (range) return rangeValues(range.from, range.to, range.step);
  return [spec];
}

/**
 * A change spec with per-parameter value lists -> every concrete change object.
 *
 * @param {Record<string, ValueSpec> | null | undefined} spec
 * @returns {(Change | null)[]}
 */
export function expandChange(spec) {
  if (!spec) return [null];
  const keys = Object.keys(spec);
  return keys.reduce(
    (acc, key) => acc.flatMap((partial) => expandValue(spec[key]).map((v) => ({ ...partial, [key]: v }))),
    /** @type {Change[]} */ ([{}]),
  );
}

// Every combination across a LIST of change specs — one concrete change per
// spec per combination. This is what lets a space carry two appends (a cut
// plus a broader lift): one append forced every candidate to solve a
// two-feature problem with a single band.
/**
 * @param {(Record<string, ValueSpec> | null | undefined)[]} specs
 * @returns {(Change | null)[][]}
 */
function crossChanges(specs) {
  return specs.reduce(
    (acc, spec) => acc.flatMap((set) => expandChange(spec).map((c) => [...set, c])),
    /** @type {(Change | null)[][]} */ ([[]]),
  );
}

// `select` stays a literal inside each amend spec: a search varies band
// parameters, never which band a spec amends — the fixed-stage split in
// the measurer depends on it, and "which band" is a different question that a
// second amend spec answers directly.
/**
 * @param {(Record<string, ValueSpec> | null | undefined)[]} specs
 * @returns {void}
 */
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
/**
 * @param {ReplaceSpaceSpec} spec
 * @returns {Change[]}
 */
function expandReplace(spec) {
  return crossChanges(asList(spec.with)).map((w) => ({
    remove: spec.remove,
    with: w,
    ...(spec.fit_range ? { fit_range: spec.fit_range } : {}),
  }));
}

// A change set names only the sections that actually carry changes.
/**
 * @param {(Change | null)[]} amend
 * @param {Change[]} replace
 * @param {(Change | null)[]} append
 * @returns {Change}
 */
function changeSet(amend, replace, append) {
  return {
    ...(amend.length ? { amend } : {}),
    ...(replace.length ? { replace } : {}),
    ...(append.length ? { append } : {}),
  };
}

/**
 * Every concrete candidate change set of a declared space.
 *
 * @param {Space} space
 * @returns {Change[]}
 */
export function candidates(space) {
  const amendSpecs = asList(space.amend);
  checkSelects(amendSpecs);
  const amendSets = crossChanges(amendSpecs);
  const replaceSets = asList(space.replace).reduce(
    (acc, spec) => acc.flatMap((set) => expandReplace(spec).map((c) => [...set, c])),
    /** @type {Change[][]} */ ([[]]),
  );
  const appendSets = crossChanges(asList(space.append));
  const out = amendSets.flatMap((amend) =>
    replaceSets.flatMap((replace) => appendSets.map((append) => changeSet(amend, replace, append))),
  );
  if (out.length > MAX_COMBOS) {
    throw new Error(
      `search: ${out.length} combinations exceeds the ${MAX_COMBOS} runaway guard — split the space and run it in batches`,
    );
  }
  return out;
}

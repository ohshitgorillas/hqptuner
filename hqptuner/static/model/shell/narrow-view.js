// What the facet bar reads off the narrowing state, free of the DOM: which facets show at a stage, which chips read
// picked or dead, whether a set of facets is narrowing, the state keys a set owns, and each facet's state as data.

/** @typedef {Record<string, unknown>} State */
/** @typedef {{ v: unknown, label: string }} Option */
/** @typedef {{ key: string, options: Option[] }} Row */
/** @typedef {{ key: string, tag: string }} Item */

/**
 * A facet: kind seg (rows), chips (options, `combine` for an AND/OR mode), toggle,
 * or checks (items); `apod` marks the Apodizing segment.
 *
 * @typedef {object} Facet
 * @property {string} kind
 * @property {string} [key]
 * @property {boolean} [apod]
 * @property {boolean} [combine]
 * @property {Row[]} [rows]
 * @property {Option[]} [options]
 * @property {Item[]} [items]
 */

/**
 * A narrowing facet's state: the apodizing mark it reads, the labels of its picks, a count of several chip picks with
 * their combine mode, a count of several ticked rules, or a toggle that is on.
 *
 * @typedef {{ apod: 'only' | 'half' } | { labels: string[] } | { picks: number, mode: string } | { rules: number } | { on: true }} Summary
 */

/**
 * The Apodizing facet's state at a stage: the mark its stage row picks, or null at All.
 *
 * @param {State} st
 * @param {string} stage
 * @returns {Summary | null}
 */
function apodSummary(st, stage) {
  const v = st[stage === "nx" ? "apodNx" : "apod1x"];
  return v === "only" || v === "half" ? { apod: v } : null;
}

/**
 * A segment facet's state: the label of each row moved off its first option, in row order.
 *
 * @param {Row[]} rows
 * @param {State} st
 * @returns {Summary | null}
 */
function segSummary(rows, st) {
  const moved = rows.filter((r) => String(st[r.key]) !== String(r.options[0].v));
  const labels = moved.map(
    (r) => /** @type {Option} */ (r.options.find((o) => String(o.v) === String(st[r.key]))).label,
  );
  return labels.length ? { labels } : null;
}

/**
 * A chips facet's state: one pick by its label, several by count and combine mode (a facet without one unions).
 *
 * @param {Facet} f
 * @param {State} st
 * @returns {Summary | null}
 */
function chipsSummary(f, st) {
  const key = String(f.key);
  const sel = /** @type {unknown[]} */ (st[key]);
  if (!sel.length) return null;
  if (sel.length === 1)
    return { labels: [/** @type {Option} */ ((f.options ?? []).find((o) => o.v === sel[0])).label] };
  return { picks: sel.length, mode: f.combine ? String(st[key + "Mode"]) : "or" };
}

/**
 * A checks facet's state: one ticked rule by its tag, several by count.
 *
 * @param {Item[]} items
 * @param {State} st
 * @returns {Summary | null}
 */
function checksSummary(items, st) {
  const on = items.filter((i) => st[i.key]);
  if (on.length === 1) return { labels: [on[0].tag] };
  return on.length ? { rules: on.length } : null;
}

/**
 * The facet's state at a list stage, or null when it isn't narrowing.
 *
 * @param {Facet} f
 * @param {State} st
 * @param {string} stage
 * @returns {Summary | null}
 */
export function summary(f, st, stage) {
  if (f.apod) return apodSummary(st, stage);
  if (f.kind === "seg") return segSummary(f.rows ?? [], st);
  if (f.kind === "chips") return chipsSummary(f, st);
  if (f.kind === "toggle") return st[String(f.key)] ? { on: true } : null;
  if (f.kind === "checks") return checksSummary(f.items ?? [], st);
  return null;
}

/**
 * Whether the facet shows at a list stage: 1x sources narrows the 1x lists only, so it hides at Nx.
 *
 * @param {Facet} f
 * @param {string} stage
 * @returns {boolean}
 */
export const facetShown = (f, stage) => !(f.rows?.[0]?.key === "lossy" && stage === "nx");

/**
 * Whether a chip reads picked: a toggle's state as is, a chips facet's when its value is among the picks.
 *
 * @param {State} st
 * @param {string} key
 * @param {unknown} v
 * @returns {boolean}
 */
export function chipPressed(st, key, v) {
  const sel = st[key];
  return typeof sel === "boolean" ? sel : /** @type {unknown[]} */ (sel).includes(v);
}

/**
 * Whether a chip is dead: unpicked, and its pick would empty both lists (its count reads 0, or 0 for 1x and Nx both).
 *
 * @param {boolean} pressed
 * @param {string | null} count
 * @returns {boolean}
 */
export const deadChip = (pressed, count) => !pressed && ["0·0", "0"].includes(String(count));

/**
 * Whether any of the keys holds a value other than its default (pick lists compare by content).
 *
 * @param {string[]} keys
 * @param {State} st
 * @param {State} d
 * @returns {boolean}
 */
export const narrowing = (keys, st, d) => keys.some((k) => JSON.stringify(st[k]) !== JSON.stringify(d[k]));

/**
 * Every state key a set of facets owns: each segment row's, each check item's, a chips or toggle facet's own, and the
 * mode key of a facet that combines.
 *
 * @param {Facet[]} facets
 * @returns {string[]}
 */
export function stateKeys(facets) {
  return facets.flatMap((f) => {
    if (f.kind === "seg") return (f.rows ?? []).map((r) => r.key);
    if (f.kind === "checks") return (f.items ?? []).map((i) => i.key);
    return f.combine ? [String(f.key), f.key + "Mode"] : [String(f.key)];
  });
}

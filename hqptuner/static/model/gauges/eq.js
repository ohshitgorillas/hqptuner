// AutoEq / REW EQ on a pipeline, free of the DOM: bands as iir stages, an EQ landed on one pipeline, and the hit search
// over the AutoEq library. The EQ step and the DSP pipelines drawer share them.

/** The iir stage types a parametric EQ is made of: the peak and the two shelves. */
export const PEQ_TYPES = new Set(["peak", "lshelf", "hshelf"]);

/**
 * One band as AutoEq / REW give it: frequency in Hz, gain in dB, Q, and the iir type (peak when left out).
 *
 * @typedef {[number, number, number, string?]} Band
 */

/**
 * One iir stage of a pipeline.
 *
 * @typedef {object} IirStage
 * @property {'iir'} kind
 * @property {string} type
 * @property {number} f
 * @property {number} g
 * @property {number} q
 */

/**
 * Any stage of a pipeline: its kind, and its type when it is an iir stage.
 *
 * @typedef {{ kind: string, type?: string }} Stage
 */

/**
 * The bands as iir stages, in band order.
 *
 * @param {readonly Band[]} bands
 * @returns {IirStage[]}
 */
export const bandsToStages = (bands) => bands.map(([f, g, q, type = "peak"]) => ({ kind: "iir", type, f, g, q }));

/**
 * A pipeline's fields once an EQ lands on it: its peak and shelf stages dropped, the EQ's band stages appended after
 * every other stage (the objects given, not copies), its gain the EQ's preamp in dB. The pipeline given is left as it
 * was.
 *
 * @template {Stage} S
 * @template {Stage} B
 * @param {{ stages: readonly S[] }} p
 * @param {readonly B[]} bands  the EQ as stages (bandsToStages)
 * @param {number} pre  preamp, dB
 * @returns {{ gain: number, unit: 'dB', stages: (S | B)[] }}
 */
export const replacePeq = (p, bands, pre) => ({
  gain: pre,
  unit: "dB",
  stages: [...p.stages.filter((st) => !(st.kind === "iir" && PEQ_TYPES.has(st.type ?? ""))), ...bands],
});

/**
 * The hits whose name holds the query, case and surrounding space ignored; a blank query keeps every hit.
 *
 * @template {{ name: string }} T
 * @param {readonly T[]} hits
 * @param {string} query
 * @returns {T[]}
 */
export const searchHits = (hits, query) => {
  const t = query.trim().toLowerCase();
  return hits.filter((x) => !t || x.name.toLowerCase().includes(t));
};

/**
 * The hits a search shows: none for a blank query, else the first `max` matches, and how many matches lie past them.
 *
 * @template {{ name: string }} T
 * @param {readonly T[]} hits
 * @param {string} query
 * @param {number} max
 * @returns {{ shown: T[], more: number }}
 */
export const shownHits = (hits, query, max) => {
  const all = query.trim() ? searchHits(hits, query) : [];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
};

/**
 * An AutoEq hit: its name, measurement source, bands and preamp in dB.
 *
 * @typedef {{ name: string, src: string, bands: readonly Band[], pre: number | null }} Hit
 */

/**
 * A picked hit's band summary: how many bands it holds and its preamp.
 *
 * @param {Hit} hit
 * @returns {{ count: number, pre: number | null }}
 */
export const hitSummary = (hit) => ({ count: hit.bands.length, pre: hit.pre });

/**
 * A picked hit as a pipeline to preview: its bands as stages, its preamp as the gain in dB.
 *
 * @param {Hit} hit
 * @returns {{ stages: IirStage[], gain: number | null, unit: 'dB' }}
 */
export const hitPipe = (hit) => ({ stages: bandsToStages(hit.bands), gain: hit.pre, unit: "dB" });

/**
 * How many peak and shelf stages a pipeline holds.
 *
 * @param {readonly Stage[]} stages
 * @returns {number}
 */
export const peqCount = (stages) => stages.filter((st) => st.kind === "iir" && PEQ_TYPES.has(st.type ?? "")).length;

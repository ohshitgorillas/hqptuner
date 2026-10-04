// AutoEq / REW EQ on a pipeline, free of the DOM: bands as iir stages, an EQ landed on one pipeline, and the hit search
// over the AutoEq library. The EQ step (components/autoeq.js), the DSP pipelines drawer (components/pipelines.js) and
// the mock profiles (data/profiles.js) share them.

/** The iir stage types a parametric EQ is made of: the peak and the two shelves. */
export const PEQ_TYPES = new Set(['peak', 'lshelf', 'hshelf']);

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
export const bandsToStages = (bands) => bands.map(([f, g, q, type = 'peak']) => ({ kind: 'iir', type, f, g, q }));

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
  unit: 'dB',
  stages: [...p.stages.filter((st) => !(st.kind === 'iir' && PEQ_TYPES.has(st.type ?? ''))), ...bands],
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

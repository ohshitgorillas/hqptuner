// Parametric EQ on a pipeline, free of the DOM: the iir stage types an EQ is made of, and how many of them a pipeline
// holds.

/** The iir stage types a parametric EQ is made of: the peak and the two shelves. */
export const PEQ_TYPES = new Set(["peak", "lshelf", "hshelf"]);

/**
 * Any stage of a pipeline: its kind, and its type when it is an iir stage.
 *
 * @typedef {{ kind: string, type?: string }} Stage
 */

/**
 * How many peak and shelf stages a pipeline holds.
 *
 * @param {readonly Stage[]} stages
 * @returns {number}
 */
export const peqCount = (stages) => stages.filter((st) => st.kind === "iir" && PEQ_TYPES.has(st.type ?? "")).length;

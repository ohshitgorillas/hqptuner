// Option lists every Settings category shares.

/**
 * One option of a control, a choice line or a catalog list: the value it writes and its label, then what may print
 * beside it: a unit, a sublabel, its manual line, the control a picked choice line holds, an accent swatch, a catalog
 * optgroup, the two-stage flag of a catalog filter.
 *
 * @typedef {object} Option
 * @property {string} v
 * @property {string} label
 * @property {string} [unit]
 * @property {string} [sub]
 * @property {string} [man]
 * @property {import('../stages/output.js').Control} [control]
 * @property {string} [hex]
 * @property {string} [group]
 * @property {boolean} [twoStage]
 */

/** @type {Option[]} */
export const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

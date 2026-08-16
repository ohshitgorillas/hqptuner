// The daemon's two chain enumerations, verbatim in their numbering, and the
// /config form that quotes them. The same two filters carry different enum IDs
// and sit at different indices on each chain (protocol.md §4), which is the
// whole reason a dormant chain cannot borrow the loaded one's list.

/**
 * One filter/shaper/junk-filter enum entry the engine reports: enum ID differs
 * from list index throughout.
 *
 * @typedef {{ index: string, value: string, name: string, description?: string }} EnumItem
 */

// Every filter the engine enumerates carries a quality rating at the head of
// its description (protocol.md:228), and the quality facet hides anything rated
// below its floor — so a filter fixture with no description is narrowed out of
// every dropdown that quotes it. The pass-through's description is the engine's
// own, `1/5 ⥮ 1:1`; the two resamplers carry a rating that clears the default
// floor, because no case here is about quality.

/** @type {EnumItem[]} */
export const PCM_FILTERS = [
  { index: "0", value: "0", name: "none", description: "1/5 ⥮ 1:1" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long", description: "4/5 ⥮ Any" },
  { index: "2", value: "25", name: "sinc-M", description: "4/5 ⥮ Any" },
];

/** @type {EnumItem[]} */
export const PCM_SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "5", name: "NS9" },
];

/** @type {EnumItem[]} */
export const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long", description: "4/5 ⥮ Any" },
  { index: "1", value: "23", name: "sinc-M", description: "4/5 ⥮ Any" },
];

/** @type {EnumItem[]} */
export const SDM_SHAPERS = [
  { index: "0", value: "0", name: "ASDM5" },
  { index: "1", value: "3", name: "ASDM7EC" },
];

/** @type {EnumItem[]} */
export const JUNK = [{ index: "0", value: "0", name: "none" }];

// One /config form field: every field carries the option list for its OWN
// chain, in the enum-ID domain the config file speaks.
/**
 * @param {string} name
 * @param {string} value
 * @param {EnumItem[]} items
 * @returns {{ name: string, value: string, options: { value: string, label: string }[] }}
 */
export const formField = (name, value, items) => ({
  name,
  value,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});

// The form's six chain fields with the values the running configuration holds.
export const FORM = {
  filter1x: "40",
  filter: "40",
  dither: "5",
  oversampling1x: "38",
  oversampling: "38",
  modulator: "3",
};

// Which enumeration each of those fields quotes its options from.
/** @type {Record<string, EnumItem[]>} */
export const LISTS = {
  filter1x: PCM_FILTERS,
  filter: PCM_FILTERS,
  dither: PCM_SHAPERS,
  oversampling1x: SDM_FILTERS,
  oversampling: SDM_FILTERS,
  modulator: SDM_SHAPERS,
};

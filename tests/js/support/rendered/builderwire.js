// The wire the Snapshot builder's suites drive their views from: the two chains' enumerations, the /config form that
// quotes them, the /api/metadata overlay, the Headphones half of the snapshot book, and the one writer that puts an
// idle engine, its form, its readings and its loaded station onto the signals the store reads. The builder, rail and
// rows component suites and the snapshot and plain-names store suites share it; each keeps the records it asserts on.

import { config, engineState, engineStatus, enums, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { formField } from "../chainenums.js";
import { seedReadings } from "../readings.js";

/** @typedef {{ index: string, value: string, name: string }} EnumItem */

/** @type {EnumItem[]} */
const PCM_FILTERS = [
  { index: "0", value: "40", name: "poly-sinc-gauss-long" },
  { index: "1", value: "41", name: "sinc-M" },
  { index: "2", value: "42", name: "IIR" },
];
/** @type {EnumItem[]} */
const PCM_SHAPERS = [
  { index: "0", value: "5", name: "NS9" },
  { index: "1", value: "6", name: "TPDF" },
];
/** @type {EnumItem[]} */
const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long" },
  { index: "1", value: "39", name: "sinc-M" },
];
/** @type {EnumItem[]} */
const SDM_SHAPERS = [
  { index: "0", value: "3", name: "ASDM7EC 512+fs" },
  { index: "1", value: "4", name: "ASDM5" },
];

/** Each chain's enumerations, as /api/enums serves the loaded one. */
export const LISTS = {
  pcm: { filters: PCM_FILTERS, shapers: PCM_SHAPERS },
  sdm: { filters: SDM_FILTERS, shapers: SDM_SHAPERS },
};

/** The /config form's PCM chain fields, each quoting the PCM lists. */
const pcmForm = () => [
  formField("filter1x", "40", PCM_FILTERS),
  formField("filter", "41", PCM_FILTERS),
  formField("dither", "6", PCM_SHAPERS),
];

/** The /config form's two chains: the PCM fields, then the dormant SDM chain's. */
export const fullForm = () => [
  ...pcmForm(),
  formField("oversampling1x", "38", SDM_FILTERS),
  formField("oversampling", "39", SDM_FILTERS),
  formField("modulator", "4", SDM_SHAPERS),
];

/**
 * One /api/metadata plain-names section holding `entries`, and no family or variant blurbs.
 *
 * @param {Record<string, unknown>} [entries]
 */
export const plainSection = (entries = {}) => ({ entries, families: {}, variants: {} });

/**
 * A fresh /api/metadata `plain_names` payload: filters, dithers and modulators empty unless `sections` names them, any
 * further section added as given.
 *
 * @param {Record<string, unknown>} [sections]
 */
export const plainNamesOf = (sections = {}) => ({
  filters: plainSection(),
  dithers: plainSection(),
  modulators: plainSection(),
  ...sections,
});

/**
 * A fresh /api/metadata payload: writing the same object to a signal does not notify.
 *
 * @param {Record<string, unknown>} [sections]  the plain-names sections that hold entries
 */
export const overlays = (sections) => ({
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  plain_names: plainNamesOf(sections),
});

/**
 * The Headphones station of a fresh book: Desk, a PCM snapshot, and Bed, one without Mode. `desk` and `bed` add the
 * wire fields a suite's record holds beyond those.
 *
 * @param {Record<string, string>} [desk]
 * @param {Record<string, string>} [bed]
 */
export const headphonesBook = (desk = {}, bed = {}) => ({
  Desk: { chain: "pcm", fields: { mode: "pcm", filter1x: "40", dither: "6", ...desk }, names: {} },
  Bed: { chain: "pcm", fields: { filter1x: "41", ...bed }, names: {} },
});

/**
 * Write one idle engine onto the wire-side signals: /api/state, the loaded chain's enumerations, the /config form and
 * the readings it serves, the stations and the loaded one. Passing `profile` also writes the matrix form, empty, and
 * the running matrix profile.
 *
 * @param {{
 *   state?: Record<string, string>,
 *   lists?: { filters: EnumItem[], shapers: EnumItem[] },
 *   form?: ReturnType<typeof pcmForm>,
 *   mode?: string,
 *   active?: string,
 *   profile?: string,
 * }} [o]
 *   state: /api/state members over an idle PCM engine's; lists: the loaded chain's enumerations, PCM's by default;
 *   form: the /config form's fields, the PCM chain's by default
 */
export async function wireEngine({
  state = {},
  lists = LISTS.pcm,
  form = pcmForm(),
  mode = "pcm",
  active = "Headphones",
  profile,
} = {}) {
  engineState.value = {
    state: "0",
    active_chain: "pcm",
    filter1x: "1",
    filterNx: "0",
    shaper: "0",
    adaptive: "1",
    ...state,
  };
  engineStatus.value = {};
  enums.value = lists;
  config.value = {
    fields: [{ name: "mode", options: [] }, ...form.map(({ name, options }) => ({ name, options }))],
  };
  if (profile !== undefined) matrixConfig.value = { fields: [] };
  await seedReadings({
    mode,
    ...Object.fromEntries(form.map(({ name, value }) => [name, value])),
    active_preset: { value: active, readonly: true },
    profiles: { value: { options: [{ value: "" }, { value: "Speakers" }, { value: "Headphones" }] }, readonly: true },
    ...(profile === undefined ? {} : { matrix_profile: profile }),
  });
}

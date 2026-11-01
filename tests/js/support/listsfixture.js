// The wire the option-list suites drive (tests/js/store/faceplate-lists/*.test.js and
// tests/js/components/faceplate-lists/*.test.js), and the reset every case runs.
//
// One engine with the SDM chain loaded: its <GetFilters/> and <GetShapers/> enumerations into `enums`, its State
// indices into `engineState`. The PCM chain is dormant, so its lists come off the daemon's /config form in `config`.
// The overlays /api/metadata serves go into `metadata`: one filter's manual prose, two modulators' rate floor and
// generation, and the plain-names breakdown each list joins by engine name. Every name, family, variant, leaf and
// sentence here is the fixture's own, so a suite may assert any of them back.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import {
  config,
  engineState,
  engineStatus,
  enums,
  generation,
  metadata,
} from "../../../hqptuner/static/store/signals.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { favoriteFilters, favoriteModulators, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import { collapsedGroups, setDacChip, setDacType, setPlainNames } from "../../../hqptuner/static/store/ui/prefs.js";
import { openList, openPopover } from "../../../hqptuner/static/store/faceplate/view.js";
import { ditherRate, modTier } from "../../../hqptuner/static/store/faceplate/lists/shapers.js";
import { hoverTip } from "../../../hqptuner/static/store/faceplate/lists/open.js";
import { fieldReading, seedReadings } from "./readings.js";

/** @typedef {{ index: string, value: string, name: string, description?: string, arg?: string, apodizing?: boolean }} EnumItem */

/** The loaded SDM chain's filters: one apodizing (arg bit 0), one half-apodizing (bit 1), one neither. */
/** @type {EnumItem[]} */
const SDM_FILTERS = [
  {
    index: "0",
    value: "38",
    name: "poly-sinc-gauss-long",
    description: "4/5 transients ⥣ Any",
    arg: "1",
    apodizing: true,
  },
  { index: "1", value: "23", name: "sinc-M", description: "2/5 ⥣ Any", arg: "2", apodizing: false },
  { index: "2", value: "7", name: "IIR", description: "3/5 ⥣ Any", arg: "0", apodizing: false },
];

/** @type {EnumItem[]} */
const SDM_SHAPERS = [
  { index: "0", value: "0", name: "ASDM5" },
  { index: "1", value: "3", name: "ASDM7EC 512+fs" },
];

/** The PCM chain's filters, as its own enumeration reports them while it is the loaded one. */
/** @type {EnumItem[]} */
const PCM_FILTERS = [
  { index: "0", value: "0", name: "none", description: "1/5 ⥮ 1:1", arg: "0", apodizing: false },
  { index: "1", value: "40", name: "poly-sinc-gauss-long", description: "4/5 ⥮ Any", arg: "1", apodizing: true },
];

/** @type {EnumItem[]} */
const PCM_SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "5", name: "NS9" },
  { index: "2", value: "2", name: "TPDF" },
];

/** The manual prose the filter overlay writes for one filter. */
export const SINC_PROSE = "Prose the overlay writes for sinc-M.";

/** The /config form fields: the chain each belongs to, the enum ID it holds, and the list it quotes in that domain. */
const FORM = /** @type {["pcm" | "sdm", string, string, EnumItem[]][]} */ ([
  ["pcm", "filter1x", "40", PCM_FILTERS],
  ["pcm", "filter", "40", PCM_FILTERS],
  ["pcm", "dither", "5", PCM_SHAPERS],
  ["sdm", "oversampling1x", "38", SDM_FILTERS],
  ["sdm", "oversampling", "38", SDM_FILTERS],
  ["sdm", "modulator", "3", SDM_SHAPERS],
]);

/**
 * One /config form field's metadata: the list it quotes, as options.
 *
 * @param {string} name
 * @param {EnumItem[]} items
 */
const formField = (name, items) => ({
  name,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});

/**
 * One /config form field's served reading, a FieldReading. On the loaded chain the Engine shows it: `engine.value` is
 * the list index of the item carrying the enum ID, under that item's name, and `file.value` keeps the enum ID. Off the
 * loaded chain the field has no Engine value: `engine` is null and the File shows the enum ID.
 *
 * @param {"pcm" | "sdm"} loaded
 * @param {"pcm" | "sdm"} chain
 * @param {string} value
 * @param {EnumItem[]} items
 */
function formReading(loaded, chain, value, items) {
  if (chain !== loaded) return fieldReading(value, { show: "file" });
  const item = items.find((i) => i.value === value);
  return fieldReading(item?.index, { name: item?.name, file: { value, generation: generation.value } });
}

/** A fresh /api/metadata payload: writing the same object to a signal does not notify. */
const overlays = () => ({
  settings: {},
  filters: { filters: { "sinc-M": { description: SINC_PROSE } }, aliases: {} },
  shapers: {
    pcm_dithers: {},
    sdm_modulators: { "ASDM7EC 512+fs": { min_rate_hz: 20480000, generation: 4 }, ASDM5: { generation: 2 } },
  },
  plain_names: {
    filters: {
      entries: {
        none: { family: "Fam B", variant: null, leaf: "Leaf none", short: "none" },
        "poly-sinc-gauss-long": { family: "Fam A", variant: "Var A", leaf: "Leaf gauss", short: "gauss" },
        "sinc-M": { family: "Fam A", variant: "Var B", leaf: "Leaf sinc", short: "sinc" },
        IIR: { family: "Fam B", variant: null, leaf: "Leaf iir", short: "iir" },
      },
      families: { "Fam A": "Blurb for Fam A" },
      variants: { "Fam A|Var A": "Blurb for Var A" },
    },
    dithers: {
      entries: {
        none: { family: "None", variant: null, leaf: "No dither", short: "none" },
        NS9: { family: "Noise shaping", variant: null, leaf: "Ninth order, ≥4x", short: "NS9" },
        TPDF: { family: "Additive", variant: null, leaf: "Triangular", short: "TPDF" },
      },
      families: {},
      variants: {},
    },
    modulators: {
      entries: {
        ASDM5: { family: "Adaptive", variant: "Fifth order", leaf: "Leaf asdm5", short: "ASDM5" },
        "ASDM7EC 512+fs": { family: "Adaptive", variant: "Seventh order", leaf: "Leaf asdm7", short: "ASDM7EC" },
      },
      families: {},
      variants: {},
    },
  },
});

/**
 * Put the engine on the wire with one chain loaded (the other dormant, read off the /config form), the overlays
 * served, and the option style set.
 *
 * @param {{ chain?: "sdm" | "pcm", plain?: boolean }} [o]
 */
export function loadLists({ chain = "sdm", plain = false } = {}) {
  const sdm = chain === "sdm";
  // State holds the list indices of the loaded chain's form values: SDM 38, 38, 3 and PCM 40, 40, 5.
  const held = sdm ? { filter1x: "0", filterNx: "0", shaper: "1" } : { filter1x: "1", filterNx: "1", shaper: "1" };
  engineState.value = { state: "0", active_chain: chain, ...held };
  engineStatus.value = {};
  enums.value = sdm ? { filters: SDM_FILTERS, shapers: SDM_SHAPERS } : { filters: PCM_FILTERS, shapers: PCM_SHAPERS };
  config.value = { fields: FORM.map(([, name, , items]) => formField(name, items)) };
  seedReadings(
    Object.fromEntries(FORM.map(([on, name, value, items]) => [name, formReading(chain, on, value, items)])),
  );
  metadata.value = overlays();
  setPlainNames(plain);
}

/** Every list signal back to where a fresh page starts: no narrowing, stars, folds, list, popover or tip. */
export function resetLists() {
  resetNarrowing();
  modTier.value = [];
  ditherRate.value = [];
  favoriteFilters.value = new Set();
  favoriteModulators.value = new Set();
  nFavOnly.value = false;
  collapsedGroups.value = {};
  setDacType("other");
  setDacChip("other");
  openList.value = null;
  openPopover.value = null;
  hoverTip.value = null;
}

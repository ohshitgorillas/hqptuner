// Behavioral suite for the SDM chain hiding a filter that a two-stage variant of
// itself supersedes: on the SDM chain only, a filter is left out of the menu when
// a filter named exactly its own name plus `-2s` is present in the SAME list.
//
// The rule is computed off the list the dropdown holds and off nothing else — no
// shipped constant names the superseded filters — and the fixture is built to
// hold an implementation to that. Most of its names are real ones HQPlayer
// enumerates, so the ordinary cases read like the menus a user sees; one pair,
// `zzz-nonesuch` and `zzz-nonesuch-2s`, is invented and appears in no data file
// this repo ships, so an implementation carrying a hardcoded roster of
// superseded names cannot hide it and one case turns on exactly that.
// `poly-sinc-gauss-long` has no twin and stays; `poly-sinc-hb-xs-2s` is a `-2s`
// whose plain twin is absent, so it is nobody's supersession and stays too.
// Every expected number is derived from the fixture's own length and its own
// superseded set, never typed as a literal.
//
// The PCM chain is not subject to the rule at all: the same names on
// `pcm_filter_nx` still offer the plain filter, which is what makes this an SDM
// rule rather than a global one.
//
// One exception, and it is what keeps a closed control able to name what it is
// set to: the filter the field is CURRENTLY set to is never hidden. So the same
// SDM list offers `poly-sinc-lp` when that is the effective value of the field
// reading it, and only then. Both surfaces are held to it, because they reach
// the effective value by different routes.
//
// Surfaces under test, both public:
//   - the /config page dropdown — the list a field's option source hands it,
//     `optionsFor("config", <form field>)` (store/options.js), which is also the
//     list the chain's count chip counts; `narrowOptions(options, stage, field)`
//     is what the dropdown then offers and `narrowCount(...)` is the `{n, total}`
//     badge beside it (store/narrow/match.js), `total` being the length of the
//     list the dropdown holds BEFORE facet narrowing;
//   - the LIVE page — `liveModel`'s per-chain controls, whose options for the
//     chain the engine has LOADED come off the engine's own `<GetFilters/>`
//     enumeration rather than the daemon's /config form (protocol.md §4). Each
//     live case reads the chain its own scenario loaded, never the two chains
//     concatenated, so a control answering out of the dormant column fails.
//
// Every "does not offer" case is paired with one pinning how long the list is,
// and every count case with one naming a filter that survives: on its own,
// neither shape can tell the rule from a list served empty or pruned at random.
//
// Chain keys are the ones the two surfaces speak: schema keys `sdm_filter_1x` /
// `sdm_filter_nx` and `pcm_filter_1x` / `pcm_filter_nx`, /config form fields
// `oversampling1x` / `oversampling` and `filter1x` / `filter`.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at the
// wire, no store function stubbed. Facet data is driven the way narrowing.test.js
// drives it — the engine's `<FiltersItem/>` shape on `enums.filters` with the
// quality rating at the head of the engine's own description string
// (protocol.md:228) — and no facet is engaged in any case here, so nothing but
// the supersession rule can remove a name from a list. Names carry no display
// assertion: a filter name is an engine wire identifier — `label` carries it
// unchanged through both surfaces — while the words rendered for it and the
// order they come in are the owner's (rule 9).
//
// Each reset reassigns EVERY signal these cases read and clears the private
// staged buffer through discardAll(): module-level signals outlive a test, and a
// partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/sdm-hide-superseded.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrow/match.js";
import { optionsFor } from "../../../hqptuner/static/store/options.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import {
  config,
  matrixConfig,
  metadata,
  enums,
  engineState,
  engineStatus,
  health,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveModel } from "../../../hqptuner/static/store/live/model.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { staticWire } from "../support/wire.js";
import { resetFilterFacets } from "../support/filterfacets.js";

// --- the fixture --------------------------------------------------------------
// The same list on both chains. Descriptions are the engine's own format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"`; the rating clears the quality facet's
// floor and the ratio is `Any`, so no rate switch reaches them either. The
// `zzz-` pair is invented: no shipped data file can name it, so only a rule read
// off this list can hide it.

/** @type {[name: string, description: string][]} */
const FILTERS = [
  ["poly-sinc-lp", "4/5 ⥮ Any"],
  ["poly-sinc-lp-2s", "4/5 ⥮ Any"],
  ["poly-sinc-short-mp", "4/5 ⥮ Any"],
  ["poly-sinc-short-mp-2s", "4/5 ⥮ Any"],
  ["poly-sinc-gauss-long", "4/5 ⥮ Any"],
  ["poly-sinc-hb-xs-2s", "4/5 ⥮ Any"],
  ["zzz-nonesuch", "4/5 ⥮ Any"],
  ["zzz-nonesuch-2s", "4/5 ⥮ Any"],
];

// The names a `-2s` twin in this same list supersedes. Stated here so the
// expected counts below are arithmetic on the fixture rather than magic numbers.
const SUPERSEDED = ["poly-sinc-lp", "poly-sinc-short-mp", "zzz-nonesuch"];

// The superseded name most cases ask after; the invented one no shipped file
// knows; the `-2s` that supersedes it; a `-2s` no plain twin accompanies; and a
// filter no `-2s` supersedes, used as the effective value wherever a case is NOT
// about the current-selection exception.
const HIDDEN = "poly-sinc-lp";
const INVENTED = "zzz-nonesuch";
const TWIN = "poly-sinc-lp-2s";
const ORPHAN_TWIN = "poly-sinc-hb-xs-2s";
const KEPT = "poly-sinc-gauss-long";

const OFFERED = FILTERS.length - SUPERSEDED.length;

/** @param {string} name */
const indexOfName = (name) => FILTERS.findIndex(([n]) => n === name);

// --- the /config page surface --------------------------------------------------

// The option-source's own row type, so a case names the shape the store serves
// rather than a second spelling of it.
/** @typedef {ReturnType<typeof optionsFor>} HeldOptions */

/**
 * Serve the fixture as the engine's enumeration and as both chains' /config form
 * fields, with the effective value of each Nx/1x filter field named by FILTER
 * NAME. Facets are reset to neutral and favorites emptied, so the only thing that
 * can remove a name from a list is the rule under test.
 *
 * Nothing is returned: a case reads the list its OWN field is handed, off the
 * /config option source, rather than off the array this seeded the form with.
 *
 * @param {{ sdmNx?: string, sdm1x?: string, pcmNx?: string, pcm1x?: string }} [values]
 * @returns {Promise<void>}
 */
async function resetConfigPage({ sdmNx = KEPT, sdm1x = KEPT, pcmNx = KEPT, pcm1x = KEPT } = {}) {
  staticWire();
  const options = resetFilterFacets(FILTERS);
  /** @param {string} name */
  const wire = (name) => String(indexOfName(name));
  const values = {
    filter1x: wire(pcm1x),
    filter: wire(pcmNx),
    oversampling1x: wire(sdm1x),
    oversampling: wire(sdmNx),
  };
  const fields = Object.entries(values).map(([name, value]) => ({ name, value, options }));
  config.value = { fields, file: { ...values }, active: "", profiles: null };
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
  await discardAll();
}

/**
 * The list one /config dropdown holds, from the store's own option source — the
 * same list the count chip counts and the same one narrowing is then applied to.
 *
 * @param {string} formField
 * @returns {HeldOptions}
 */
const held = (formField) => optionsFor("config", formField);

/**
 * The filter names one dropdown offers once narrowing has had its turn.
 *
 * @param {HeldOptions} options
 * @param {string} stage
 * @param {string} field
 * @returns {string[]}
 */
const offered = (options, stage, field) => narrowOptions(options, stage, field).map((o) => o.label);

// --- the SDM chain hides what a `-2s` twin supersedes ---------------------------

test("test_the_sdm_nx_dropdown_does_not_offer_a_filter_its_two_stage_twin_supersedes", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").includes(HIDDEN), false);
});

// The same rule on a name no data file in this repo has ever heard of: a roster
// of superseded names could not hide it, and only the list itself says it is one.
test("test_the_sdm_nx_dropdown_hides_a_superseded_name_no_shipped_file_knows", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").includes(INVENTED), false);
});

test("test_the_sdm_1x_dropdown_does_not_offer_a_filter_its_two_stage_twin_supersedes", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling1x"), "1x", "sdm_filter_1x").includes(HIDDEN), false);
});

// The companion to the case above: an absence is also what an empty list looks
// like, so the 1x stage is pinned to the same length the Nx stage is.
test("test_the_sdm_1x_dropdown_offers_the_fixture_less_its_superseded_names", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling1x"), "1x", "sdm_filter_1x").length, OFFERED);
});

// Only the superseded names go, so the count is the fixture less exactly the
// superseded set.
test("test_the_sdm_nx_dropdown_offers_the_fixture_less_its_superseded_names", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").length, OFFERED);
});

// Which names survive, not merely how many: a rule that took the `-2s` and left
// the plain filter would count the same and be exactly backwards.
test("test_the_sdm_nx_dropdown_still_offers_the_two_stage_filter_that_supersedes", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").includes(TWIN), true);
});

// A `-2s` whose plain twin is not in the list supersedes nothing and is nobody's
// supersession, so it is offered like any other filter.
test("test_the_sdm_nx_dropdown_still_offers_a_two_stage_filter_with_no_plain_twin", async () => {
  await resetConfigPage();
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").includes(ORPHAN_TWIN), true);
});

// The badge's denominator is the list the dropdown HOLDS, so a hidden filter is
// not counted in it — a `total` still reading the fixture's own length would tell
// the user about options the menu does not have.
test("test_the_sdm_nx_badge_totals_the_list_the_dropdown_holds", async () => {
  await resetConfigPage();
  assert.equal(narrowCount(held("oversampling"), "nx", "sdm_filter_nx").total, OFFERED);
});

// --- the current selection is never hidden --------------------------------------
// Regression guard as much as a new rule: a superseded filter the field is
// actually set to stays listed, so the closed control can still name it.

test("test_the_sdm_nx_dropdown_still_offers_a_superseded_filter_it_is_set_to", async () => {
  await resetConfigPage({ sdmNx: HIDDEN });
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").includes(HIDDEN), true);
});

// The exception reaches ONE name — the one the field is set to — and not the
// whole superseded set, so the other superseded names are still gone.
test("test_the_exception_for_the_current_selection_returns_only_that_one_filter", async () => {
  await resetConfigPage({ sdmNx: HIDDEN });
  assert.equal(offered(held("oversampling"), "nx", "sdm_filter_nx").length, OFFERED + 1);
});

// --- the PCM chain is not subject to the rule ------------------------------------
// Read off the PCM chain's OWN form field, so this is a second list rather than
// the SDM one asserted twice.

test("test_the_pcm_nx_dropdown_still_offers_a_filter_a_two_stage_twin_supersedes", async () => {
  await resetConfigPage();
  assert.equal(offered(held("filter"), "nx", "pcm_filter_nx").includes(HIDDEN), true);
});

// --- the LIVE page ----------------------------------------------------------------
// The loaded chain's controls take their options from the engine's enumeration,
// not from the /config form, so the rule has to hold on that list too. The two
// chains number the same names differently (protocol.md §4), which is why the two
// enumerations below carry different enum values for identical names.

const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];
const JUNK = [{ index: "0", value: "0", name: "none" }];
const PCM_SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "5", name: "NS9" },
];
const SDM_SHAPERS = [
  { index: "0", value: "0", name: "ASDM5" },
  { index: "1", value: "3", name: "ASDM7EC" },
];

/**
 * The fixture as one chain's `<GetFilters/>` enumeration: list index and enum
 * value differ, and the enum value differs between the chains.
 *
 * @param {number} base
 * @returns {{ index: string, value: string, name: string, description: string }[]}
 */
const enumeration = (base) =>
  FILTERS.map(([name, description], index) => ({
    index: String(index),
    value: String(base + index),
    name,
    description,
  }));

const PCM_FILTERS = enumeration(40);
const SDM_FILTERS = enumeration(20);

/** @type {Record<string, { index: string, value: string, name: string }[]>} */
const LISTS = {
  filter1x: PCM_FILTERS,
  filter: PCM_FILTERS,
  dither: PCM_SHAPERS,
  oversampling1x: SDM_FILTERS,
  oversampling: SDM_FILTERS,
  modulator: SDM_SHAPERS,
};

/**
 * The running configuration, with both chains' Nx filter named by FILTER NAME.
 * The 1x stages sit on the filter no `-2s` supersedes throughout.
 *
 * @param {string} nx
 * @returns {Record<string, string>}
 */
const FORM = (nx) => ({
  filter1x: PCM_FILTERS[indexOfName(KEPT)].value,
  filter: PCM_FILTERS[indexOfName(nx)].value,
  dither: "5",
  oversampling1x: SDM_FILTERS[indexOfName(KEPT)].value,
  oversampling: SDM_FILTERS[indexOfName(nx)].value,
  modulator: "3",
});

const LIVE_METADATA = {
  settings: {
    output: { output_mode: { label: "Output mode", tooltip: "Selects default output mode." } },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
};

/**
 * The LIVE page with one chain loaded and its Nx filter set to `nx`, named by
 * FILTER NAME. State reports LIST INDICES of the loaded chain's enumeration;
 * `chain` names which chain that is.
 *
 * @param {{ chain: "pcm" | "sdm", mode: string, nx?: string }} scenario
 * @returns {Promise<void>}
 */
async function resetLivePage({ chain, mode, nx = KEPT }) {
  staticWire();
  const form = FORM(nx);
  health.value = { reachable: true, info: {} };
  engineState.value = {
    mode,
    filter1x: String(indexOfName(KEPT)),
    filterNx: String(indexOfName(nx)),
    shaper: "1",
    rate: "1",
    filter_junk: "0",
    adaptive: "0",
    volume: "-10.0",
    active_chain: chain,
  };
  engineStatus.value = null;
  enums.value = {
    rates: RATES,
    junk_filters: JUNK,
    filters: chain === "sdm" ? SDM_FILTERS : PCM_FILTERS,
    shapers: chain === "sdm" ? SDM_SHAPERS : PCM_SHAPERS,
    mode: { name: chain === "sdm" ? "SDM (DSD)" : "PCM" },
  };
  metadata.value = LIVE_METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = {
    fields: Object.entries(form).map(([name, value]) => ({
      name,
      value,
      options: LISTS[name].map((i) => ({ value: i.value, label: i.name })),
    })),
    file: { mode: chain, ...form },
    active: "",
    profiles: null,
  };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
  resetNarrowing();
  await discardAll();
}

/**
 * The filter names one LIVE chain control offers, read off the column named by
 * `chain` — never the two columns concatenated, so a control answering out of the
 * dormant chain is a miss rather than a pass. `label` is the option's engine
 * name, and it is read directly: a fallback chain would answer a list of empty
 * strings for a shape that changed, which every "does not offer" case would then
 * pass.
 *
 * @param {"pcmChain" | "sdmChain"} chain
 * @param {string} field
 * @returns {string[]}
 */
function liveOptionNames(chain, field) {
  const hit = liveModel.value[chain].find((/** @type {{ field: string }} */ c) => c.field === field);
  if (!hit) throw new Error(`the ${chain} column carries no control for "${field}"`);
  return hit.options.map((/** @type {{ label: string }} */ o) => o.label);
}

test("test_the_live_sdm_nx_control_does_not_offer_a_filter_its_two_stage_twin_supersedes", async () => {
  await resetLivePage({ chain: "sdm", mode: "2" });
  assert.equal(liveOptionNames("sdmChain", "oversampling").includes(HIDDEN), false);
});

// The companion, so the absence above is not read off a list served empty.
test("test_the_live_sdm_nx_control_offers_the_enumeration_less_its_superseded_names", async () => {
  await resetLivePage({ chain: "sdm", mode: "2" });
  assert.equal(liveOptionNames("sdmChain", "oversampling").length, OFFERED);
});

// The exception on the other surface: LIVE reaches the effective value through
// the engine's own State report, so it is its own path and its own case.
test("test_the_live_sdm_nx_control_still_offers_a_superseded_filter_it_is_set_to", async () => {
  await resetLivePage({ chain: "sdm", mode: "2", nx: HIDDEN });
  assert.equal(liveOptionNames("sdmChain", "oversampling").includes(HIDDEN), true);
});

test("test_the_live_pcm_nx_control_still_offers_a_filter_a_two_stage_twin_supersedes", async () => {
  await resetLivePage({ chain: "pcm", mode: "1" });
  assert.equal(liveOptionNames("pcmChain", "filter").includes(HIDDEN), true);
});

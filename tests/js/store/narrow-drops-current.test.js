// Behavioral suite for what an ENGAGED facet does to the option a filter
// dropdown currently has selected (store/narrowing.js `narrowOptions`).
//
// The rule pinned here: narrowing answers one question per option — does this
// option pass the facets the user engaged — and the currently selected option
// gets no exemption from it. An option that fails the facets is absent from the
// offered list whether or not it is the one the field is showing; an option that
// passes is present because it matches, never because it is current. With no
// facet engaged the offered list is the whole option list.
//
// The counts beside the dropdown are a separate contract and unchanged: they are
// taken off the RAW, pre-narrow option list, so a selection the facets narrowed
// out raises the total and not the match count.
//
// Facet data is driven the way narrowing.test.js drives it — by assigning the
// two source signals the real payloads carry: `enums.filters` is the running
// engine's `<GetFilters/>` enumeration (`{index, name, value, arg, description}`,
// protocol.md:226) and `metadata.filters.filters` is the static name-keyed
// overlay served by /api/metadata. Descriptions are hand-written in the engine's
// own format, `"<q>/5 [focus, ...] <glyph> <ratio>"`, with the PCM glyph `⥮`
// because every fixture here is read through a PCM field. No count comes from a
// shipped data file.
//
// Every case reads the Nx stage, whose apodizing and hi-res switches default to
// "all"; the 1x stage defaults are a narrowing of their own and would ride along
// under every assertion here.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes cases
// pass alone and fail in sequence.
//
// These cases state the store's contract; the change they belong to is only
// OBSERVABLE through a caller, because the exemption they remove was expressed
// by an argument the caller passed and this signature has no such argument.
// tests/js/components/combobox-narrowed-current.test.js is where it bites.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrow-drops-current.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nFocus, resetNarrowing, narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrowing.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

/**
 * One dropdown option, as a /config filter field carries it: the option VALUE
 * is the engine's index and the LABEL is the filter name, so value !== label.
 *
 * @typedef {{ value: string, label: string }} Option
 */

/**
 * The filter list under test. `gauss-c` is deliberately the odd one out: it is
 * the only member carrying no `timbre` focus, and it is the option every case
 * below treats as the field's current selection.
 *
 * @type {[name: string, description: string][]}
 */
const FILTERS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 timbre, transients ⥮ Any"],
];

// The option the field is showing for every case in this file: gauss-c, which
// fails a `timbre` facet and passes a `transients` one.
const CURRENT = "2";

/** @returns {Option[]} */
function reset() {
  enums.value = {
    filters: FILTERS.map(([name, description], index) => ({
      index: String(index),
      name,
      value: String(index),
      arg: 0,
      description,
      apodizing: false,
    })),
  };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  return FILTERS.map(([name], index) => ({ label: name, value: String(index) }));
}

/** @param {Option[]} options */
const offered = (options) => narrowOptions(options, STAGE, FIELD).map((o) => o.label);

/**
 * The label of the option the field currently has selected, as the fixture
 * spells it — so a case says "the current selection" rather than "gauss-c".
 *
 * @param {Option[]} options
 */
const currentLabel = (options) => (options.find((o) => o.value === CURRENT) || { label: "" }).label;

// --- an engaged facet judges the current selection like any other -------------

test("test_a_current_selection_failing_the_engaged_facet_is_not_offered", () => {
  const options = reset();
  nFocus.value = ["timbre"];
  assert.equal(offered(options).includes(currentLabel(options)), false);
});

test("test_an_engaged_facet_offers_exactly_the_options_that_pass_it", () => {
  const options = reset();
  nFocus.value = ["timbre"];
  assert.deepEqual(offered(options), ["gauss-a", "gauss-b", "gauss-d"]);
});

test("test_a_current_selection_passing_the_engaged_facet_is_offered", () => {
  const options = reset();
  nFocus.value = ["transients"];
  assert.equal(offered(options).includes(currentLabel(options)), true);
});

// Kept because it matches, not because it is current: the same facet keeps the
// other transient-carrying filters alongside it.
test("test_an_engaged_facet_keeps_the_current_selection_on_the_same_terms_as_the_rest", () => {
  const options = reset();
  nFocus.value = ["transients"];
  assert.deepEqual(offered(options), ["gauss-a", "gauss-c", "gauss-d"]);
});

// --- no facet engaged: nothing is narrowed at all ------------------------------

test("test_with_no_facet_engaged_the_offered_list_is_the_whole_option_list", () => {
  const options = reset();
  assert.deepEqual(
    offered(options),
    options.map((o) => o.label),
  );
});

// --- the badge still counts off the raw list -----------------------------------

test("test_the_badge_match_count_excludes_a_narrowed_out_current_selection", () => {
  const options = reset();
  nFocus.value = ["timbre"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 3);
});

// NOT covered here: that the badge's denominator is the raw option count. The
// match count is `n` and the suite has no name for the other half of "n/total"
// — every existing case reads `n` alone — so pinning it would mean guessing a
// member name rather than stating a behaviour.

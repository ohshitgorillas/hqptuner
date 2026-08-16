// Behavioral suite for which options an engaged facet leaves a filter dropdown
// offering (store/narrowing.js `narrowOptions`), and what the counts beside it
// say while it does.
//
// The rule pinned here: narrowing answers ONE question per option — does this
// option pass the facets the user engaged — and no option is exempt from it, the
// one the field happens to be showing included. `narrowOptions` is not told what
// the field is showing, which is the whole of the change these cases belong to;
// what a caller does with a selection that did not survive is a component
// contract, pinned in tests/js/components/combobox-narrowed-current.test.js.
//
// The counts beside the dropdown are a separate contract and unchanged: `n` is
// how many options passed, `total` is the length of the RAW, pre-narrow list, so
// an option the facets excluded is counted in the second and not the first.
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
// Every case reads the Nx stage. The per-stage controls start neutral at both
// stages now — apodizing "all", and the 1x lossy-source control "both" — and are
// tests/js/store/narrowing-lossy.test.js's subject.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes cases
// pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrow-drops-current.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nFocus, resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { narrowOptions, narrowCount } from "../../../hqptuner/static/store/narrowmatch.js";
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
 * The filter list under test. `gauss-c` is deliberately the odd one out — the
 * only member carrying no `timbre` focus — so a `timbre` facet excludes exactly
 * one filter and a `transients` facet excludes a different one.
 *
 * @type {[name: string, description: string][]}
 */
const FILTERS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 timbre, transients ⥮ Any"],
];

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

// --- an engaged facet offers the filters carrying it, and only those ----------
// The two cases run the same fixture past two different focus values, so the
// offered list is shown to follow the facet rather than any one filter's
// standing: `timbre` excludes gauss-c, `transients` excludes gauss-b.

test("test_an_engaged_focus_facet_offers_exactly_the_filters_carrying_it", () => {
  const options = reset();
  nFocus.value = ["timbre"];
  assert.deepEqual(offered(options), ["gauss-a", "gauss-b", "gauss-d"]);
});

test("test_a_different_focus_value_offers_the_filters_carrying_that_one", () => {
  const options = reset();
  nFocus.value = ["transients"];
  assert.deepEqual(offered(options), ["gauss-a", "gauss-c", "gauss-d"]);
});

// --- no facet engaged: nothing is narrowed at all ------------------------------
// Distinct from narrowing.test.js's empty-selection cases, which clear ONE facet
// and leave the rest at their defaults: here nothing has been touched at all.

test("test_with_no_facet_engaged_the_offered_list_is_the_whole_option_list", () => {
  const options = reset();
  assert.deepEqual(
    offered(options),
    options.map((o) => o.label),
  );
});

// --- the badge counts matches over the raw list --------------------------------
// `timbre` excludes gauss-c, so the badge reads 3/4: the excluded filter is in
// the denominator, which is the raw option list, and not in the numerator.

test("test_the_badge_counts_the_matches_over_the_raw_option_count", () => {
  const options = reset();
  nFocus.value = ["timbre"];
  const count = narrowCount(options, STAGE, FIELD);
  assert.deepEqual([count.n, count.total], [3, 4]);
});

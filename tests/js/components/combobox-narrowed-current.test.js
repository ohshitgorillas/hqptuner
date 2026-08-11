// Behavioral suite for a filter dropdown whose CURRENT SELECTION has been
// narrowed out of its option list — the state an engaged facet now puts the
// control in, because narrowing judges the current option on the facets like any
// other and drops it when it fails them.
//
// Three things must survive that: the closed button still says what the filter
// is CALLED rather than showing the raw value the /config form carries
// (value !== label for filter options), the description line under the control
// still describes the selection, and no option row claims to be the selected one.
//
// The facet engaged here is favorites-only (store/favorites.js `nFavOnly`),
// because it narrows on the filter NAME alone and so needs no enumeration
// fixture; the store-level rule it exercises is the same one every other facet
// obeys (tests/js/store/narrow-drops-current.test.js).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. State is driven through the field harness (source signals plus a
// faked wire, favorites answered by the real /api/favorites routes) and the
// favorites set is emptied by assigning its exported signal, the way
// combobox-fav.test.js does it.
//
// NOT covered here, SSR reaching the closed state only (docs/testing.md
// "Branches that cannot be reached"): that OPENING such a combobox highlights
// the first listed option, and that dismissing it with an outside click leaves
// the value alone. Both need the open flag a pointer handler writes; they belong
// to the browser hand-back protocol.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-narrowed-current.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Combobox } from "../../../hqptuner/static/components/controls/Combobox.js";
import { reset, field, line, optionLabels } from "../support/field-harness.js";
import { staticWire } from "../support/wire.js";
import { favoritesRoutes, favoritesState } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/favorites.js";
import { nApod1x } from "../../../hqptuner/static/store/narrowing.js";

// The 1x filter dropdown, with a selection (sinc-M) the harness's metadata
// describes and a second filter the user has starred.
const FILTER_FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: [
      { value: "0", label: "sinc-M" },
      { value: "1", label: "poly-sinc-xtr-mp" },
    ],
  },
];

const SELECTED = "sinc-M";
const STARRED = "poly-sinc-xtr-mp";

/**
 * Render the 1x filter field with favorites-only engaged and only the OTHER
 * filter starred, so the facet narrows the current selection out of the list.
 *
 * @param {{ favOnly?: boolean }} [state]
 * @returns {Promise<string>}
 */
async function narrowedField({ favOnly = true } = {}) {
  await reset({ fields: FILTER_FIELDS });
  // The 1x stage narrows to apodizing filters by default; opening that switch
  // leaves favorites-only as the ONLY facet in play, so `favOnly` alone decides
  // whether the current selection passes and each case says what it means.
  nApod1x.value = "all";
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  favoriteFilters.value = new Set([STARRED]);
  favoritesError.value = "";
  nFavOnly.value = favOnly;
  return field("pcm_filter_1x");
}

// Text a user reads off the closed combobox button: the dd-box element's own
// content, tags stripped, so the caret the shape draws in its own element does
// not ride along. Cases ask what that text EQUALS: "names the filter" is only
// half the contract, and a button reading "0 sinc-M" satisfies a contains.
/**
 * @param {string} out
 * @returns {string}
 */
function boxText(out) {
  const m = /<button\b[^<>]*\bclass="[^"]*\bdd-box\b[^"]*"[^<>]*>([\s\S]*?)<\/button>/.exec(out || "");
  if (!m) throw new Error("no closed combobox button in the rendered output");
  return m[1].replace(/<[^<>]*>/g, "").trim();
}

/** @param {string} out */
const selectedRows = (out) => (out || "").match(/aria-selected="true"/g) || [];

// --- the facet drops the current selection from the list ----------------------

test("test_an_engaged_facet_leaves_the_narrowed_out_selection_off_the_option_rows", async () => {
  assert.deepEqual(optionLabels(await narrowedField()), [STARRED]);
});

// --- what the control still says about the selection --------------------------

test("test_a_closed_combobox_still_names_the_selection_that_was_narrowed_out", async () => {
  assert.equal(boxText(await narrowedField()), SELECTED);
});

test("test_a_field_still_describes_the_selection_that_was_narrowed_out", async () => {
  assert.equal(line(await narrowedField(), "field-desc"), "A very long sinc.");
});

// --- nothing in the list claims to be the selection ---------------------------

test("test_no_option_row_is_marked_selected_when_the_selection_was_narrowed_out", async () => {
  assert.deepEqual(selectedRows(await narrowedField()), []);
});

// Contrast case, so the one above means something: with the facet off, the row
// the field is showing IS marked. If this fails, the closed rendering marks no
// row selected at all and the case above is vacuous — read it as the boundary
// of the SSR harness, not as a regression.
test("test_the_current_selections_row_is_marked_selected_when_it_is_listed", async () => {
  assert.equal(selectedRows(await narrowedField({ favOnly: false })).length, 1);
});

// --- the combobox's own valueLabel contract -----------------------------------
// Rendered directly, because `valueLabel` is what a caller hands the control for
// exactly this case: a value with no option to take a label from.

const OPTIONS = [{ value: "1", label: STARRED }];
const noop = () => {};

test("test_a_combobox_shows_its_value_label_when_the_value_is_not_among_its_options", () => {
  const out = render(html`<${Combobox} value="0" options=${OPTIONS} valueLabel=${SELECTED} onChange=${noop} />`);
  assert.equal(boxText(out), SELECTED);
});

test("test_a_matching_options_own_label_outranks_the_value_label", () => {
  const out = render(html`<${Combobox} value="1" options=${OPTIONS} valueLabel="stale" onChange=${noop} />`);
  assert.equal(boxText(out), STARRED);
});

// Behavioral suite for the narrowing bar's rendered controls
// (components/narrowbar/Bar.js): the rate popover's three switches, the count chip
// on a row previewing the click that row would perform (which on a value
// already picked is an UNPICK), and the intro caption's pref. The phase and
// length popovers are multi-select like genre and focus and are pinned in
// tests/js/components/narrowbar-phase-length.test.js.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed. State is driven by assigning the exported source signals the
// real payloads carry — the engine's `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed overlay from /api/metadata — and
// by resetNarrowing(), the module's own public reset.
//
// A popover renders nothing until it is open, and it opens on its button's
// click handler; preact-render-to-string never fires one and there is no DOM
// here. Resetting the bar, opening a facet and reading its rows and count chips
// back off the emitted HTML all live in tests/js/support/genrepopover.js, which
// states what that route couples to.
//
// NOT covered here: which row is marked checked, and what clicking a row does to
// the facet signals — the store suite (tests/js/store/narrowing.test.js) pins the
// effect of every facet value on the offered filters, which is the observable
// contract; the checked mark is the same fact rendered.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nFocus, nQuality, nHideLimited, nOddRateOnly, nDownsafeOnly } from "../../../hqptuner/static/store/narrow/state.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import {
  resetNarrowBar,
  renderNarrowBar,
  openFacet as open,
  popoverRows as rows,
  checkedRows,
  countChip as chip,
  nxOf as nxCount,
} from "../support/genrepopover.js";

/**
 * One filter as the engine's own `<GetFilters/>` enumeration reports it
 * (protocol.md:226).
 *
 * @typedef {{
 *   index: string,
 *   name: string,
 *   value: string,
 *   arg: number,
 *   description: string,
 *   apodizing: boolean,
 * }} EngineFilter
 */

// A handful of filters in the engine's own description format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"` with the PCM glyph and the engine's
// abbreviated ratio tail, plus the static overlay's genre tags.
const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-long", value: "2", arg: 0, description: "5/5 timbre ⥮ 2^x", apodizing: false },
];

const OVERLAY = {
  "gauss-short": { genre: ["jazz"] },
  "gauss-plain": { genre: ["any"] },
  "gauss-long": { genre: ["classical", "jazz"] },
};

// The counts on a facet row are counts of a DROPDOWN's options, so a case that
// reads one hands the chain's two filter fields the options the /config form
// serves. `engineState.mode` picks the active chain; PCM unless it says SDM.
const FOCUS_FILTERS = [
  { index: "0", name: "gauss-a", value: "0", arg: 1, description: "5/5 timbre, transients ⥮ Any", apodizing: true },
  { index: "1", name: "gauss-b", value: "1", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-c", value: "2", arg: 1, description: "5/5 transients ⥮ Any", apodizing: true },
  // Rated below the quality floor the count case picks explicitly (the facet's
  // default is 0, "Any quality", so a floor is a pick now), which puts it out
  // of every count that case takes: it carries the picked focus, which makes
  // it the filter that tells a chip applying the whole selection apart from
  // one applying none.
  { index: "3", name: "gauss-faint", value: "3", arg: 1, description: "2/5 timbre, transients ⥮ Any", apodizing: true },
];

/** @param {EngineFilter[]} filters */
const chainFields = (filters) => {
  const opts = filters.map((f) => ({ value: f.value, label: f.name }));
  // The daemon's PCM chain names its two filter slots `filter1x` and `filter`.
  return [
    { name: "filter1x", value: "0", options: opts },
    { name: "filter", value: "0", options: opts },
  ];
};

/**
 * @param {{ filters?: EngineFilter[], fields?: Record<string, unknown>[] }} [scenario]
 * @returns {Promise<void>}
 */
const reset = ({ filters = FILTERS, fields = [] } = {}) => resetNarrowBar(filters, { overlay: OVERLAY, fields });

// --- the rate popover ----------------------------------------------------------
// The single-select ratio popover and its upsample-only checkbox are gone —
// the rate facet offers the three narrowing switches
// (tests/js/store/narrowing-rate.test.js) as independent checkbox rows, each
// under its exact user-facing wording.

const RATE_ROWS = [
  "Hide output rate-limited filters",
  "Show only filters that support downsampling",
  "Show only filters that support resampling uncommon source rates (e.g., 32kHz)",
];

test("test_the_rate_popover_offers_exactly_the_three_switches_as_checkbox_rows", async () => {
  await reset();
  assert.deepEqual(
    rows(open("rate")),
    RATE_ROWS.map((label) => ({ type: "checkbox", label })),
  );
});

// Each row is bound to ITS switch: engaging one signal marks exactly the row
// under that switch's wording checked and no other — swapped wiring between
// two rows would leave the label list intact and fail here.

test("test_the_hide_limited_switch_checks_the_rate_limited_row_alone", async () => {
  await reset();
  nHideLimited.value = "on";
  assert.deepEqual(checkedRows(open("rate")), ["Hide output rate-limited filters"]);
});

test("test_the_odd_rate_switch_checks_the_uncommon_source_rates_row_alone", async () => {
  await reset();
  nOddRateOnly.value = true;
  assert.deepEqual(checkedRows(open("rate")), [
    "Show only filters that support resampling uncommon source rates (e.g., 32kHz)",
  ]);
});

test("test_the_downsample_safe_switch_checks_the_downsampling_row_alone", async () => {
  await reset();
  nDownsafeOnly.value = true;
  assert.deepEqual(checkedRows(open("rate")), ["Show only filters that support downsampling"]);
});

// --- a row's count previews the click it would perform ----------------------------
//
// The chip beside a row says what the dropdowns would offer if that row were
// clicked, so on a row already picked it must answer for the selection WITHOUT
// it — clicking a picked value unpicks it.
//
// TWO values are picked, and a quality floor of 3 is picked alongside them
// (the default is 0 per the quality-default-any spec delta, so the floor here
// is an explicit facet pick the preview must keep applying), and four readings
// of this fixture are four different numbers: 4 is the total, which a chip
// narrowing by nothing gives; 3 is the focus facet dropped altogether with the
// floor still on, which a chip ignoring the focus selection gives; 1 is the
// live selection under the default AND mode (gauss-a alone carries both and
// passes the floor), which a chip ignoring the preview gives; 2 is the unpick,
// and the below-floor gauss-faint is what separates 4 from 3.

test("test_the_count_on_a_picked_facet_row_previews_unpicking_it", async () => {
  await reset({ filters: FOCUS_FILTERS, fields: chainFields(FOCUS_FILTERS) });
  nQuality.value = 3;
  nFocus.value = ["timbre", "transients"];
  assert.equal(nxCount(chip(open("focus"), "Timbre")), 2);
});

// --- the intro caption follows the setting-descriptions pref ----------------------
// The card's intro caption is a setting description, so it obeys the master
// "Setting descriptions" pref alone. The keep-option pref governs OPTION
// descriptions only, so the caption stays hidden under master OFF even in the
// keep-ON state where option descriptions still show.

const CAPTION = "Reduce the number of filters in the dropdowns below";

test("test_the_intro_caption_renders_while_the_descriptions_pref_is_on", async () => {
  await reset();
  showDescriptions.value = true;
  keepOptionDescriptions.value = false;
  assert.ok(renderNarrowBar().includes(CAPTION));
});

test("test_the_intro_caption_is_absent_with_the_master_pref_off_even_with_keep_option_on", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  assert.equal(renderNarrowBar().includes(CAPTION), false);
});

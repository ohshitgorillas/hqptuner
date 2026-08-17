// Behavioral suite for the narrow bar's PHASE and LENGTH facets
// (components/narrowbar/Facets.js for the popovers,
// components/narrowbar/labels.js for the button wording).
//
// Both facets are multi-select, the way genre and focus are: the popover offers
// its values as checkbox rows, the empty selection means "any", and there is no
// row inside the popover that clears the facet — unticking the last row is what
// clears it, and the button says so. The one difference from genre and focus is
// that neither carries an AND/OR combine switch: a filter has exactly one phase
// and exactly one length, so an AND across two picks would be empty by
// construction and the picks always union.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's own `<GetFilters/>` enumeration
// (protocol.md:226) — and by resetNarrowing(). Opening a facet and reading its
// rows, chips and button captions back off the emitted HTML lives in
// tests/js/support/genrepopover.js, which states what that route couples to.
//
// Which filters a picked phase or length then hides is the store suite's
// subject (tests/js/store/narrowing.test.js), not this file's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-phase-length.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nPhase, nLength } from "../../../hqptuner/static/store/narrowing.js";
import { phaseLabel, lengthLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import {
  resetNarrowBar,
  openFacet as open,
  popoverRows as rows,
  countChip,
  nxOf,
  buttonCaptions,
} from "../support/genrepopover.js";

/**
 * A fixture filter, rated above the quality floor and ratio-agnostic so that
 * nothing at its default trims it: only the name carries a phase or length.
 *
 * @param {string} name
 * @param {number} index
 */
const item = (name, index) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 1,
  description: "4/5 timbre ⥮ Any",
  apodizing: true,
});

// One linear-phase filter, one minimum-phase, one carrying no phase token.
const PHASES = ["gauss-lp", "gauss-mp", "gauss-plain"].map(item);

// One of each of three length classes: the token-less name classifies medium.
const LENGTHS = ["gauss-short", "gauss-plain", "gauss-long"].map(item);

/**
 * Put the bar back to its defaults over one fixture set. A count chip counts a
 * DROPDOWN's options, so both PCM filter slots are handed the same options the
 * /config form would serve for these filters.
 *
 * @param {ReturnType<typeof item>[]} filters
 */
function reset(filters = PHASES) {
  const options = filters.map((f) => ({ value: f.value, label: f.name }));
  const fields = [
    { name: "filter1x", value: "0", options },
    { name: "filter", value: "0", options },
  ];
  return resetNarrowBar(filters, { fields });
}

/** @param {string} block */
const rowKinds = (block) => [...new Set(rows(block).map((r) => r.type))].sort();

/** @param {string} block */
const rowLabels = (block) => rows(block).map((r) => r.label);

// --- multi-select widgets ---------------------------------------------------

test("test_the_phase_facet_offers_its_values_as_checkbox_rows", async () => {
  await reset();
  assert.deepEqual(rowKinds(open("phase")), ["checkbox"]);
});

test("test_the_length_facet_offers_its_values_as_checkbox_rows", async () => {
  await reset();
  assert.deepEqual(rowKinds(open("length")), ["checkbox"]);
});

// The empty selection is what "any" means, so the popover carries no clear row:
// the row list is exactly the domain, in the order the popover offers it. The
// phase domain's last member is the empty string — the filters the phase
// taxonomy does not reach — captioned "No phase". It is a pick like any other
// and is NOT a clear row: clearing is unticking everything. Length has no
// counterpart; its unclassified filters are reachable by no pick at all.

test("test_the_phase_popover_offers_exactly_the_four_phases_and_no_clear_row", async () => {
  await reset();
  assert.deepEqual(rowLabels(open("phase")), ["Linear", "Minimum", "Intermediate", "No phase"]);
});

test("test_the_length_popover_offers_exactly_the_four_lengths_and_no_clear_row", async () => {
  await reset();
  assert.deepEqual(rowLabels(open("length")), ["Short", "Medium", "Long", "Extra long"]);
});

// --- no combine switch --------------------------------------------------------
// A filter carries exactly one phase and exactly one length, so an AND across
// two picks is empty by construction: the picks union and there is nothing to
// switch. The switch is the segmented AND/OR pair genre and focus close their
// popovers with, read here by its own user-facing wording.

const MODE_CAPTION = /^(and|or)$/i;

test("test_the_phase_popover_carries_no_and_or_combine_switch", async () => {
  await reset();
  assert.deepEqual(
    buttonCaptions(open("phase")).filter((c) => MODE_CAPTION.test(c)),
    [],
  );
});

test("test_the_length_popover_carries_no_and_or_combine_switch", async () => {
  await reset();
  assert.deepEqual(
    buttonCaptions(open("length")).filter((c) => MODE_CAPTION.test(c)),
    [],
  );
});

// --- the button summary ---------------------------------------------------------
// Owner-approved copy, verbatim: "Any phase" / "Any length" with nothing picked,
// the picked value's own label with exactly one, and "<N> phases" / "<N>
// lengths" past that. No combine-mode suffix, unlike genre and focus.

test("test_the_phase_button_with_nothing_picked_reads_any_phase", async () => {
  await reset();
  assert.equal(phaseLabel(), "Any phase");
});

test("test_the_phase_button_with_one_pick_reads_that_phases_own_label", async () => {
  await reset();
  nPhase.value = ["minimum"];
  assert.equal(phaseLabel(), "Minimum");
});

test("test_the_phase_button_with_two_picks_reads_the_count", async () => {
  await reset();
  nPhase.value = ["linear", "minimum"];
  assert.equal(phaseLabel(), "2 phases");
});

// The empty-string pick is a value like any other on the button too: alone it
// shows its own label, and beside another it just counts. "Any phase" stays the
// wording for the empty SELECTION, which is a different state.

test("test_the_phase_button_with_the_no_phase_pick_alone_reads_no_phase", async () => {
  await reset();
  nPhase.value = [""];
  assert.equal(phaseLabel(), "No phase");
});

test("test_the_phase_button_with_the_no_phase_pick_and_one_other_reads_the_count", async () => {
  await reset();
  nPhase.value = ["", "minimum"];
  assert.equal(phaseLabel(), "2 phases");
});

test("test_the_length_button_with_nothing_picked_reads_any_length", async () => {
  await reset();
  assert.equal(lengthLabel(), "Any length");
});

test("test_the_length_button_with_one_pick_reads_that_lengths_own_label", async () => {
  await reset();
  nLength.value = ["xlong"];
  assert.equal(lengthLabel(), "Extra long");
});

test("test_the_length_button_with_two_picks_reads_the_count", async () => {
  await reset();
  nLength.value = ["short", "long"];
  assert.equal(lengthLabel(), "2 lengths");
});

// --- a row's count previews the click it would perform ------------------------------
//
// The chip beside a row says what the dropdowns would offer if that row were
// clicked, so on a value already picked it must answer for the selection
// WITHOUT it — clicking a ticked row unticks it. Phase at ["linear"] leaves one
// of the three fixture filters; unpicking it leaves all three, so the two
// readings are different numbers and only the unpick preview is 3.

test("test_the_count_on_a_picked_phase_row_previews_unpicking_it", async () => {
  await reset();
  nPhase.value = ["linear"];
  assert.equal(nxOf(countChip(open("phase"), "Linear")), 3);
});

test("test_the_count_on_a_picked_length_row_previews_unpicking_it", async () => {
  await reset(LENGTHS);
  nLength.value = ["short"];
  assert.equal(nxOf(countChip(open("length"), "Short")), 3);
});
